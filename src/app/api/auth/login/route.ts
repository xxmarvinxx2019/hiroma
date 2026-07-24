import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/app/lib/prisma'
import {
  verifyPassword, signToken, setAuthCookie,
  getDashboardRoute, JWTPayload, UserRole,
} from '@/app/lib/auth'
import { createAuditLog, getClientInfo, formatMemberId } from '@/app/lib/auditLog'

export async function POST(req: NextRequest) {
  const { ip_address, device } = getClientInfo(req)

  try {
    const { username, password } = await req.json()

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required.' }, { status: 400 })
    }

    let user
    try {
      user = await prisma.user.findUnique({ where: { username: username.trim().toLowerCase() } })
    } catch (dbError: any) {
      console.error('[LOGIN DB ERROR]', { message: dbError?.message, code: dbError?.code, stack: dbError?.stack?.split('\n').slice(0, 3) })
      return NextResponse.json({ error: `Database error: ${dbError?.message || 'Unknown DB error'}` }, { status: 500 })
    }

    if (!user) {
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

    const payload: JWTPayload = { id: user.id, username: user.username, role: user.role as UserRole, full_name: user.full_name }
    const token = await signToken(payload)
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

    return NextResponse.json({
      success: true,
      user:    { id: user.id, username: user.username, full_name: user.full_name, role: user.role },
      redirect: getDashboardRoute(user.role as UserRole),
    })
  } catch (error: any) {
    console.error('[LOGIN ERROR]', { message: error?.message, code: error?.code, stack: error?.stack?.split('\n').slice(0, 5) })
    return NextResponse.json({ error: `Something went wrong: ${error?.message || 'Unknown error'}` }, { status: 500 })
  }
}