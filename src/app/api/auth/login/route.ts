import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/app/lib/prisma'
import {
  verifyPassword, signToken, setAuthCookie,
  getDashboardRoute, JWTPayload, UserRole, setTwoFactorChallengeCookie,
} from '@/app/lib/auth'
import { createAuditLog, getClientInfo, formatMemberId } from '@/app/lib/auditLog'
import { isLoginPortal, isRoleAllowedInPortal, portalAccessError } from '@/app/lib/loginPortal'
import { isSecurityPinEligibleRole } from '@/app/lib/securityPinPolicy'
import { firstAdminStaffRoute } from '@/app/lib/staffPermissions'
import { consumeLoginAllowance, resetLoginAccountFailures } from '@/app/lib/loginRateLimit'
import { normalizeLoginIdentifier } from '@/app/lib/loginRateLimitPolicy'

const LOGIN_TIMING_DECOY_HASH = '$2b$12$Z2wP7Y3VVNwvktXxUkqwaunHHoM0EztrFeg3tHL.AHH.qQ5/3rovO'

export async function POST(req: NextRequest) {
  const { ip_address, device } = getClientInfo(req)

  try {
    const { username, password, portal: requestedPortal } = await req.json()
    if (requestedPortal !== undefined && !isLoginPortal(requestedPortal)) {
      return NextResponse.json({ error: 'Invalid login portal.' }, { status: 400 })
    }
    const portal = requestedPortal === undefined ? 'legacy' : requestedPortal

    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password || username.length > 100 || password.length > 1024) {
      return NextResponse.json({ error: 'Username and password are required.' }, { status: 400 })
    }

    const normalizedUsername = normalizeLoginIdentifier(username)
    const allowance = await consumeLoginAllowance(req.headers, normalizedUsername)
    if (!allowance.allowed) {
      return NextResponse.json(
        { error: 'Too many sign-in attempts. Please wait and try again.' },
        { status: 429, headers: { 'Retry-After': String(allowance.retryAfterSeconds) } },
      )
    }

    let user
    try {
      user = await prisma.user.findUnique({ where: { username: normalizedUsername } })
    } catch (dbError: unknown) {
      console.error('[LOGIN DB ERROR]', dbError)
      // Database details can reveal schema and infrastructure information.
      return NextResponse.json({ error: 'Unable to sign in right now. Please try again.' }, { status: 500 })
    }

    if (!user) {
      await verifyPassword(password, LOGIN_TIMING_DECOY_HASH)
      // Log failed login — unknown user
      createAuditLog({
        activity_type: 'failed_login',
        category:      'auth',
        description:   `Failed login attempt for username: "${username}"`,
        ip_address, device,
        risk_level:    'medium',
        status:        'failed',
        user_role:     'unknown',
      })
      return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 })
    }

    const passwordValid = await verifyPassword(password, user.password_hash)
    if (!passwordValid) {
      createAuditLog({
        user_id:       user.id,
        user_name:     user.full_name,
        user_role:     user.role,
        member_id:     formatMemberId(user.id, user.role),
        activity_type: 'failed_login',
        category:      'auth',
        description:   `Failed login — incorrect password`,
        ip_address, device,
        risk_level:    'medium',
        status:        'failed',
      })
      return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 })
    }

    if (user.status !== 'active') {
      createAuditLog({
        user_id:       user.id,
        user_name:     user.full_name,
        user_role:     user.role,
        member_id:     formatMemberId(user.id, user.role),
        activity_type: 'failed_login',
        category:      'auth',
        description:   `Login attempt on suspended account`,
        ip_address, device,
        risk_level:    'high',
        status:        'suspicious',
      })
      return NextResponse.json({ error: 'Your account has been suspended.' }, { status: 403 })
    }

    if (user.login_disabled) {
      createAuditLog({
        user_id:       user.id,
        user_name:     user.full_name,
        user_role:     user.role,
        member_id:     formatMemberId(user.id, user.role),
        activity_type: 'blocked_login',
        category:      'auth',
        description:   'Interactive login blocked for system-only account',
        ip_address, device,
        risk_level:    'high',
        status:        'suspicious',
      })
      return NextResponse.json({ error: 'This system account cannot sign in.' }, { status: 403 })
    }

    if (user.role !== 'staff' && !isRoleAllowedInPortal(user.role as UserRole, portal)) {
      createAuditLog({ user_id: user.id, user_name: user.full_name, user_role: user.role, member_id: formatMemberId(user.id, user.role), activity_type: 'blocked_login', category: 'auth', description: 'Account attempted to use the ' + portal + ' login portal', ip_address, device, risk_level: 'medium', status: 'failed' })
      return NextResponse.json({ error: portalAccessError(portal) }, { status: 403 })
    }

    if (user.role !== 'staff' && isSecurityPinEligibleRole(user.role) && user.two_factor_enabled && user.two_factor_pin_hash) {
      const challenge = await signToken({
        id: user.id,
        username: user.username,
        role: user.role as UserRole,
        full_name: user.full_name,
      })
      await resetLoginAccountFailures(normalizedUsername)
      await setTwoFactorChallengeCookie(challenge)
      return NextResponse.json({ success: true, requires_pin: true })
    }

    const staffProfile = user.role === 'staff'
      ? await prisma.staffProfile.findUnique({
          where: { user_id: user.id },
          select: {
            is_active: true,
            permissions: true,
            staff_type: true,
            owner: { select: { id: true, username: true, full_name: true, role: true, status: true } },
          },
        })
      : null
    if (user.role === 'staff' && (!staffProfile?.is_active || staffProfile.owner.status !== 'active')) {
      return NextResponse.json({ error: 'This staff account is inactive.' }, { status: 403 })
    }

    const permissions = user.role === 'staff' && Array.isArray(staffProfile?.permissions)
      ? staffProfile.permissions.filter((value): value is string => typeof value === 'string')
      : undefined
    const owner = user.role === 'staff' ? staffProfile!.owner : user
    const effectiveRole = owner.role as UserRole
    if (!isRoleAllowedInPortal(effectiveRole, portal)) {
      createAuditLog({ user_id: user.id, user_name: user.full_name, user_role: user.role, member_id: formatMemberId(user.id, user.role), activity_type: 'blocked_login', category: 'auth', description: 'Account attempted to use the ' + portal + ' login portal', ip_address, device, risk_level: 'medium', status: 'failed' })
      return NextResponse.json({ error: portalAccessError(portal) }, { status: 403 })
    }
    const payload: JWTPayload = user.role === 'staff'
      ? {
          id: owner.id,
          username: user.username,
          role: effectiveRole,
          full_name: user.full_name,
          is_staff: true,
          actor_id: user.id,
          actor_username: user.username,
          actor_name: user.full_name,
          owner_id: owner.id,
          permissions,
          staff_type: staffProfile!.staff_type,
          session_epoch: user.password_changed_at?.getTime(),
        }
      : { id: user.id, username: user.username, role: user.role as UserRole, full_name: user.full_name }
    const token = await signToken(payload)
    await resetLoginAccountFailures(normalizedUsername)
    await setAuthCookie(token)

    // Log successful login
    createAuditLog({
      user_id:       user.id,
      user_name:     user.full_name,
      user_role:     user.role,
      member_id:     formatMemberId(user.id, user.role),
      activity_type: 'login',
      category:      'auth',
      description:   `${user.full_name} logged in successfully`,
      ip_address, device,
      risk_level:    'low',
      status:        'normal',
    })

    const staffRedirect = user.role === 'staff' && staffProfile?.staff_type === 'area_manager'
      ? '/dashboard/area-manager'
      : user.role === 'staff' && owner.role === 'admin'
      ? firstAdminStaffRoute(permissions || [])
      : getDashboardRoute(owner.role as UserRole)
    return NextResponse.json({
      success: true,
      user:    { id: user.id, username: user.username, full_name: user.full_name, role: user.role },
      redirect: staffRedirect,
    })
  } catch (error: unknown) {
    console.error('[LOGIN ERROR]', error)
    return NextResponse.json({ error: 'Unable to sign in right now. Please try again.' }, { status: 500 })
  }
}
