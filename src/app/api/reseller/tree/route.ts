import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ============================================================
// FETCH SUBTREE USING RECURSIVE CTE — single query
// ============================================================

async function fetchSubtree(rootNodeId: string, maxDepth: number) {
  const nodes = await prisma.$queryRaw<{
    id: string
    user_id: string
    parent_id: string | null
    position: string | null
    depth: number
    username: string
    full_name: string
    package_name: string | null
  }[]>`
    WITH RECURSIVE subtree AS (
      SELECT
        n.id, n.user_id, n.parent_id, n.position,
        u.username, u.full_name,
        p.name AS package_name,
        0 AS depth
      FROM binary_tree_nodes n
      JOIN users u ON u.id = n.user_id
      LEFT JOIN reseller_profiles rp ON rp.user_id = n.user_id
      LEFT JOIN packages p ON p.id = rp.package_id
      WHERE n.id = ${rootNodeId}

      UNION ALL

      SELECT
        n.id, n.user_id, n.parent_id, n.position,
        u.username, u.full_name,
        p.name AS package_name,
        s.depth + 1
      FROM binary_tree_nodes n
      JOIN users u ON u.id = n.user_id
      LEFT JOIN reseller_profiles rp ON rp.user_id = n.user_id
      LEFT JOIN packages p ON p.id = rp.package_id
      JOIN subtree s ON n.parent_id = s.id
      WHERE s.depth < ${maxDepth}
    )
    SELECT * FROM subtree
  `
  return nodes
}

interface TreeNode {
  id: string
  user_id: string
  username: string
  full_name: string
  package_name: string | null
  position: string | null
  left_child: TreeNode | null
  right_child: TreeNode | null
  depth: number
  is_self: boolean
  direct_referral_earned: number
  binary_pairing_earned:  number
  product_points_earned:  number
  total_earned:           number
  left_count:              number
  right_count:             number
  pairing_bonus_value:     number
  pending_pairing_balance: number
  left_points:             number
  right_points:            number
}

