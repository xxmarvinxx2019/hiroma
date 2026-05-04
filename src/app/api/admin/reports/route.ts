import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const [
      // Network
      totalResellers,
      activeResellers,
      suspendedResellers,
      regionalCount,
      provincialCount,
      cityCount,

      // Financial
      walletStats,
      pendingPayouts,
      pendingPayoutsAmount,
      pinRevenue,
      commissionsPaid,

      // MLM
      totalCommissions,
      directReferralCount,
      binaryPairingCount,
      multilevelCount,
      sponsorPointCount,
      totalPointsEarned,
      totalOverflowCount,

      // Catalog
      totalProducts,
      physicalProducts,
      digitalProducts,
      totalPackages,
      totalPinsGenerated,
      unusedPins,
      usedPins,
    ] = await Promise.all([
      // Network
      prisma.user.count({ where: { role: 'reseller' } }),
      prisma.user.count({ where: { role: 'reseller', status: 'active' } }),
      prisma.user.count({ where: { role: 'reseller', status: 'suspended' } }),
      prisma.user.count({ where: { role: 'regional' } }),
      prisma.user.count({ where: { role: 'provincial' } }),
      prisma.user.count({ where: { role: 'city' } }),

      // Financial
      prisma.wallet.aggregate({
        _sum: { balance: true, total_earned: true, total_withdrawn: true },
      }),
      prisma.payout.count({ where: { status: 'pending' } }),
      prisma.payout.aggregate({
        where: { status: 'pending' },
        _sum: { amount: true },
      }),
      prisma.order.aggregate({
        where: { notes: { contains: 'PIN sale' } },
        _sum: { total_amount: true },
      }),
      prisma.commission.aggregate({
        _sum: { amount: true },
      }),

      // MLM
      prisma.commission.count(),
      prisma.commission.count({ where: { type: 'direct_referral' } }),
      prisma.commission.count({ where: { type: 'binary_pairing' } }),
      prisma.commission.count({ where: { type: 'multilevel' } }),
      prisma.commission.count({ where: { type: 'sponsor_point' } }),
      prisma.commission.aggregate({ _sum: { points: true } }),
      prisma.commission.count({ where: { is_pair_overflow: true } }),

      // Catalog
      prisma.product.count({ where: { is_active: true } }),
      prisma.product.count({ where: { is_active: true, type: 'physical' } }),
      prisma.product.count({ where: { is_active: true, type: 'digital' } }),
      prisma.package.count({ where: { is_active: true } }),
      prisma.pin.count(),
      prisma.pin.count({ where: { status: 'unused' } }),
      prisma.pin.count({ where: { status: 'used' } }),
    ])

    return NextResponse.json({
      report: {
        network: {
          totalResellers,
          activeResellers,
          suspendedResellers,
          totalDistributors: regionalCount + provincialCount + cityCount,
          regionalCount,
          provincialCount,
          cityCount,
        },
        financial: {
          totalWalletBalance: Number(walletStats._sum.balance || 0),
          totalEarned: Number(walletStats._sum.total_earned || 0),
          totalWithdrawn: Number(walletStats._sum.total_withdrawn || 0),
          totalPendingPayouts: pendingPayouts,
          totalPendingAmount: Number(pendingPayoutsAmount._sum.amount || 0),
          totalPinRevenue: Number(pinRevenue._sum.total_amount || 0),
          totalCommissionsPaid: Number(commissionsPaid._sum.amount || 0),
        },
        mlm: {
          totalCommissions,
          directReferralCount,
          binaryPairingCount,
          multilevelCount,
          sponsorPointCount,
          totalPointsEarned: Number(totalPointsEarned._sum.points || 0),
          totalOverflowCount,
        },
        catalog: {
          totalProducts,
          physicalProducts,
          digitalProducts,
          totalPackages,
          totalPinsGenerated,
          unusedPins,
          usedPins,
        },
      },
    })
  } catch (error) {
    console.error('[REPORTS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}