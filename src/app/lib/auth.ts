import bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'
import { cookies, headers } from 'next/headers'
import prisma from '@/app/lib/prisma'
import { isAccountSessionCurrent } from '@/app/lib/accountSession'
import { isFreshStaffSessionAuthorized } from '@/app/lib/staffSession'

// ============================================================
// TYPES
// ============================================================

export type UserRole =
  | 'admin'
  | 'regional'
  | 'provincial'
  | 'city'
  | 'reseller'
  | 'staff'

export interface JWTPayload {
  id: string
  username: string
  role: UserRole
  full_name: string
  is_staff?: boolean
  actor_id?: string
  actor_username?: string
  actor_name?: string
  owner_id?: string
  permissions?: string[]
  staff_type?: string
  session_epoch?: number
}

// ============================================================
// CONFIG
// ============================================================

const jwtSecret = process.env.JWT_SECRET
if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be configured with at least 32 characters.')
}
const JWT_SECRET = new TextEncoder().encode(jwtSecret)

const COOKIE_NAME = 'hiroma_token'
const TWO_FACTOR_CHALLENGE_COOKIE = 'hiroma_two_factor_challenge'
// No COOKIE_MAX_AGE — session cookie expires when browser closes

// ============================================================
// PASSWORD
// ============================================================

/**
 * Hash a plain text password
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

/**
 * Compare plain text password against hashed password
 */
export async function verifyPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword)
}

// ============================================================
// JWT
// ============================================================

/**
 * Sign a JWT token with user payload
 */
export async function signToken(payload: JWTPayload): Promise<string> {
  const sessionPayload = { ...payload }
  if (!payload.is_staff) {
    const account = await prisma.user.findUnique({
      where: { id: payload.id },
      select: { password_changed_at: true },
    })
    sessionPayload.session_epoch = account?.password_changed_at?.getTime()
  }

  return new SignJWT(sessionPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(JWT_SECRET)
}

/**
 * Verify and decode a JWT token
 */
export async function verifyToken(
  token: string
): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    return payload as unknown as JWTPayload
  } catch {
    return null
  }
}

// ============================================================
// COOKIES
// ============================================================

/**
 * Set the auth cookie after successful login
 */
export async function setAuthCookie(token: string): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    // No maxAge = session cookie
    path: '/',
  })
}

/**
 * Get the auth cookie value
 */
export async function getAuthCookie(): Promise<string | null> {
  const cookieStore = await cookies()
  const cookie = cookieStore.get(COOKIE_NAME)
  return cookie?.value || null
}

/**
 * Delete the auth cookie on logout
 */
export async function deleteAuthCookie(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE_NAME)
}

export async function setTwoFactorChallengeCookie(token: string): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(TWO_FACTOR_CHALLENGE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 5,
    path: '/api/auth',
  })
}

export async function getTwoFactorChallenge(): Promise<JWTPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(TWO_FACTOR_CHALLENGE_COOKIE)?.value
  return token ? verifyToken(token) : null
}

export async function deleteTwoFactorChallengeCookie(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(TWO_FACTOR_CHALLENGE_COOKIE)
}

// ============================================================
// SESSION
// ============================================================

/**
 * Get the current logged-in user from the cookie
 * Returns null if not logged in or token is invalid
 */
export async function getCurrentUser(): Promise<JWTPayload | null> {
  const token = await getAuthCookie()
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload) return null
  if (payload.is_staff === true) {
    if (!payload.actor_id || !payload.owner_id) return null
    const profile = await prisma.staffProfile.findUnique({
      where: { user_id: payload.actor_id },
      select: {
        is_active: true,
        permissions: true,
        staff_type: true,
        user: { select: { role: true, status: true, login_disabled: true, password_changed_at: true } },
        owner: { select: { id: true, role: true, status: true } },
      },
    })
    const permissions = profile && Array.isArray(profile.permissions)
      ? profile.permissions.filter((value): value is string => typeof value === 'string')
      : []
    let requiredPermission: string | null = null
    try { requiredPermission = (await headers()).get('x-hiroma-staff-permission') } catch { /* non-request caller */ }
    const snapshot = profile ? {
      is_active: profile.is_active,
      user_status: profile.user.status,
      user_role: profile.user.role,
      user_login_disabled: profile.user.login_disabled,
      owner_id: profile.owner.id,
      owner_role: profile.owner.role,
      owner_status: profile.owner.status,
      permissions,
    } : null
    if (!isFreshStaffSessionAuthorized(payload.owner_id, payload.role, snapshot, requiredPermission)) return null
    if (!profile) return null
    if (!isAccountSessionCurrent(payload, profile.user.password_changed_at)) return null
    return { ...payload, id: profile.owner.id, permissions, staff_type: profile.staff_type }
  }
  const account = await prisma.user.findUnique({
    where: { id: payload.id },
    select: { role: true, status: true, login_disabled: true, password_changed_at: true },
  })
  if (!account || account.status !== 'active' || account.login_disabled || account.role !== payload.role) return null
  if (!isAccountSessionCurrent(payload, account.password_changed_at)) return null
  return payload
}

// ============================================================
// ROLE REDIRECT HELPER
// ============================================================

/**
 * Get the dashboard route for each role
 */
export function getDashboardRoute(role: UserRole): string {
  switch (role) {
    case 'admin':
      return '/dashboard/admin'
    case 'regional':
      return '/dashboard/regional'
    case 'provincial':
      return '/dashboard/provincial'
    case 'city':
      return '/dashboard/city'
    case 'staff':
      return '/dashboard/city'
    case 'reseller':
      return '/dashboard/reseller'
    default:
      return '/login'
  }
}
