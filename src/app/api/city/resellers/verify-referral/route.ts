import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

type SubtreeNode = {
  id: string
  user_id: string
}

export async function POST(req: NextRequest) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser || !['city', 'admin'].includes(currentUser.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { username } = await req.json()
    if (!username) {
      return NextResponse.json({ error: 'Username is required.' }, { status: 400 })
    }

    const cleanUsername = String(username).trim().toLowerCase()
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
            package: { select: { id: true, name: true } },
          },
        },
        binary_tree_node: { select: { id: true } },
      },
    })

    if (!referrer) {
      return NextResponse.json({ error: 'Username not found. Please check and try again.' }, { status: 404 })
    }

    const isHiromaNode = referrer.username === 'hiroma'
    const isReseller = referrer.role === 'reseller'
    if (!isReseller && !isHiromaNode) {
      return NextResponse.json({ error: 'This account is not a valid referrer.' }, { status: 400 })
    }
    if (referrer.status !== 'active') {
      return NextResponse.json({ error: 'This referrer account is not active.' }, { status: 400 })
    }

    const node = referrer.binary_tree_node
    if (!node) {
      return NextResponse.json({ error: 'This referrer has no binary tree node. Please contact admin.' }, { status: 400 })
    }

    // One recursive query gets the whole subtree. The previous implementation
    // scanned nodes one by one, then repeated the same work in a second request.
    const subtreeNodes = await prisma.$queryRaw<SubtreeNode[]>`
      WITH RECURSIVE subtree AS (
        SELECT id, user_id
        FROM binary_tree_nodes
        WHERE id = ${node.id}

        UNION ALL

        SELECT n.id, n.user_id
        FROM binary_tree_nodes n
        INNER JOIN subtree s ON n.parent_id = s.id
      )
      SELECT id, user_id FROM subtree
    `

    const nodeIds = subtreeNodes.map((item) => item.id)
    const nodeUserIds = subtreeNodes.map((item) => item.user_id)
    const capPromise = isReseller && referrer.reseller_profile
      ? prisma.$queryRaw<{ enabled: boolean; cap: number }[]>`
          SELECT COALESCE(direct_referral_cap_enabled, true) AS enabled,
                 COALESCE(daily_referral_cap, 10)::int AS cap
          FROM packages
          WHERE id = ${referrer.reseller_profile.package.id}
        `
      : Promise.resolve([] as { enabled: boolean; cap: number }[])

    const [existingChildren, users, capRows] = await Promise.all([
      prisma.binaryTreeNode.findMany({
        where: { parent_id: { in: nodeIds } },
        select: { parent_id: true, position: true },
      }),
      prisma.user.findMany({
        where: { id: { in: nodeUserIds } },
        select: {
          id: true,
          full_name: true,
          username: true,
          reseller_profile: { select: { package: { select: { name: true } } } },
        },
      }),
      capPromise,
    ])

    const takenSlots = new Map<string, Set<string>>()
    for (const child of existingChildren) {
      if (!child.parent_id) continue
      if (!takenSlots.has(child.parent_id)) takenSlots.set(child.parent_id, new Set())
      takenSlots.get(child.parent_id)!.add(child.position)
    }

    const userMap = new Map(users.map((item) => [item.id, item]))
    const slots = subtreeNodes.flatMap((subtreeNode) => {
      const userData = userMap.get(subtreeNode.user_id)
      if (!userData) return []
      const taken = takenSlots.get(subtreeNode.id) || new Set<string>()
      const leftOpen = !taken.has('left')
      const rightOpen = !taken.has('right')
      if (!leftOpen && !rightOpen) return []
      return [{
        node_id: subtreeNode.id,
        user_id: subtreeNode.user_id,
        full_name: userData.full_name,
        username: userData.username,
        package: userData.reseller_profile?.package?.name || '—',
        left_open: leftOpen,
        right_open: rightOpen,
      }]
    })

    if (slots.length === 0) {
      return NextResponse.json({ error: 'Both legs of this referrer are completely full. Please use a different referrer.' }, { status: 400 })
    }

    let dailyCount = 0
    let dailyCapReached = false
    if (isReseller && referrer.reseller_profile) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const lastDate = referrer.reseller_profile.last_referral_date
      const isToday = lastDate ? new Date(lastDate) >= today : false
      dailyCount = isToday ? (referrer.reseller_profile.daily_referral_count || 0) : 0
      const capConfig = capRows[0]
      dailyCapReached = Boolean(capConfig?.enabled) && dailyCount >= Number(capConfig?.cap || 10)
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
        node_id: node.id,
      },
      slots,
    })
  } catch (error) {
    console.error('[VERIFY REFERRAL ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}