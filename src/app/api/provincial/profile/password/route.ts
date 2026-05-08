import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, verifyPassword, hashPassword } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ── PATCH change password ──
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'provincial') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { current_password, new_password } = await req.json()

    if (!current_password || !new_password) {
      return NextResponse.json(
        { error: 'Both current and new password are required.' },
        { status: 400 }
      )
    }

    if (new_password.length < 8) {
      return NextResponse.json(
        { error: 'New password must be at least 8 characters.' },
        { status: 400 }
      )
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { password_hash: true },
    })

    if (!dbUser) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 })
    }

    const isValid = await verifyPassword(current_password, dbUser.password_hash)
    if (!isValid) {
      return NextResponse.json(
        { error: 'Current password is incorrect.' },
        { status: 400 }
      )
    }

    const newHash = await hashPassword(new_password)
    await prisma.user.update({
      where: { id: user.id },
      data:  { password_hash: newHash },
    })

    return NextResponse.json({ success: true, message: 'Password updated successfully.' })
  } catch (error) {
    console.error('[PROVINCIAL PASSWORD PATCH ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}