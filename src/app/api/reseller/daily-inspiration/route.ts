import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { getDailyInspiration, getManilaDate, getRecentInspirations } from '@/app/lib/dailyInspiration'

export async function GET() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'reseller') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const settings = await prisma.systemSetting.findMany({
    where: { key: { in: [`daily_inspiration:${user.id}:enabled`, `daily_inspiration:${user.id}:hidden_on`] } },
    select: { key: true, value: true },
  })
  const settingMap = new Map(settings.map((setting) => [setting.key, setting.value]))

  const today = getManilaDate()
  return NextResponse.json({
    inspiration: getDailyInspiration(),
    recent: getRecentInspirations(),
    preference: {
      enabled: settingMap.get(`daily_inspiration:${user.id}:enabled`) !== 'false',
      hidden_today: settingMap.get(`daily_inspiration:${user.id}:hidden_on`) === today,
    },
  })
}

export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'reseller') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const updates: Promise<unknown>[] = []
  if (typeof body.enabled === 'boolean') {
    const key = `daily_inspiration:${user.id}:enabled`
    updates.push(prisma.systemSetting.upsert({
      where: { key }, create: { key, value: String(body.enabled), updated_by: user.id },
      update: { value: String(body.enabled), updated_by: user.id },
    }))
  }
  if (typeof body.hide_today === 'boolean') {
    const key = `daily_inspiration:${user.id}:hidden_on`
    updates.push(prisma.systemSetting.upsert({
      where: { key }, create: { key, value: body.hide_today ? getManilaDate() : '', updated_by: user.id },
      update: { value: body.hide_today ? getManilaDate() : '', updated_by: user.id },
    }))
  }
  if (!updates.length) return NextResponse.json({ error: 'No valid preference supplied.' }, { status: 400 })

  await Promise.all(updates)
  return NextResponse.json({ success: true })
}
