import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ============================================================
// HELPER: Find the next available node in a given direction
// Uses BFS (breadth-first) to find the shallowest open slot
// in the chosen leg direction under the referrer
// ============================================================

async function findAvailableSlot(
  startNodeId: string,
  direction: 'left' | 'right'
): Promise<{ parentId: string; position: 'left' | 'right'; depth: number } | null> {
  // BFS queue — starts with the chosen leg direction
  const queue: { nodeId: string; depth: number }[] = [{ nodeId: startNodeId, depth: 0 }]

  while (queue.length > 0) {
    const { nodeId, depth } = queue.shift()!

    // Check left slot
    const leftChild = await prisma.binaryTreeNode.findFirst({
      where: { parent_id: nodeId, position: 'left' },
      select: { id: true },
    })

    // Check right slot
    const rightChild = await prisma.binaryTreeNode.findFirst({
      where: { parent_id: nodeId, position: 'right' },
      select: { id: true },
    })

    // If left is open → available slot found
    if (!leftChild) {
      return { parentId: nodeId, position: 'left', depth }
    }

    // If right is open → available slot found
    if (!rightChild) {
      return { parentId: nodeId, position: 'right', depth }
    }

    // Both occupied → go deeper into both children
    if (leftChild) queue.push({ nodeId: leftChild.id, depth: depth + 1 })
    if (rightChild) queue.push({ nodeId: rightChild.id, depth: depth + 1 })
  }

  return null // tree is completely full (shouldn't happen)
}

// ============================================================
// POST /api/city/resellers/verify-referral
// ============================================================

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { username, placement } = await req.json()

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

    // ── Allow reseller OR hiroma top node ──
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

    // ── Find referrer's binary tree node ──
    const referrerNode = await prisma.binaryTreeNode.findUnique({
      where: { user_id: referrer.id },
      select: { id: true, left_count: true, right_count: true },
    })

    if (!referrerNode) {
      return NextResponse.json(
        { error: 'This referrer has no binary tree node. Please contact admin.' },
        { status: 400 }
      )
    }

    // ── Check direct legs ──
    const directLeftChild = await prisma.binaryTreeNode.findFirst({
      where: { parent_id: referrerNode.id, position: 'left' },
      select: { id: true, user_id: true },
    })

    const directRightChild = await prisma.binaryTreeNode.findFirst({
      where: { parent_id: referrerNode.id, position: 'right' },
      select: { id: true, user_id: true },
    })

    const directLeftAvailable = !directLeftChild
    const directRightAvailable = !directRightChild

    // ── If placement is provided, find the actual slot ──
    let leftSlot = null
    let rightSlot = null

    if (directLeftAvailable) {
      leftSlot = { parentId: referrerNode.id, position: 'left', depth: 0, direct: true }
    } else {
      // Go deeper into left leg
      const slot = await findAvailableSlot(directLeftChild!.id, 'left')
      if (slot) leftSlot = { ...slot, direct: false }
    }

    if (directRightAvailable) {
      rightSlot = { parentId: referrerNode.id, position: 'right', depth: 0, direct: true }
    } else {
      // Go deeper into right leg
      const slot = await findAvailableSlot(directRightChild!.id, 'right')
      if (slot) rightSlot = { ...slot, direct: false }
    }

    // ── Daily referral cap check (resellers only) ──
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
        // Direct leg availability
        left_available: !!leftSlot,
        right_available: !!rightSlot,
        // Direct or deep placement info
        left_is_direct: directLeftAvailable,
        right_is_direct: directRightAvailable,
        // Slot details for registration
        left_slot: leftSlot,
        right_slot: rightSlot,
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