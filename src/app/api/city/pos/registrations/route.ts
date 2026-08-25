import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { releasePosRegistrationPackage } from '@/app/lib/posRegistration'
import { InsufficientStockError } from '@/app/lib/inventoryReservation'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RECEIPT = /^HRM-[A-Z0-9]{3}-[A-F0-9]{7}-[0-9]{6}-[0-9]{6,}$/

function clean(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function responseRow(row: {
  id: string
  client_intake_id: string
  receipt_number: string
  status: string
  applicant_full_name: string
  applicant_mobile: string
  applicant_email: string | null
  applicant_birthday: Date
  applicant_birthplace: string
  applicant_address: unknown
  referrer_username: string
  preferred_position: string | null
  payment_method_snapshot: string
  payment_reference: string | null
  amount_snapshot: Prisma.Decimal
  captured_offline: boolean
  payment_verified_at: Date | null
  released_at: Date | null
  encoding_started_at: Date | null
  completed_at: Date | null
  exception_reason: string | null
  local_created_at: Date
  package: { id: string; name: string }
  cashier: { full_name: string; username: string }
}) {
  return { ...row, amount: Number(row.amount_snapshot) }
}

const selection = {
  id: true,
  client_intake_id: true,
  receipt_number: true,
  status: true,
  applicant_full_name: true,
  applicant_mobile: true,
  applicant_email: true,
  applicant_birthday: true,
  applicant_birthplace: true,
  applicant_address: true,
  referrer_username: true,
  preferred_position: true,
  payment_method_snapshot: true,
  payment_reference: true,
  amount_snapshot: true,
  captured_offline: true,
  payment_verified_at: true,
  released_at: true,
  encoding_started_at: true,
  completed_at: true,
  exception_reason: true,
  local_created_at: true,
  package: { select: { id: true, name: true } },
  cashier: { select: { full_name: true, username: true } },
} satisfies Prisma.PosRegistrationIntakeSelect

export async function GET() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'city') return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  const actorId = user.actor_id || user.id
  const rows = await prisma.posRegistrationIntake.findMany({
    where: user.is_staff ? { owner_id: user.id, cashier_id: actorId } : { owner_id: user.id },
    orderBy: { created_at: 'desc' },
    take: 100,
    select: selection,
  })
  return NextResponse.json({ registrations: rows.map(responseRow) })
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'city') return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  const actorId = user.actor_id || user.id
  try {
    const body = await req.json()
    const clientIntakeId = clean(body.client_intake_id, 36)
    const receiptNumber = clean(body.receipt_number, 80).toUpperCase()
    const terminalId = clean(body.terminal_id, 36)
    const shiftId = clean(body.shift_id, 36)
    const packageId = clean(body.package_id, 100)
    const fullName = clean(body.applicant?.full_name, 180)
    const mobile = clean(body.applicant?.mobile, 40)
    const email = clean(body.applicant?.email, 180).toLowerCase() || null
    const birthday = new Date(body.applicant?.birthday)
    const birthplace = clean(body.applicant?.birthplace, 240)
    const referrerUsername = clean(body.applicant?.referrer_username, 120).toLowerCase()
    const preferredPosition = ['left', 'right'].includes(body.applicant?.preferred_position)
      ? body.applicant.preferred_position
      : null
    const address = body.applicant?.address
    const paymentSelection = clean(body.payment_method, 120)
    const paymentReference = clean(body.payment_reference, 160) || null
    const capturedOffline = body.captured_offline === true
    const localCreatedAt = new Date(body.local_created_at)

    if (
      !UUID.test(clientIntakeId) ||
      !UUID.test(terminalId) ||
      !UUID.test(shiftId) ||
      !RECEIPT.test(receiptNumber) ||
      !packageId ||
      !fullName ||
      !mobile ||
      Number.isNaN(birthday.getTime()) ||
      !birthplace ||
      !referrerUsername ||
      !address ||
      typeof address !== 'object' ||
      !paymentSelection ||
      Number.isNaN(localCreatedAt.getTime())
    ) {
      return NextResponse.json({ error: 'Complete all required applicant, package, payment, terminal, and receipt details.' }, { status: 400 })
    }
    if (capturedOffline && paymentSelection !== 'cash') {
      return NextResponse.json({ error: 'Offline registration accepts cash only.', code: 'OFFLINE_CASH_ONLY' }, { status: 400 })
    }

    const existing = await prisma.posRegistrationIntake.findFirst({
      where: { client_intake_id: clientIntakeId, owner_id: user.id },
      select: selection,
    })
    if (existing) return NextResponse.json({ registration: responseRow(existing), replayed: true })

    const registration = await prisma.$transaction(async (tx) => {
      const [terminal, shift, packageRow] = await Promise.all([
        tx.posTerminal.findFirst({ where: { id: terminalId, owner_id: user.id, is_active: true }, select: { id: true } }),
        tx.posShift.findFirst({
          where: { id: shiftId, terminal_id: terminalId, owner_id: user.id, opened_by_id: actorId, status: 'open' },
          select: { id: true },
        }),
        tx.package.findFirst({
          where: { id: packageId, is_active: true },
          select: {
            id: true,
            name: true,
            products: { select: { quantity: true, product: { select: { price: true } } } },
          },
        }),
      ])
      if (!terminal) throw new Error('POS_TERMINAL_INVALID')
      if (!shift) throw new Error('POS_SHIFT_INVALID')
      if (!packageRow || packageRow.products.length === 0) throw new Error('POS_PACKAGE_INVALID')

      let paymentMethodId: string | null = null
      let paymentMethodSnapshot = 'Cash'
      if (paymentSelection !== 'cash') {
        const payment = await tx.paymentMethod.findFirst({
          where: { id: paymentSelection, user_id: user.id, status: 'approved' },
          select: { type: true, account_name: true, account_number: true, bank_name: true },
        })
        if (!payment) throw new Error('POS_PAYMENT_INVALID')
        if (!paymentReference) throw new Error('POS_PAYMENT_REFERENCE_REQUIRED')
        paymentMethodId = paymentSelection
        paymentMethodSnapshot = `${payment.type.toUpperCase()} · ${payment.account_name} · ${payment.account_number}${payment.bank_name ? ` · ${payment.bank_name}` : ''}`.slice(0, 160)
      }
      const amount = packageRow.products.reduce(
        (sum, item) => sum + Number(item.product.price) * item.quantity,
        0,
      )
      const initialStatus = paymentSelection === 'cash' ? 'draft_intake' : 'pending_payment_verification'
      const created = await tx.posRegistrationIntake.create({
        data: {
          client_intake_id: clientIntakeId,
          receipt_number: receiptNumber,
          owner_id: user.id,
          terminal_id: terminalId,
          shift_id: shiftId,
          cashier_id: actorId,
          package_id: packageId,
          payment_method_id: paymentMethodId,
          status: initialStatus,
          applicant_full_name: fullName,
          applicant_mobile: mobile,
          applicant_email: email,
          applicant_birthday: birthday,
          applicant_birthplace: birthplace,
          applicant_address: address,
          identity_document_type: clean(body.applicant?.identity_document_type, 80) || null,
          identity_document_reference: clean(body.applicant?.identity_document_reference, 180) || null,
          referrer_username: referrerUsername,
          preferred_position: preferredPosition,
          applicant_snapshot: body.applicant,
          payment_method_snapshot: paymentMethodSnapshot,
          payment_reference: paymentReference,
          payment_proof_url: clean(body.payment_proof_url, 500) || null,
          amount_snapshot: amount,
          captured_offline: capturedOffline,
          notes: clean(body.notes, 1000) || null,
          local_created_at: localCreatedAt,
          events: {
            create: {
              actor_id: actorId,
              to_status: initialStatus,
              action: 'intake_created',
              metadata: { captured_offline: capturedOffline, receipt_number: receiptNumber },
            },
          },
        },
        select: { id: true },
      })
      if (paymentSelection === 'cash') {
        await releasePosRegistrationPackage(tx, {
          intakeId: created.id,
          ownerId: user.id,
          actorId,
          actorName: user.actor_name || user.full_name || user.username,
        })
      }
      return tx.posRegistrationIntake.findUniqueOrThrow({ where: { id: created.id }, select: selection })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    return NextResponse.json({ registration: responseRow(registration) }, { status: 201 })
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      return NextResponse.json({
        error: 'The registration package cannot be released because one or more products no longer have enough stock.',
      }, { status: 409 })
    }
    const message = error instanceof Error ? error.message : ''
    const known: Record<string, string> = {
      POS_TERMINAL_INVALID: 'This POS terminal is invalid or inactive.',
      POS_SHIFT_INVALID: 'Open a valid cashier shift before accepting a registration.',
      POS_PACKAGE_INVALID: 'The selected registration package is unavailable.',
      POS_PAYMENT_INVALID: 'The selected receiving account is unavailable.',
      POS_PAYMENT_REFERENCE_REQUIRED: 'Enter the e-wallet or bank reference number.',
    }
    if (known[message]) return NextResponse.json({ error: known[message] }, { status: 400 })
    if (message.includes('Unique constraint')) {
      return NextResponse.json({ error: 'This receipt or payment reference was already recorded.' }, { status: 409 })
    }
    console.error('[POS REGISTRATION CREATE]', error)
    return NextResponse.json({ error: 'Unable to save this registration intake.' }, { status: 500 })
  }
}
