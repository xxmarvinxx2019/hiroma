import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

async function fetchSubtree(rootNodeId: string, maxDepth: number) {
  const nodes = await prisma.$queryRaw<{
    id: string; user_id: string; parent_id: string | null
    position: string | null; depth: number
    username: string; full_name: string; package_name: string | null
  }[]>`
    WITH RECURSIVE subtree AS (
      SELECT
        n.id::text, n.user_id::text, n.parent_id::text, n.position,
        u.username, u.full_name,
        p.name AS package_name,
        0 AS depth
      FROM binary_tree_nodes n
      JOIN users u ON u.id::text = n.user_id::text
      LEFT JOIN reseller_profiles rp ON rp.user_id::text = n.user_id::text
      LEFT JOIN packages p ON p.id::text = rp.package_id::text
      WHERE n.id::text = ${rootNodeId}
      UNION ALL
      SELECT
        n.id::text, n.user_id::text, n.parent_id::text, n.position,
        u.username, u.full_name,
        p.name AS package_name,
        s.depth + 1
      FROM binary_tree_nodes n
      JOIN users u ON u.id::text = n.user_id::text
      LEFT JOIN reseller_profiles rp ON rp.user_id::text = n.user_id::text
      LEFT JOIN packages p ON p.id::text = rp.package_id::text
      JOIN subtree s ON n.parent_id::text = s.id
      WHERE s.depth < ${maxDepth}
    )
    SELECT * FROM subtree
  `
  return nodes
}

interface TreeNode {
  id: string; user_id: string; username: string; full_name: string
  package_name: string | null; position: string | null; is_self: boolean; depth: number
  left_child: TreeNode | null; right_child: TreeNode | null
  direct_referral_earned: number; binary_pairing_earned: number
  product_points_earned: number; total_earned: number
  left_count: number; right_count: number
  pairing_bonus_value: number; pending_pairing_balance: number
  left_points: number; right_points: number
  rank: string; total_pu: number
}

