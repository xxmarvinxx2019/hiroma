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
      return NextResponse.json(
        { error: 'Username is required.' },
        { status: 400 }
      )
    }

    const cleanUsername = username.trim().toLowerCase()

    // ── Find referrer ──
    const referrer = await prisma.user.findUnique({
      where: { username: cleanUsername },
      select: {
        id: true,
        full_name: true,
        username: true,
        status: true,
        role: true,
        reseller_profile: {
          select: {
            daily_referral_count: true,
            last_referral_date: true,
            package: { select: { name: true } },
          },
        },
      },
    })

    if (!referrer) {
      return NextResponse.json(
        { error: 'Username not found. Please check and try again.' },
        { status: 404 }
      )
    }

    const isHiromaNode = referrer.username === 'hiroma'
    const isReseller = referrer.role === 'reseller'

    if (!isReseller && !isHiromaNode) {
      return NextResponse.json(
        { error: 'This account is not a valid referrer.' },
        { status: 400 }
      )
    }

    if (referrer.status !== 'active') {
      return NextResponse.json(
        { error: 'This referrer account is not active.' },
        { status: 400 }
      )
    }

    // ── Find binary tree node — THIS is what was missing ──
    const node = await prisma.binaryTreeNode.findUnique({
      where: { user_id: referrer.id },
      select: { id: true },
    })

    if (!node) {
      return NextResponse.json(
        { error: 'This referrer has no binary tree node. Please contact admin.' },
        { status: 400 }
      )
    }

    // ── Check direct leg availability ──
    const leftChild = await prisma.binaryTreeNode.findFirst({
      where: { parent_id: node.id, position: 'left' },
      select: { id: true },
    })

    const rightChild = await prisma.binaryTreeNode.findFirst({
      where: { parent_id: node.id, position: 'right' },
      select: { id: true },
    })

    const leftIsDirect = !leftChild
    const rightIsDirect = !rightChild

    // ── Check if any space exists deeper ──
    // For left: if occupied, check if the left subtree has any open slot
    let leftAvailable = leftIsDirect
    let rightAvailable = rightIsDirect

    if (!leftIsDirect && leftChild) {
      // Check if there's any open slot in the left subtree (BFS check)
      leftAvailable = await hasOpenSlot(leftChild.id)
    }

    if (!rightIsDirect && rightChild) {
      rightAvailable = await hasOpenSlot(rightChild.id)
    }

    if (!leftAvailable && !rightAvailable) {
      return NextResponse.json(
        { error: 'Both legs of this referrer are completely full. Please use a different referrer.' },
        { status: 400 }
      )
    }

    // ── Daily referral cap check ──
    let dailyCount = 0
    let dailyCapReached = false

    if (isReseller && referrer.reseller_profile) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const lastDate = referrer.reseller_profile.last_referral_date
      const isToday = lastDate ? new Date(lastDate) >= today : false
      dailyCount = isToday ? (referrer.reseller_profile.daily_referral_count || 0) : 0
      dailyCapReached = dailyCount >= 10
    }

    return NextResponse.json({
      reseller: {
        id: referrer.id,
        full_name: isHiromaNode ? 'Hiroma (Top node)' : referrer.full_name,
        username: referrer.username,
        package: isHiromaNode ? 'N/A' : (referrer.reseller_profile?.package?.name || '—'),
        is_hiroma_node: isHiromaNode,
        daily_referral_count: dailyCount,
        daily_cap_reached: dailyCapReached,
        left_available: leftAvailable,
        right_available: rightAvailable,
        left_is_direct: leftIsDirect,
        right_is_direct: rightIsDirect,
        // ✅ node_id is now returned — needed for tree-nodes API
        node_id: node.id,
      },
    })
  } catch (error) {
    console.error('[VERIFY REFERRAL ERROR]', error)
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}

// ── Helper: check if any open slot exists in a subtree ──
async function hasOpenSlot(nodeId: string): Promise<boolean> {
  const queue: string[] = [nodeId]

  while (queue.length > 0) {
    const current = queue.shift()!

    const left = await prisma.binaryTreeNode.findFirst({
      where: { parent_id: current, position: 'left' },
      select: { id: true },
    })

    const right = await prisma.binaryTreeNode.findFirst({
      where: { parent_id: current, position: 'right' },
      select: { id: true },
    })

    if (!left || !right) return true // open slot found

    queue.push(left.id)
    queue.push(right.id)
  }

  return false
}