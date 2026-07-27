import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { getResellerPayoutMode } from '@/app/lib/resellerPayoutPolicy'

const SETTING_KEY = 'reseller_payout_mode'

export async function GET() {
  const user = await getCurrentUser()
  if (!user || !['admin', 'reseller'].includes(user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ mode: await getResellerPayoutMode() })
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { mode } = await req.json()
  if (!['cash', 'check', 'account'].includes(mode)) {
    return NextResponse.json({ error: 'Invalid reseller payout mode.' }, { status: 400 })
  }

  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: mode, updated_by: user.id },
    update: { value: mode, updated_by: user.id },
  })
  return NextResponse.json({ success: true, mode })
}
