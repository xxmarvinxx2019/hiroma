import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

type SearchResult = {
  id: string
  title: string
  description: string
  href: string
  category: 'Order' | 'Commission' | 'Affiliate' | 'Payout' | 'Wallet'
}

const COMMISSION_LABELS: Record<string, string> = {
  direct_referral: 'Direct Referral',
  binary_pairing: 'Binary Pairing',
  sponsor_point: 'Product Binary',
  multilevel: 'Multilevel Commission',
}

const money = (value: unknown) =>
  `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const query = (req.nextUrl.searchParams.get('q') || '').trim()
    if (query.length < 2) return NextResponse.json({ results: [] })

    const normalized = query.toLowerCase()
    const numericQuery = Number(query.replace(/[₱,\s]/g, ''))
    const hasNumericQuery = Number.isFinite(numericQuery) && query.replace(/[₱,\s.]/g, '').length > 0
    const orderStatuses = ['pending', 'processing', 'delivered', 'cancelled']
    const payoutStatuses = ['pending', 'approved', 'rejected', 'released']
    const matchingCommissionTypes = Object.entries(COMMISSION_LABELS)
      .filter(([type, label]) => `${type} ${label}`.toLowerCase().includes(normalized))
      .map(([type]) => type)

    const [wallet, orders, commissions, payouts, myNode] = await Promise.all([
      prisma.wallet.findUnique({
        where: { user_id: user.id },
        select: { balance: true, total_earned: true, total_withdrawn: true },
      }),
      prisma.order.findMany({
        where: {
          buyer_id: user.id,
          OR: [
            { order_number: { contains: query, mode: 'insensitive' } },
            { payment_method: { contains: query, mode: 'insensitive' } },
            { payment_status: { contains: query, mode: 'insensitive' } },
            { notes: { contains: query, mode: 'insensitive' } },
            { seller: { full_name: { contains: query, mode: 'insensitive' } } },
            { seller: { username: { contains: query, mode: 'insensitive' } } },
            { items: { some: { product: { name: { contains: query, mode: 'insensitive' } } } } },
            ...(orderStatuses.includes(normalized) ? [{ status: normalized as never }] : []),
            ...(hasNumericQuery ? [{ total_amount: numericQuery }] : []),
          ],
        },
        orderBy: { created_at: 'desc' },
        take: 6,
        select: {
          id: true,
          order_number: true,
          status: true,
          payment_method: true,
          total_amount: true,
          seller: { select: { full_name: true, username: true } },
        },
      }),
      prisma.commission.findMany({
        where: {
          user_id: user.id,
          OR: [
            { source_user: { full_name: { contains: query, mode: 'insensitive' } } },
            { source_user: { username: { contains: query, mode: 'insensitive' } } },
            ...(matchingCommissionTypes.length ? [{ type: { in: matchingCommissionTypes as never[] } }] : []),
            ...(hasNumericQuery ? [{ amount: numericQuery }] : []),
          ],
        },
        orderBy: { created_at: 'desc' },
        take: 6,
        select: {
          id: true,
          type: true,
          amount: true,
          points: true,
          source_user: { select: { full_name: true, username: true } },
        },
      }),
      prisma.payout.findMany({
        where: {
          user_id: user.id,
          OR: [
            { payment_method: { contains: query, mode: 'insensitive' } },
            { payment_reference: { contains: query, mode: 'insensitive' } },
            { transaction_number: { contains: query, mode: 'insensitive' } },
            { notes: { contains: query, mode: 'insensitive' } },
            ...(payoutStatuses.includes(normalized) ? [{ status: normalized as never }] : []),
            ...(hasNumericQuery ? [{ amount: numericQuery }] : []),
          ],
        },
        orderBy: { requested_at: 'desc' },
        take: 5,
        select: {
          id: true,
          amount: true,
          status: true,
          payment_method: true,
          transaction_number: true,
        },
      }),
      prisma.binaryTreeNode.findUnique({
        where: { user_id: user.id },
        select: { id: true },
      }),
    ])

    const affiliateResults: SearchResult[] = []
    if (myNode) {
      const descendantNodeIds: string[] = []
      const queue = [myNode.id]
      while (queue.length && descendantNodeIds.length < 5000) {
        const batch = queue.splice(0, 100)
        const children = await prisma.binaryTreeNode.findMany({
          where: { parent_id: { in: batch } },
          select: { id: true },
        })
        for (const child of children) {
          descendantNodeIds.push(child.id)
          queue.push(child.id)
        }
      }

      if (descendantNodeIds.length) {
        const affiliates = await prisma.binaryTreeNode.findMany({
          where: {
            id: { in: descendantNodeIds },
            user: {
              OR: [
                { full_name: { contains: query, mode: 'insensitive' } },
                { username: { contains: query, mode: 'insensitive' } },
                { reseller_profile: { package: { name: { contains: query, mode: 'insensitive' } } } },
              ],
            },
          },
          take: 6,
          select: {
            id: true,
            position: true,
            user: {
              select: {
                full_name: true,
                username: true,
                reseller_profile: { select: { package: { select: { name: true } } } },
              },
            },
          },
        })
        affiliateResults.push(...affiliates.map((node) => ({
          id: `affiliate-${node.id}`,
          title: node.user.full_name,
          description: `@${node.user.username} · ${node.user.reseller_profile?.package.name || 'Reseller'} · ${node.position || 'affiliate'}`,
          href: `/dashboard/reseller/genealogy?search=${encodeURIComponent(node.user.username)}`,
          category: 'Affiliate' as const,
        })))
      }
    }

    const results: SearchResult[] = [
      ...orders.map((order) => ({
        id: `order-${order.id}`,
        title: order.order_number || `Order from ${order.seller.full_name}`,
        description: `${order.seller.full_name} · ${order.payment_method || 'Payment'} · ${order.status} · ${money(order.total_amount)}`,
        href: `/dashboard/reseller/orders?search=${encodeURIComponent(query)}`,
        category: 'Order' as const,
      })),
      ...commissions.map((commission) => ({
        id: `commission-${commission.id}`,
        title: COMMISSION_LABELS[commission.type] || commission.type,
        description: `${commission.source_user?.full_name || 'Hiroma'} · ${money(commission.amount)}${commission.points ? ` · ${commission.points} pts` : ''}`,
        href: `/dashboard/reseller/wallet?tab=commissions&search=${encodeURIComponent(query)}`,
        category: 'Commission' as const,
      })),
      ...affiliateResults,
      ...payouts.map((payout) => ({
        id: `payout-${payout.id}`,
        title: `Payout ${payout.status}`,
        description: `${money(payout.amount)} · ${payout.payment_method || 'Payment method'}${payout.transaction_number ? ` · ${payout.transaction_number}` : ''}`,
        href: `/dashboard/reseller/payouts?search=${encodeURIComponent(query)}`,
        category: 'Payout' as const,
      })),
    ]

    const walletText = wallet
      ? `wallet available balance ${money(wallet.balance)} total earned ${money(wallet.total_earned)} total withdrawn ${money(wallet.total_withdrawn)}`
      : ''
    if (wallet && walletText.toLowerCase().includes(normalized)) {
      results.unshift({
        id: 'wallet-summary',
        title: 'Wallet & Earnings',
        description: `Balance ${money(wallet.balance)} · Earned ${money(wallet.total_earned)} · Withdrawn ${money(wallet.total_withdrawn)}`,
        href: '/dashboard/reseller/wallet',
        category: 'Wallet',
      })
    }

    return NextResponse.json({ results: results.slice(0, 18) })
  } catch (error) {
    console.error('[RESELLER GLOBAL SEARCH ERROR]', error)
    return NextResponse.json({ error: 'Unable to search right now.' }, { status: 500 })
  }
}
