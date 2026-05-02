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

    // ── Validate input ──
    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required.' },
        { status: 400 }
      )
    }

    // ── Find user by username ──
    const user = await prisma.user.findUnique({
      where: { username: username.trim().toLowerCase() },
    })

    if (!user) {
      return NextResponse.json(
        { error: 'Invalid username or password.' },
        { status: 401 }
      )
    }

    // ── Check if account is active ──
    if (user.status !== 'active') {
      return NextResponse.json(
        { error: 'Your account has been suspended. Please contact admin.' },
        { status: 403 }
      )
    }

    // ── Verify password ──
    const passwordValid = await verifyPassword(password, user.password_hash)

    if (!passwordValid) {
      return NextResponse.json(
        { error: 'Invalid username or password.' },
        { status: 401 }
      )
    }

    // ── Sign JWT token ──
    const payload: JWTPayload = {
      id: user.id,
      username: user.username,
      role: user.role as UserRole,
      full_name: user.full_name,
    }

    const token = await signToken(payload)

    // ── Set auth cookie ──
    await setAuthCookie(token)

    // ── Return success with redirect route ──
    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
      },
      redirect: getDashboardRoute(user.role as UserRole),
    })
  } catch (error) {
    console.error('[LOGIN ERROR]', error)
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}