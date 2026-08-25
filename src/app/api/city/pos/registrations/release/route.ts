import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { releasePosRegistrationPackage } from '@/app/lib/posRegistration'
import { InsufficientStockError } from '@/app/lib/inventoryReservation'

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'city') return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  const actorId = user.actor_id || user.id
  try {
    const body = await req.json()
    const id = typeof body.id === 'string' ? body.id : ''
    if (!id) return NextResponse.json({ error: 'Registration intake is required.' }, { status: 400 })
    const result = await prisma.$transaction(
      (tx) => releasePosRegistrationPackage(tx, {
        intakeId: id,
        ownerId: user.id,
        actorId,
        actorName: user.actor_name || user.full_name || user.username,
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      return NextResponse.json({
        error: 'The package cannot be released because one or more products no longer have enough stock.',
      }, { status: 409 })
    }
    const message = error instanceof Error ? error.message : ''
    const known: Record<string, [string, number]> = {
      POS_REGISTRATION_NOT_FOUND: ['Registration intake not found.', 404],
      POS_REGISTRATION_NOT_READY_FOR_RELEASE: ['Payment must be verified before the package can be released.', 409],
      POS_REGISTRATION_PACKAGE_EMPTY: ['The selected package has no products configured.', 409],
    }
    if (known[message]) return NextResponse.json({ error: known[message][0] }, { status: known[message][1] })
    console.error('[POS REGISTRATION RELEASE]', error)
    return NextResponse.json({ error: 'Unable to release this registration package.' }, { status: 500 })
  }
}
