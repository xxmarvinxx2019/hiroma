import { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import { createAuditLog, getClientInfo } from '@/app/lib/auditLog'
import { consumeAvailableStock, InsufficientStockError } from '@/app/lib/inventoryReservation'
import { recordInventoryOutEvents } from '@/app/lib/inventoryEvent'
import { processDeliveredProductBinaryOrder } from '@/app/lib/productBinary'
import prisma from '@/app/lib/prisma'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RECEIPT = /^HRM-([A-Z0-9]{3})-([A-F0-9]{7})-([0-9]{6})-([0-9]{6,})$/

type RequestedItem = { product_id: string; quantity: number }

function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function money(value: unknown) {
  const amount = Number(value)
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : NaN
}

function locationCode(value: string | null | undefined): string {
  return (value || 'MAIN')
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 3)
    .toUpperCase()
    .padEnd(3, 'X')
}

function receiptDateCode(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || ''
  return `${value('year')}${value('month')}${value('day')}`
}

function parseItems(value: unknown): RequestedItem[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return null
  const seen = new Set<string>()
  const items: RequestedItem[] = []
  for (const row of value) {
    const productId = text(row?.product_id, 100)
    const quantity = Number(row?.quantity)
    if (!productId || seen.has(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 10_000) return null
    seen.add(productId)
    items.push({ product_id: productId, quantity })
  }
  return items
}

async function receiptFor(clientTransactionId: string, ownerId: string) {
  const transaction = await prisma.posTransaction.findFirst({
    where: { client_transaction_id: clientTransactionId, owner_id: ownerId },
    include: {
      order: { select: { id: true, order_number: true, created_at: true } },
      items: { orderBy: { product_name_snapshot: 'asc' } },
      cashier: { select: { full_name: true, username: true } },
    },
  })
  if (!transaction || !transaction.order) return null
  return {
    transaction_id: transaction.id,
    client_transaction_id: transaction.client_transaction_id,
    order_id: transaction.order.id,
    receipt_number: transaction.receipt_number,
    payment_status: transaction.status === 'finalized' ? 'paid' : transaction.status === 'rejected' ? 'rejected' : 'pending_verification',
    created_at: transaction.finalized_at || transaction.order.created_at,
    customer_name: transaction.customer_name_snapshot || 'Walk-in Customer',
    customer_type: transaction.transaction_type === 'member_sale' ? 'member' : 'non_member',
    cashier_name: transaction.cashier.full_name || transaction.cashier.username,
    payment_method: transaction.payment_method_snapshot.toLowerCase() === 'cash' ? 'Cash' : transaction.payment_method_snapshot,
    payment_reference: transaction.payment_reference,
    subtotal: Number(transaction.subtotal_snapshot),
    total: Number(transaction.total_snapshot),
    amount_received: Number(transaction.amount_received_snapshot),
    change: Number(transaction.change_snapshot),
    items: transaction.items.map((item) => ({
      product_id: item.product_id,
      name: item.product_name_snapshot,
      quantity: item.quantity,
      unit_price: Number(item.unit_price_snapshot),
      subtotal: Number(item.subtotal_snapshot),
      stock_after: item.local_stock_after,
    })),
  }
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'city') return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  const actorId = user.actor_id || user.id
  const canAudit = !user.is_staff || user.permissions?.includes('pos_approve') === true
  // Owners and authorized approvers always receive the accountability view.
  // Cashiers remain scoped to the shift they personally opened.
  const auditRequested = canAudit
  try {
    const profile = await prisma.distributorProfile.findUnique({ where: { user_id: user.id }, select: { dist_level: true } })
    const branchClosingRequired = profile?.dist_level === 'branch'
    const auditShifts = canAudit
      ? await prisma.posShift.findMany({
          where: { owner_id: user.id },
          orderBy: [{ opened_at: 'desc' }],
          take: 100,
          select: {
            id: true,
            status: true,
            opened_at: true,
            local_closed_at: true,
            opened_by: { select: { id: true, full_name: true, username: true } },
            terminal: { select: { id: true, name: true, receipt_code: true } },
            _count: { select: { transactions: true } },
          },
        })
      : []
    const requestedShiftId = req.nextUrl.searchParams.get('shift_id') || ''
    const auditedShiftId = auditRequested ? requestedShiftId || auditShifts[0]?.id || '' : ''
    const shift = await prisma.posShift.findFirst({
      where: auditRequested
        ? { id: auditedShiftId || undefined, owner_id: user.id }
        : { owner_id: user.id, opened_by_id: actorId },
      orderBy: [{ opened_at: 'desc' }],
      select: {
        id: true,
        terminal_id: true,
        status: true,
        opening_cash: true,
        expected_cash_snapshot: true,
        counted_cash: true,
        variance_snapshot: true,
        opened_at: true,
        local_closed_at: true,
        opened_by: { select: { id: true, full_name: true, username: true } },
        terminal: { select: { id: true, name: true, receipt_code: true } },
      },
    })
    if (!shift)
      return NextResponse.json({
        shift: null,
        transactions: [],
        payment_groups: [],
        access: { can_audit: canAudit, view: auditRequested ? 'audit' : 'mine' },
        audit_shifts: auditShifts.map((row) => ({
          id: row.id,
          status: row.status,
          opened_at: row.opened_at,
          closed_at: row.local_closed_at,
          cashier_id: row.opened_by.id,
          cashier_name: row.opened_by.full_name || row.opened_by.username,
          terminal_name: row.terminal.name,
          terminal_code: row.terminal.receipt_code,
          receipt_count: row._count.transactions,
        })),
      })
    const transactions = await prisma.posTransaction.findMany({
      where: {
        shift_id: shift.id,
        cashier_id: actorId,
        status: { in: ['synced_pending_review', 'rejected', 'approved', 'finalized'] },
      },
      orderBy: { finalized_at: 'desc' },
      select: {
        id: true,
        client_transaction_id: true,
        receipt_number: true,
        status: true,
        transaction_type: true,
        customer_name_snapshot: true,
        payment_method_snapshot: true,
        payment_reference: true,
        total_snapshot: true,
        amount_received_snapshot: true,
        change_snapshot: true,
        finalized_at: true,
        server_received_at: true,
        order: { select: { id: true, order_number: true } },
        items: {
          select: {
            product_name_snapshot: true,
            quantity: true,
            unit_price_snapshot: true,
            subtotal_snapshot: true,
          },
        },
      },
    })
    const pendingSyncCount = await prisma.posTransaction.count({
      where: {
        shift_id: shift.id,
        cashier_id: actorId,
        status: { in: ['pending_sync', 'syncing', 'synced_pending_review', 'needs_correction'] },
      },
    })
    const closingInventory = !auditRequested && branchClosingRequired && ['open', 'needs_review'].includes(shift.status)
      ? await prisma.inventory.findMany({
          where: { owner_id: user.id },
          orderBy: { product: { name: 'asc' } },
          select: { product_id: true, product: { select: { name: true } } },
        })
      : []
    const groups = new Map<
      string,
      {
        method: string
        count: number
        amount: number
        provider_verified: boolean
      }
    >()
    for (const row of transactions) {
      const current = groups.get(row.payment_method_snapshot) || {
        method: row.payment_method_snapshot,
        count: 0,
        amount: 0,
        provider_verified: row.payment_method_snapshot.toLowerCase() === 'cash',
      }
      current.count += 1
      current.amount += Number(row.total_snapshot)
      groups.set(row.payment_method_snapshot, current)
    }
    const closed = shift.status !== 'open'
    const reconciliationVisible = auditRequested || shift.status === 'finalized'
    return NextResponse.json({
      shift: {
        ...shift,
        opening_cash: Number(shift.opening_cash),
        expected_cash: reconciliationVisible && shift.expected_cash_snapshot != null ? Number(shift.expected_cash_snapshot) : null,
        counted_cash: shift.counted_cash != null ? Number(shift.counted_cash) : null,
        variance: reconciliationVisible && shift.variance_snapshot != null ? Number(shift.variance_snapshot) : null,
      },
      transactions: transactions.map((row) => ({
        ...row,
        payment_method_snapshot: row.payment_method_snapshot.toLowerCase() === 'cash' ? 'Cash' : row.payment_method_snapshot,
        receipt_number: row.receipt_number,
        total: Number(row.total_snapshot),
        amount_received: Number(row.amount_received_snapshot),
        change: Number(row.change_snapshot),
        items: row.items.map((item) => ({
          ...item,
          unit_price: Number(item.unit_price_snapshot),
          subtotal: Number(item.subtotal_snapshot),
        })),
      })),
      payment_groups: [...groups.values()].map((group) => ({
        ...group,
        method: group.method.toLowerCase() === 'cash' ? 'Cash' : group.method,
        amount: closed ? group.amount : null,
      })),
      pending_sync_count: pendingSyncCount,
      server_sync_complete: pendingSyncCount === 0,
      totals_hidden_until_close: !closed,
      branch_closing: {
        required: branchClosingRequired,
        inventory: closingInventory.map((row) => ({ product_id: row.product_id, product_name: row.product.name })),
      },
      access: { can_audit: canAudit, view: auditRequested ? 'audit' : 'mine' },
      selected_cashier: {
        id: shift.opened_by.id,
        name: shift.opened_by.full_name || shift.opened_by.username,
        username: shift.opened_by.username,
      },
      selected_terminal: {
        id: shift.terminal.id,
        name: shift.terminal.name,
        code: shift.terminal.receipt_code,
      },
      audit_shifts: auditShifts.map((row) => ({
        id: row.id,
        status: row.status,
        opened_at: row.opened_at,
        closed_at: row.local_closed_at,
        cashier_id: row.opened_by.id,
        cashier_name: row.opened_by.full_name || row.opened_by.username,
        terminal_name: row.terminal.name,
        terminal_code: row.terminal.receipt_code,
        receipt_count: row._count.transactions,
      })),
    })
  } catch (error) {
    console.error('[POS SHIFT HISTORY]', error)
    return NextResponse.json({ error: 'Unable to load this cashier shift history.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'city') return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })

  let submittedClientTransactionId = ''
  try {
    const body = await req.json()
    const clientTransactionId = text(body.client_transaction_id, 36)
    const receiptNumber = text(body.receipt_number, 80).toUpperCase()
    const receiptSequence = Number(body.receipt_sequence)
    submittedClientTransactionId = clientTransactionId
    const terminalId = text(body.terminal_id, 36)
    const shiftId = text(body.shift_id, 36)
    const customerType = body.customer_type === 'member' ? 'member' : body.customer_type === 'non_member' ? 'non_member' : ''
    const memberId = text(body.member_id, 100)
    const customerName = text(body.customer_name, 120)
    const paymentSelection = text(body.payment_method, 120)
    const paymentReference = text(body.payment_reference, 160) || null
    const capturedOffline = body.captured_offline === true
    const notes = text(body.notes, 500) || null
    const items = parseItems(body.items)
    const amountReceived = money(body.amount_received)
    const localCreatedAt = new Date(body.local_created_at)
    const actorId = user.actor_id || user.id

    if (!UUID.test(clientTransactionId) || !UUID.test(terminalId) || !UUID.test(shiftId) || !RECEIPT.test(receiptNumber) || !Number.isSafeInteger(receiptSequence) || receiptSequence < 1) {
      return NextResponse.json(
        {
          error: 'The POS transaction, terminal, or shift identifier is invalid.',
        },
        { status: 400 },
      )
    }
    if (!customerType || (customerType === 'member' && !memberId) || !items || !paymentSelection || !Number.isFinite(amountReceived) || amountReceived < 0 || Number.isNaN(localCreatedAt.getTime())) {
      return NextResponse.json(
        {
          error: 'Review the customer, cart, payment, and transaction details.',
        },
        { status: 400 },
      )
    }
    if (capturedOffline && paymentSelection !== 'cash') {
      return NextResponse.json(
        {
          error: 'Offline POS transactions accept cash only. GCash, e-wallet, and bank payments must be received and verified while connected to the internet.',
          code: 'OFFLINE_CASH_ONLY',
        },
        { status: 400 },
      )
    }

    const replay = await receiptFor(clientTransactionId, user.id)
    if (replay) return NextResponse.json({ receipt: replay, replayed: true })

    const result = await prisma.$transaction(
      async (tx) => {
        const existing = await tx.posTransaction.findUnique({
          where: { client_transaction_id: clientTransactionId },
          select: { owner_id: true },
        })
        if (existing) throw new Error(existing.owner_id === user.id ? 'POS_REPLAY' : 'POS_ID_CONFLICT')

        const [terminal, shift] = await Promise.all([
          tx.posTerminal.findFirst({
            where: { id: terminalId, owner_id: user.id, is_active: true },
            select: {
              id: true,
              receipt_code: true,
              receipt_sequence_next: true,
            },
          }),
          tx.posShift.findFirst({
            where: {
              id: shiftId,
              terminal_id: terminalId,
              owner_id: user.id,
              opened_by_id: actorId,
              status: 'open',
            },
            select: { id: true },
          }),
        ])
        if (!terminal) throw new Error('POS_TERMINAL_INVALID')
        if (!shift) throw new Error('POS_SHIFT_INVALID')
        if (receiptSequence >= terminal.receipt_sequence_next) throw new Error('POS_RECEIPT_UNRESERVED')

        const member =
          customerType === 'member'
            ? await tx.user.findFirst({
                where: { id: memberId, role: 'reseller', status: 'active' },
                select: { id: true, full_name: true, username: true },
              })
            : null
        if (customerType === 'member' && !member) throw new Error('POS_MEMBER_INVALID')

        let paymentMethodSnapshot = 'cash'
        let paymentMethodId: string | null = null
        if (paymentSelection !== 'cash') {
          const method = await tx.paymentMethod.findFirst({
            where: {
              id: paymentSelection,
              user_id: user.id,
              status: 'approved',
            },
            select: {
              type: true,
              account_name: true,
              account_number: true,
              bank_name: true,
            },
          })
          if (!method) throw new Error('POS_PAYMENT_INVALID')
          if (!paymentReference) throw new Error('POS_PAYMENT_REFERENCE_REQUIRED')
          paymentMethodId = paymentSelection
          const duplicateReference = await tx.posTransaction.findFirst({
            where: { owner_id: user.id, payment_method_id: paymentMethodId, payment_reference: paymentReference },
            select: { id: true },
          })
          if (duplicateReference) throw new Error('POS_PAYMENT_REFERENCE_DUPLICATE')
          paymentMethodSnapshot = `${method.type.toUpperCase()} · ${method.account_name} · ${method.account_number}${method.bank_name ? ` · ${method.bank_name}` : ''}`.slice(0, 120)
        }
        const requiresApproval = paymentSelection !== 'cash'

        const owner = await tx.user.findUnique({
          where: { id: user.id },
          select: {
            full_name: true,
            distributor_profile: {
              select: { dist_level: true, coverage_area: true },
            },
          },
        })
        const receiptParts = RECEIPT.exec(receiptNumber)
        if (!receiptParts || receiptParts[1] !== locationCode(owner?.distributor_profile?.coverage_area || owner?.full_name) || receiptParts[2] !== terminal.receipt_code || receiptParts[3] !== receiptDateCode(localCreatedAt) || Number(receiptParts[4]) !== receiptSequence) throw new Error('POS_RECEIPT_INVALID')
        const products = await tx.product.findMany({
          where: {
            id: { in: items.map((item) => item.product_id) },
            is_active: true,
          },
          select: {
            id: true,
            name: true,
            type: true,
            reseller_price: true,
            price: true,
            city_price: true,
            branch_price: true,
            cost_price: true,
            pu_value: true,
          },
        })
        if (products.length !== items.length) throw new Error('POS_PRODUCT_INVALID')
        const productMap = new Map(products.map((product) => [product.id, product]))
        const orderItems = items.map((item) => {
          const product = productMap.get(item.product_id)!
          const unitPrice = Number(customerType === 'member' ? product.reseller_price : product.price)
          const unitCost = Number(owner?.distributor_profile?.dist_level === 'branch' ? product.branch_price : product.city_price || product.cost_price)
          if (!Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(unitCost) || unitCost < 0) throw new Error('POS_PRICE_INVALID')
          return {
            product_id: item.product_id,
            quantity: item.quantity,
            unit_price: unitPrice,
            unit_acquisition_cost: unitCost,
            subtotal: unitPrice * item.quantity,
            product,
          }
        })
        const total = Math.round(orderItems.reduce((sum, item) => sum + item.subtotal, 0) * 100) / 100
        const effectiveReceived = paymentSelection === 'cash' ? amountReceived : total
        if (total <= 0 || effectiveReceived < total) throw new Error('POS_PAYMENT_SHORT')
        const change = Math.round((effectiveReceived - total) * 100) / 100

        await consumeAvailableStock(tx, user.id, orderItems)
        const stockAfter = new Map<string, number>()
        for (const item of orderItems) {
          const inventory = await tx.inventory.findUniqueOrThrow({
            where: {
              owner_id_product_id: {
                owner_id: user.id,
                product_id: item.product_id,
              },
            },
            select: { quantity: true },
          })
          stockAfter.set(item.product_id, inventory.quantity)
        }

        const order = await tx.order.create({
          data: {
            buyer_id: member?.id || user.id,
            seller_id: user.id,
            order_type: 'offline',
            status: requiresApproval ? 'processing' : 'delivered',
            total_amount: total,
            delivered_at: requiresApproval ? null : new Date(),
            is_non_member_sale: customerType === 'non_member',
            customer_name: member?.full_name || customerName || 'Walk-in Customer',
            payment_method: paymentMethodSnapshot,
            payment_status: requiresApproval ? 'pending_verification' : 'paid',
            paid_at: requiresApproval ? null : new Date(),
            payment_reference: paymentSelection === 'cash' ? `Cash received: ${effectiveReceived.toFixed(2)}; Change: ${change.toFixed(2)}` : paymentReference,
            notes,
            items: {
              create: orderItems.map((item) => ({
                product_id: item.product_id,
                quantity: item.quantity,
                unit_price: item.unit_price,
                unit_acquisition_cost: item.unit_acquisition_cost,
                subtotal: item.subtotal,
              })),
            },
          },
          select: { id: true, order_number: true },
        })

        const posTransaction = await tx.posTransaction.create({
          data: {
            client_transaction_id: clientTransactionId,
            receipt_number: receiptNumber,
            receipt_sequence: receiptSequence,
            owner_id: user.id,
            terminal_id: terminalId,
            shift_id: shiftId,
            cashier_id: actorId,
            payment_method_id: paymentMethodId,
            transaction_type: customerType === 'member' ? 'member_sale' : 'non_member_sale',
            status: requiresApproval ? 'synced_pending_review' : 'finalized',
            member_id: member?.id || null,
            customer_name_snapshot: member?.full_name || customerName || 'Walk-in Customer',
            payment_method_snapshot: paymentMethodSnapshot,
            payment_reference: paymentSelection === 'cash' ? null : paymentReference,
            subtotal_snapshot: total,
            total_snapshot: total,
            amount_received_snapshot: effectiveReceived,
            change_snapshot: change,
            order_id: order.id,
            notes,
            local_created_at: localCreatedAt,
            server_received_at: new Date(),
            finalized_at: requiresApproval ? null : new Date(),
            items: {
              create: orderItems.map((item) => ({
                product_id: item.product_id,
                product_name_snapshot: item.product.name,
                product_type_snapshot: item.product.type,
                quantity: item.quantity,
                unit_price_snapshot: item.unit_price,
                unit_cost_snapshot: item.unit_acquisition_cost,
                pu_value_snapshot: item.product.pu_value,
                subtotal_snapshot: item.subtotal,
                local_stock_before: (stockAfter.get(item.product_id) || 0) + item.quantity,
                local_stock_after: stockAfter.get(item.product_id) || 0,
              })),
            },
          },
          select: { id: true },
        })

        if (!requiresApproval) await recordInventoryOutEvents(tx, {
          ownerId: user.id,
          actorId,
          actorName: user.actor_name || user.full_name || user.username,
          eventType: customerType === 'member' ? 'pos_member_sale' : 'pos_non_member_sale',
          referenceType: 'order',
          referenceId: order.id,
          reason: customerType === 'member' ? `POS member sale to ${member?.full_name || member?.username}` : `POS non-member sale to ${customerName || 'Walk-in Customer'}`,
          items: orderItems.map((item) => ({
            product_id: item.product_id,
            quantity: item.quantity,
            unit_cost: item.unit_acquisition_cost,
          })),
          metadata: {
            client_transaction_id: clientTransactionId,
            terminal_id: terminalId,
            shift_id: shiftId,
            order_number: order.order_number,
          },
        })

        if (member && !requiresApproval) {
          for (const item of orderItems) {
            await tx.inventory.upsert({
              where: {
                owner_id_product_id: {
                  owner_id: member.id,
                  product_id: item.product_id,
                },
              },
              update: { quantity: { increment: item.quantity } },
              create: {
                owner_id: member.id,
                product_id: item.product_id,
                quantity: item.quantity,
                low_stock_threshold: 5,
              },
            })
          }
        }

        await tx.posSyncEvent.create({
          data: {
            terminal_id: terminalId,
            pos_transaction_id: posTransaction.id,
            event_type: requiresApproval ? 'online_pending_payment_review' : 'online_finalize',
            outcome: 'success',
            details: {
              client_transaction_id: clientTransactionId,
              order_id: order.id,
              captured_offline: capturedOffline,
            },
          },
        })
        await tx.posTerminal.update({
          where: { id: terminalId },
          data: { last_inventory_at: new Date(), last_synced_at: new Date() },
        })
        return { orderId: order.id, pendingReview: requiresApproval }
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 20_000,
      },
    )

    let rewardsPending = false
    if (customerType === 'member' && !result.pendingReview) {
      try {
        await processDeliveredProductBinaryOrder(result.orderId)
      } catch (error) {
        rewardsPending = true
        console.error('[POS PRODUCT BINARY]', error)
      }
    }

    const receipt = await receiptFor(clientTransactionId, user.id)
    if (!receipt) throw new Error('POS_RECEIPT_MISSING')
    const client = getClientInfo(req)
    createAuditLog({
      user_id: actorId,
      user_name: user.actor_name || user.full_name || user.username,
      user_role: user.is_staff ? 'staff' : user.role,
      activity_type: result.pendingReview ? 'pos_payment_submitted' : 'pos_sale_finalized',
      category: 'order',
      description: result.pendingReview ? `POS payment ${receipt.receipt_number} submitted for independent verification.` : `POS sale ${receipt.receipt_number} finalized.`,
      metadata: {
        client_transaction_id: clientTransactionId,
        order_id: receipt.order_id,
        total: receipt.total,
        rewards_pending: rewardsPending,
      },
      ...client,
    })
    return NextResponse.json({ receipt, replayed: false, rewards_pending: rewardsPending, payment_pending: result.pendingReview }, { status: 201 })
  } catch (error) {
    console.error('[POS FINALIZE]', error)
    const code = error instanceof Error ? error.message : ''
    if (code === 'POS_REPLAY' || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
      const receipt = await receiptFor(submittedClientTransactionId, user.id)
      if (receipt) return NextResponse.json({ receipt, replayed: true })
    }
    if (error instanceof InsufficientStockError)
      return NextResponse.json(
        {
          error: 'The available stock changed. Review the cart quantities and try again.',
          code: 'INSUFFICIENT_STOCK',
          product_id: error.productId,
        },
        { status: 409 },
      )
    const responses: Record<string, [string, number]> = {
      POS_ID_CONFLICT: ['That transaction identifier is already assigned to another location.', 409],
      POS_TERMINAL_INVALID: ['This POS terminal is inactive or no longer assigned to this location.', 403],
      POS_SHIFT_INVALID: ['Your cashier shift is no longer open. Refresh the POS before accepting another sale.', 409],
      POS_RECEIPT_INVALID: ['The permanent receipt number does not belong to this POS terminal.', 409],
      POS_RECEIPT_UNRESERVED: ['This receipt sequence was not reserved for this POS terminal. Reconnect and refresh before accepting another sale.', 409],
      POS_MEMBER_INVALID: ['The selected member is inactive or no longer valid. Verify the member again.', 409],
      POS_PAYMENT_INVALID: ['The selected payment method is no longer available.', 409],
      POS_PAYMENT_REFERENCE_REQUIRED: ['Enter the payment reference before completing this non-cash sale.', 400],
      POS_PAYMENT_REFERENCE_DUPLICATE: ['That payment reference was already used for this receiving account. Verify the reference before trying again.', 409],
      POS_PRODUCT_INVALID: ['One or more products are no longer available.', 409],
      POS_PRICE_INVALID: ['An official product price is invalid. Ask an administrator to review the catalog.', 409],
      POS_PAYMENT_SHORT: ['The received amount is lower than the official order total.', 400],
    }
    const response = responses[code]
    return NextResponse.json(
      {
        error: response?.[0] || 'The sale could not be completed safely. No stock was changed.',
      },
      { status: response?.[1] || 500 },
    )
  }
}