function buildTreeFromNodes(
  nodes: { id: string; user_id: string; parent_id: string | null; position: string | null; depth: number; username: string; full_name: string; package_name: string | null }[],
  rootId: string,
  selfUserId: string,
  commissionMap: Map<string, { direct: number; pairing: number; points: number; total: number }>,
  countMap: Map<string, { left: number; right: number }>,
  profileMap: Map<string, { pairing_bonus_value: number; pending_pairing_balance: number; left_points: number; right_points: number }>
): TreeNode | null {
  const node = nodes.find((n) => n.id === rootId)
  if (!node) return null

  const leftChild   = nodes.find((n) => n.parent_id === rootId && n.position === 'left')
  const rightChild  = nodes.find((n) => n.parent_id === rootId && n.position === 'right')
  const commissions = commissionMap.get(node.user_id) || { direct: 0, pairing: 0, points: 0, total: 0 }
  const counts      = countMap.get(node.id) || { left: 0, right: 0 }

  return {
    id:           node.id,
    user_id:      node.user_id,
    username:     node.username,
    full_name:    node.full_name,
    package_name: node.package_name,
    position:     node.position,
    is_self:      node.user_id === selfUserId,
    depth:        node.depth,
    left_child:   leftChild  ? buildTreeFromNodes(nodes, leftChild.id,  selfUserId, commissionMap, countMap, profileMap) : null,
    right_child:  rightChild ? buildTreeFromNodes(nodes, rightChild.id, selfUserId, commissionMap, countMap, profileMap) : null,
    direct_referral_earned: commissions.direct,
    binary_pairing_earned:  commissions.pairing,
    product_points_earned:  commissions.points,
    total_earned:           commissions.total,
    left_count:              counts.left,
    right_count:             counts.right,
    pairing_bonus_value:     profileMap.get(node.user_id)?.pairing_bonus_value     || 0,
    pending_pairing_balance: profileMap.get(node.user_id)?.pending_pairing_balance || 0,
    left_points:             profileMap.get(node.user_id)?.left_points             || 0,
    right_points:            profileMap.get(node.user_id)?.right_points            || 0,
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const maxDepth    = Math.min(parseInt(searchParams.get('depth') || '4'), 20)
    const rootUserId  = searchParams.get('root_user_id') || null

    const myNode = await prisma.binaryTreeNode.findUnique({
      where:  { user_id: user.id },
      select: {
        id: true, position: true, left_count: true, right_count: true,
        sponsor: { select: { username: true, full_name: true } },
        parent:  { select: { id: true, user: { select: { username: true, full_name: true } } } },
      },
    })

    if (!myNode) {
      return NextResponse.json({ error: 'Tree node not found.' }, { status: 404 })
    }

    const [myCommissions, myWallet, myProfile] = await Promise.all([
      prisma.commission.groupBy({
        by:    ['type'],
        where: { user_id: user.id },
        _sum:  { amount: true },
      }),
      prisma.wallet.findUnique({
        where:  { user_id: user.id },
        select: { balance: true, total_earned: true, total_withdrawn: true },
      }),
      prisma.resellerProfile.findUnique({
        where:  { user_id: user.id },
        select: {
          total_points:            true,
          pending_pairing_balance: true,
          daily_referral_count:    true,
          package: { select: { name: true } },
        },
      }),
    ])

    const selfCommissions = { direct: 0, pairing: 0, points: 0, total: 0 }
    for (const c of myCommissions) {
      const amount = Number(c._sum.amount || 0)
      if (c.type === 'direct_referral') selfCommissions.direct  += amount
      if (c.type === 'binary_pairing')  selfCommissions.pairing += amount
      if (c.type === 'sponsor_point')   selfCommissions.points  += amount
      selfCommissions.total += amount
    }

    // If navigating to another node, find that node's tree root
    let rootNodeId = myNode.id
    if (rootUserId && rootUserId !== user.id) {
      const rootNode = await prisma.binaryTreeNode.findUnique({
        where:  { user_id: rootUserId },
        select: { id: true },
      })
      if (rootNode) rootNodeId = rootNode.id
    }

    const allNodes = await fetchSubtree(rootNodeId, maxDepth)
    const userIds  = allNodes.map((n) => n.user_id)
    const nodeIds  = allNodes.map((n) => n.id)

    // Fetch pairing bonus values and pending balances for all nodes
    const resellerProfiles = await prisma.resellerProfile.findMany({
      where:  { user_id: { in: userIds } },
      select: {
        user_id:                 true,
        pending_pairing_balance: true,
        left_points:             true,
        right_points:            true,
        package: { select: { pairing_bonus_value: true } },
      },
    })
    const profileMap = new Map(
      resellerProfiles.map((p) => [p.user_id, {
        pairing_bonus_value:     Number(p.package?.pairing_bonus_value || 0),
        pending_pairing_balance: Math.max(Number(p.left_points || 0), Number(p.right_points || 0)),
        left_points:             Number(p.left_points  || 0),
        right_points:            Number(p.right_points || 0),
      }])
    )

    const [allCommissions, allCounts] = await Promise.all([
      prisma.commission.groupBy({
        by:    ['user_id', 'type'],
        where: { user_id: { in: userIds } },
        _sum:  { amount: true },
      }),
      prisma.binaryTreeNode.findMany({
        where:  { id: { in: nodeIds } },
        select: { id: true, left_count: true, right_count: true },
      }),
    ])

    const commissionMap = new Map<string, { direct: number; pairing: number; points: number; total: number }>()
    for (const c of allCommissions) {
      const existing = commissionMap.get(c.user_id) || { direct: 0, pairing: 0, points: 0, total: 0 }
      const amount   = Number(c._sum.amount || 0)
      if (c.type === 'direct_referral') existing.direct  += amount
      if (c.type === 'binary_pairing')  existing.pairing += amount
      if (c.type === 'sponsor_point')   existing.points  += amount
      existing.total += amount
      commissionMap.set(c.user_id, existing)
    }

    const countMap = new Map(allCounts.map((n) => [n.id, { left: n.left_count, right: n.right_count }]))
    const tree     = buildTreeFromNodes(allNodes, myNode.id, user.id, commissionMap, countMap, profileMap)

    return NextResponse.json({
      tree,
      meta: {
        node_id:     myNode.id,
        position:    myNode.position,
        left_count:  myNode.left_count,
        right_count: myNode.right_count,
        sponsor:     myNode.sponsor,
        parent:      myNode.parent,
      },
      my_earnings: {
        direct_referral:         selfCommissions.direct,
        binary_pairing:          selfCommissions.pairing,
        product_points:          selfCommissions.points,
        total_earned:            Number(myWallet?.total_earned || 0),
        wallet_balance:          Number(myWallet?.balance || 0),
        total_withdrawn:         Number(myWallet?.total_withdrawn || 0),
        total_points:            myProfile?.total_points || 0,
        pending_pairing_balance: Number(myProfile?.pending_pairing_balance || 0),
        package:                 myProfile?.package?.name || null,
      },
    })
  } catch (error) {
    console.error('[RESELLER TREE GET ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}