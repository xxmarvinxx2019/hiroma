import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/app/lib/prisma'
import {
  verifyPassword,
  signToken,
  setAuthCookie,
  getDashboardRoute,
  JWTPayload,
  UserRole,
} from '@/app/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { username, password } = body

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required.' },
        { status: 400 }
      )
    }

    // ── Test DB connection first ──
    let user
    try {
      user = await prisma.user.findUnique({
        where: { username: username.trim().toLowerCase() },
      })
    } catch (dbError: any) {
      console.error('[LOGIN DB ERROR]', {
        message: dbError?.message,
        code:    dbError?.code,
        stack:   dbError?.stack?.split('\n').slice(0, 3),
      })
      return NextResponse.json(
        { error: `Database error: ${dbError?.message || 'Unknown DB error'}` },
        { status: 500 }
      )
    }

    if (!user) {
      return NextResponse.json(
        { error: 'Invalid username or password.' },
        { status: 401 }
      )
    }

    if (user.status !== 'active') {
      return NextResponse.json(
        { error: 'Your account has been suspended.' },
        { status: 403 }
      )
    }

    const passwordValid = await verifyPassword(password, user.password_hash)
    if (!passwordValid) {
      return NextResponse.json(
        { error: 'Invalid username or password.' },
        { status: 401 }
      )
    }

    const payload: JWTPayload = {
      id:        user.id,
      username:  user.username,
      role:      user.role as UserRole,
      full_name: user.full_name,
    }

    const token = await signToken(payload)
    await setAuthCookie(token)

    return NextResponse.json({
      success:  true,
      user: {
        id:        user.id,
        username:  user.username,
        full_name: user.full_name,
        role:      user.role,
      },
      redirect: getDashboardRoute(user.role as UserRole),
    })
  } catch (error: any) {
    console.error('[LOGIN ERROR]', {
      message: error?.message,
      code:    error?.code,
      stack:   error?.stack?.split('\n').slice(0, 5),
    })
    return NextResponse.json(
      { error: `Something went wrong: ${error?.message || 'Unknown error'}` },
      { status: 500 }
    )
  }
}