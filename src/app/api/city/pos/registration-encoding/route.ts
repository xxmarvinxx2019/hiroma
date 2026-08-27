import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'city') return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id')
  if (id) {
    const row = await prisma.posRegistrationIntake.findFirst({
      where: {
        id,
        owner_id: user.id,
        released_at: { not: null },
        completed_user_id: null,
        status: { in: ['released_pending_encoding', 'encoding_in_progress'] },
      },
      select: {
        id: true,
        receipt_number: true,
        status: true,
        applicant_snapshot: true,
        applicant_address: true,
        referrer_username: true,
        preferred_position: true,
        package: { select: { id: true, name: true } },
      },
    })
    if (!row) return NextResponse.json({ error: 'Registration handoff not found or already completed.' }, { status: 404 })
    return NextResponse.json({ registration: row })
  }
  const rows = await prisma.posRegistrationIntake.findMany({
    where: {
      owner_id: user.id,
      released_at: { not: null },
      completed_user_id: null,
      status: { in: ['released_pending_encoding', 'encoding_in_progress'] },
    },
    orderBy: { released_at: 'asc' },
    select: {
      id: true,
      receipt_number: true,
      status: true,
      applicant_full_name: true,
      applicant_mobile: true,
      released_at: true,
      package: { select: { name: true } },
      cashier: { select: { full_name: true, username: true } },
    },
  })
  return NextResponse.json({ registrations: rows })
}