function buildTreeFromNodes(
  nodes: { id: string; user_id: string; parent_id: string | null; position: string | null; depth: number; username: string; full_name: string; package_name: string | null }[],
  rootId: string,
  selfUserId: string,
  commissionMap: Map<string, { direct: number; pairing: number; points: number; total: number }>,
  countMap: Map<string, { left: number; right: number }>,
  profileMap: Map<string, { pairing_bonus_value: number; pending_pairing_balance: number; left_points: number; right_points: number; rank: string; total_pu: number }>
): TreeNode | null {
  const node      = nodes.find((n) => n.id === rootId)
  if (!node) return null

  const leftChild  = nodes.find((n) => n.parent_id === rootId && n.position === 'left')
  const rightChild = nodes.find((n) => n.parent_id === rootId && n.position === 'right')
  const commissions = commissionMap.get(node.user_id) || { direct: 0, pairing: 0, points: 0, total: 0 }
  const counts      = countMap.get(node.id)           || { left: 0, right: 0 }
  const profile     = profileMap.get(node.user_id)

  return {
    id: node.id, user_id: node.user_id, username: node.username,
    full_name: node.full_name, package_name: node.package_name,
    position: node.position, is_self: node.user_id === selfUserId, depth: node.depth,
    left_child:  leftChild  ? buildTreeFromNodes(nodes, leftChild.id,  selfUserId, commissionMap, countMap, profileMap) : null,
    right_child: rightChild ? buildTreeFromNodes(nodes, rightChild.id, selfUserId, commissionMap, countMap, profileMap) : null,
    direct_referral_earned: commissions.direct,
    binary_pairing_earned:  commissions.pairing,
    product_points_earned:  commissions.points,
    total_earned:           commissions.total,
    left_count:              counts.left,
    right_count:             counts.right,
    pairing_bonus_value:     profile?.pairing_bonus_value     || 0,
    pending_pairing_balance: profile?.pending_pairing_balance || 0,
    left_points:             profile?.left_points             || 0,
    right_points:            profile?.right_points            || 0,
    rank:                    profile?.rank                    || 'default',
    total_pu:                profile?.total_pu                || 0,
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const maxDepth   = 4
    const rootUserId = searchParams.get('root_user_id') || null
    const search     = searchParams.get('search') || ''

    const myNode = await prisma.binaryTreeNode.findUnique({
      where:  { user_id: user.id },
      select: {
        id: true, position: true, left_count: true, right_count: true,
        sponsor: { select: { username: true, full_name: true } },
        parent:  { select: { id: true, user: { select: { username: true, full_name: true } } } },
      },
    })

    if (!myNode) return NextResponse.json({ error: 'Tree node not found.' }, { status: 404 })

    // ── Search mode ──
    if (search) {
      const searchPattern = `%${search}%`

      const results = await prisma.$queryRaw<{
        user_id: string; username: string; full_name: string
        position: string | null; left_count: number; right_count: number
        package_name: string | null; rank: string | null; total_pu: number | null
      }[]>`
        WITH RECURSIVE downline AS (
          SELECT n.id, n.user_id, n.position, n.left_count, n.right_count
          FROM binary_tree_nodes n WHERE n.id::text = ${myNode.id}
          UNION ALL
          SELECT n.id, n.user_id, n.position, n.left_count, n.right_count
          FROM binary_tree_nodes n
          INNER JOIN downline d ON n.parent_id = d.id
        )
        SELECT
          u.id::text as user_id, u.username, u.full_name,
          dn.position, dn.left_count, dn.right_count,
          pk.name as package_name,
          rp.rank, rp.total_pu
        FROM downline dn
        JOIN users u ON u.id = dn.user_id
        LEFT JOIN reseller_profiles rp ON rp.user_id = u.id
        LEFT JOIN packages pk ON pk.id = rp.package_id
        WHERE u.id::text != ${user.id}
          AND (
            LOWER(u.full_name) LIKE LOWER(${searchPattern})
            OR LOWER(u.username) LIKE LOWER(${searchPattern})
          )
        LIMIT 20
      `
      return NextResponse.json({ results })
    }

    // ── Tree mode ──
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
          total_points: true, pending_pairing_balance: true,
          daily_referral_count: true,
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

    // Resolve root node
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

    // Fetch profiles
    const resellerProfiles = await prisma.resellerProfile.findMany({
      where:  { user_id: { in: userIds } },
      select: {
        user_id: true, pending_pairing_balance: true,
        left_points: true, right_points: true,
        package: { select: { pairing_bonus_value: true } },
      },
    })

    // Fetch rank/total_pu via raw SQL
    let rankMap = new Map<string, { rank: string; total_pu: number }>()
    try {
      const rankRows = await prisma.$queryRaw<{ user_id: string; rank: string; total_pu: number }[]>`
        SELECT user_id::text, COALESCE(rank, 'default') as rank, COALESCE(total_pu, 0) as total_pu
        FROM reseller_profiles WHERE user_id::text = ANY(${userIds})
      `
      rankRows.forEach(r => rankMap.set(r.user_id, { rank: r.rank, total_pu: Number(r.total_pu) }))
    } catch { /* not migrated yet */ }

    const profileMap = new Map(
      resellerProfiles.map((p) => [p.user_id, {
        pairing_bonus_value:     Number(p.package?.pairing_bonus_value || 0),
        pending_pairing_balance: Number(p.pending_pairing_balance      || 0),
        left_points:             Number(p.left_points  || 0),
        right_points:            Number(p.right_points || 0),
        rank:                    rankMap.get(p.user_id)?.rank     || 'default',
        total_pu:                rankMap.get(p.user_id)?.total_pu || 0,
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
      const amount  = Number(c._sum.amount || 0)
      const current = commissionMap.get(c.user_id) || { direct: 0, pairing: 0, points: 0, total: 0 }
      if (c.type === 'direct_referral') current.direct  += amount
      if (c.type === 'binary_pairing')  current.pairing += amount
      if (c.type === 'sponsor_point')   current.points  += amount
      current.total += amount
      commissionMap.set(c.user_id, current)
    }

    const countMap = new Map(allCounts.map((n) => [n.id, { left: n.left_count, right: n.right_count }]))

    // Fetch self rank/pu
    let selfRankData = { rank: 'default', total_pu: 0 }
    try {
      const selfRankRows = await prisma.$queryRaw<{ rank: string; total_pu: number }[]>`
        SELECT COALESCE(rank, 'default') as rank, COALESCE(total_pu, 0) as total_pu
        FROM reseller_profiles WHERE user_id::text = ${user.id}
      `
      if (selfRankRows[0]) selfRankData = { rank: selfRankRows[0].rank, total_pu: Number(selfRankRows[0].total_pu) }
    } catch { /* not migrated */ }

    const tree = buildTreeFromNodes(allNodes, rootNodeId, user.id, commissionMap, countMap, profileMap)

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
        total_earned:            selfCommissions.total,
        wallet_balance:          Number(myWallet?.balance          || 0),
        total_withdrawn:         Number(myWallet?.total_withdrawn  || 0),
        total_points:            myProfile?.total_points           || 0,
        pending_pairing_balance: Number(myProfile?.pending_pairing_balance || 0),
        package:                 myProfile?.package?.name          || null,
        rank:                    selfRankData.rank,
        total_pu:                selfRankData.total_pu,
      },
    })
  } catch (error) {
    console.error('[RESELLER TREE GET ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}