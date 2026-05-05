import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { username } = await req.json()

    if (!username) {
      return NextResponse.json({ error: 'Username is required.' }, { status: 400 })
    }

    const reseller = await prisma.user.findUnique({
      where: { username: username.trim().toLowerCase() },
      select: {
        id: true,
        full_name: true,
        username: true,
        status: true,
        role: true,
        reseller_profile: {
          select: {
            package: { select: { name: true } },
            daily_referral_count: true,
          },
        },
        binary_tree_node: {
          select: {
            id: true,
            left_count: true,
            right_count: true,
          },
        },
      },
    })

    if (!reseller) {
      return NextResponse.json({ error: 'Reseller not found. Check the username and try again.' }, { status: 404 })
    }

    if (reseller.role !== 'reseller') {
      return NextResponse.json({ error: 'This account is not a reseller.' }, { status: 400 })
    }

    if (reseller.status !== 'active') {
      return NextResponse.json({ error: 'This reseller account is not active.' }, { status: 400 })
    }

    // ── Check available legs ──
    const node = reseller.binary_tree_node
    const leftOccupied = node ? await prisma.binaryTreeNode.findFirst({
      where: { parent_id: node.id, position: 'left' },
    }) : null
    const rightOccupied = node ? await prisma.binaryTreeNode.findFirst({
      where: { parent_id: node.id, position: 'right' },
    }) : null

    return NextResponse.json({
      reseller: {
        id: reseller.id,
        full_name: reseller.full_name,
        username: reseller.username,
        package: reseller.reseller_profile?.package?.name,
        daily_referral_count: reseller.reseller_profile?.daily_referral_count || 0,
        left_available: !leftOccupied,
        right_available: !rightOccupied,
      },
    })
  } catch (error) {
    console.error('[VERIFY REFERRAL ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}