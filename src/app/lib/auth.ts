import bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

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
  return new SignJWT({ ...payload })
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
  return verifyToken(token)
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
