import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || !['city', 'admin'].includes(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const referrerUsername = searchParams.get('referrer') || ''

    if (!referrerUsername) {
      return NextResponse.json({ slots: [] })
    }

    // Find referrer
    const referrer = await prisma.user.findUnique({
      where:  { username: referrerUsername.trim().toLowerCase() },
      select: { id: true, full_name: true, username: true },
    })

    if (!referrer) {
      return NextResponse.json({ error: 'Referrer not found.' }, { status: 404 })
    }

    // Find referrer's binary tree node
    const referrerNode = await prisma.binaryTreeNode.findUnique({
      where:  { user_id: referrer.id },
      select: { id: true },
    })

    if (!referrerNode) {
      return NextResponse.json({ error: 'Referrer has no binary tree node.' }, { status: 404 })
    }

    // Get entire subtree of referrer using recursive CTE
    // Including referrer's own node
    const subtreeNodes = await prisma.$queryRaw<{
      id:         string
      user_id:    string
      parent_id:  string | null
      left_count: number
      right_count: number
    }[]>`
      WITH RECURSIVE subtree AS (
        SELECT id, user_id, parent_id, left_count, right_count
        FROM binary_tree_nodes
        WHERE id = ${referrerNode.id}

        UNION ALL

        SELECT n.id, n.user_id, n.parent_id, n.left_count, n.right_count
        FROM binary_tree_nodes n
        INNER JOIN subtree s ON n.parent_id = s.id
      )
      SELECT id, user_id, parent_id, left_count, right_count FROM subtree
    `

    if (!subtreeNodes || subtreeNodes.length === 0) {
      return NextResponse.json({ slots: [] })
    }

    // For each node check which slots are available
    const nodeIds    = subtreeNodes.map((n) => n.id)
    const nodeUserIds = subtreeNodes.map((n) => n.user_id)

    // Get existing children for all nodes in one query
    const existingChildren = await prisma.binaryTreeNode.findMany({
      where:  { parent_id: { in: nodeIds } },
      select: { parent_id: true, position: true },
    })

    // Build map of taken slots per node
    const takenSlots = new Map<string, Set<string>>()
    for (const child of existingChildren) {
      if (!child.parent_id) continue
      if (!takenSlots.has(child.parent_id)) takenSlots.set(child.parent_id, new Set())
      takenSlots.get(child.parent_id)!.add(child.position)
    }

    // Get user details for all nodes
    const users = await prisma.user.findMany({
      where:  { id: { in: nodeUserIds } },
      select: {
        id:        true,
        full_name: true,
        username:  true,
        reseller_profile: { select: { package: { select: { name: true } } } },
      },
    })
    const userMap = new Map(users.map((u) => [u.id, u]))

    // Build available slots list
    const slots: {
      node_id:    string
      user_id:    string
      full_name:  string
      username:   string
      package:    string
      left_open:  boolean
      right_open: boolean
    }[] = []

    for (const node of subtreeNodes) {
      const taken     = takenSlots.get(node.id) || new Set()
      const leftOpen  = !taken.has('left')
      const rightOpen = !taken.has('right')

      if (!leftOpen && !rightOpen) continue // both slots full — skip

      const userData = userMap.get(node.user_id)
      if (!userData) continue

      slots.push({
        node_id:   node.id,
        user_id:   node.user_id,
        full_name: userData.full_name,
        username:  userData.username,
        package:   userData.reseller_profile?.package?.name || '—',
        left_open:  leftOpen,
        right_open: rightOpen,
      })
    }

    // Sort by level (BFS order — closer to root first)
    // Nodes closer to referrer appear first
    return NextResponse.json({ slots, referrer })
  } catch (error) {
    console.error('[AVAILABLE SLOTS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}