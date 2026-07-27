import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { sendSMS, smsWelcomeReseller } from '@/app/lib/sms'

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || !['admin', 'city'].includes(user.role)) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
    }
    if (user.is_staff && !user.permissions?.includes('register_reseller')) {
      return NextResponse.json({ error: 'Your staff account cannot send registration credentials.' }, { status: 403 })
    }

    const { reseller_id, password } = await req.json()
    if (typeof reseller_id !== 'string' || typeof password !== 'string') {
      return NextResponse.json({ error: 'Reseller and password are required.' }, { status: 400 })
    }
    if (password.length < 6 || password.length > 128) {
      return NextResponse.json({ error: 'Invalid password length.' }, { status: 400 })
    }

    const reseller = await prisma.user.findFirst({
      where: {
        id: reseller_id,
        role: 'reseller',
        created_by: user.id,
        created_at: { gte: new Date(Date.now() - 30 * 60 * 1000) },
        ...(user.role === 'city' && {
          reseller_profile: { is: { city_dist_id: user.id } },
        }),
      },
      select: {
        full_name: true,
        username: true,
        mobile: true,
        reseller_profile: {
          select: { package: { select: { name: true } } },
        },
      },
    })

    if (!reseller) {
      return NextResponse.json(
        { error: 'The newly registered reseller was not found or is no longer eligible for credential SMS.' },
        { status: 404 },
      )
    }
    if (!reseller.mobile) {
      return NextResponse.json({ error: 'The reseller has no mobile number.' }, { status: 400 })
    }

    const result = await sendSMS(
      reseller.mobile,
      smsWelcomeReseller({
        full_name: reseller.full_name,
        username: reseller.username,
        password,
        package_name: reseller.reseller_profile?.package?.name || 'Starter',
      }),
    )

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'SMS could not be sent.' }, { status: 502 })
    }

    return NextResponse.json({ success: true, message: 'Login credentials sent by SMS.' })
  } catch (error) {
    console.error('[WELCOME SMS ERROR]', error)
    return NextResponse.json({ error: 'SMS could not be sent.' }, { status: 500 })
  }
}
