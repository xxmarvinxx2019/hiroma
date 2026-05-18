import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, hashPassword } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ── PATCH — edit reseller details ──
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const { full_name, username, mobile, address, email, password } = await req.json()

    if (!full_name?.trim()) {
      return NextResponse.json({ error: 'Full name is required.' }, { status: 400 })
    }
    if (!username?.trim()) {
      return NextResponse.json({ error: 'Username is required.' }, { status: 400 })
    }

    // Check reseller exists first
    const reseller = await prisma.user.findFirst({
      where:  { id, role: 'reseller' },
      select: { id: true, email: true, username: true },
    })
    if (!reseller) {
      return NextResponse.json({ error: 'Reseller not found.' }, { status: 404 })
    }

    // Only check username uniqueness if it actually changed
    const cleanUsername = username.trim().toLowerCase()
    if (cleanUsername !== reseller.username) {
      const existingUsername = await prisma.user.findFirst({
        where: { username: cleanUsername, id: { not: id } },
      })
      if (existingUsername) {
        return NextResponse.json({ error: 'Username already taken.' }, { status: 400 })
      }
    }

    // Check email uniqueness if changed
    if (email?.trim() && email.trim().toLowerCase() !== reseller.email?.toLowerCase()) {
      const existing = await prisma.user.findFirst({
        where: { email: email.trim().toLowerCase(), id: { not: id } },
      })
      if (existing) {
        return NextResponse.json({ error: 'Email already in use.' }, { status: 400 })
      }
    }

    // Hash new password if provided
    const passwordData = password?.trim()
      ? { password_hash: await hashPassword(password.trim()) }
      : {}

    const updated = await prisma.user.update({
      where: { id },
      data: {
        full_name: full_name.trim(),
        username:  username.trim().toLowerCase(),
        mobile:    mobile?.trim()  || null,
        address:   address?.trim() || null,
        email:     email?.trim()   ? email.trim().toLowerCase() : null,
        ...passwordData,
      },
      select: { id: true, full_name: true, username: true, email: true, mobile: true, address: true },
    })

    return NextResponse.json({ success: true, reseller: updated })
  } catch (error) {
    console.error('[ADMIN RESELLER PATCH ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}