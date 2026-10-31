import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { getPackageRewardWallet } from '@/app/lib/packageBinaryReward'

export async function GET() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'reseller') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    // Policy, progress and earned credits must describe one consistent snapshot.
    const wallet = await prisma.$transaction(tx => getPackageRewardWallet(tx, user.id), { isolationLevel: 'RepeatableRead' })
    return NextResponse.json(wallet, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('[PRODUCT REWARDS]', error)
    return NextResponse.json({ error: 'Unable to load product rewards.' }, { status: 500 })
  }
}
