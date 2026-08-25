import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

type NetworkRow = {
  id: string
  user_id: string
  parent_id: string | null
  parent_user_id: string | null
  parent_username: string | null
  position: string | null
  depth: number
  member_id: string
  username: string
  full_name: string
  status: string
  created_at: Date
  package_name: string | null
  rank: string | null
  left_count: number
  right_count: number
  left_points: number
  right_points: number
  sponsor_id: string | null
  sponsor_username: string | null
  sponsor_name: string | null
}

type NetworkNode = NetworkRow & {
  left_child: NetworkNode | null
  right_child: NetworkNode | null
}

function buildTree(rows: NetworkRow[], rootId: string): NetworkNode | null {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const children = new Map<string, { left?: string; right?: string }>()

  for (const row of rows) {
    if (!row.parent_id || !byId.has(row.parent_id)) continue
    const current = children.get(row.parent_id) || {}
    if (row.position === 'left') current.left = row.id
    if (row.position === 'right') current.right = row.id
    children.set(row.parent_id, current)
  }

  const visit = (id: string): NetworkNode | null => {
    const row = byId.get(id)
    if (!row) return null
    const child = children.get(id)
    return {
      ...row,
      left_child: child?.left ? visit(child.left) : null,
      right_child: child?.right ? visit(child.right) : null,
    }
  }

  return visit(rootId)
}

export async function GET(req: NextRequest) {
  const currentUser = await getCurrentUser()
  if (!currentUser || currentUser.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const search = (req.nextUrl.searchParams.get('search') || '').trim().slice(0, 100)
  const rootUserId = (req.nextUrl.searchParams.get('root_user_id') || '').trim().slice(0, 80)
  const requestedDepth = Number.parseInt(req.nextUrl.searchParams.get('depth') || '2', 10)
  const maxDepth = Number.isSafeInteger(requestedDepth) ? Math.min(Math.max(requestedDepth, 1), 3) : 2

  try {
    if (search) {
      const pattern = `%${search.toLowerCase()}%`
      const results = await prisma.$queryRaw<Array<{
        user_id: string
        member_id: string
        username: string
        full_name: string
        status: string
        package_name: string | null
        rank: string | null
        position: string | null
        left_count: number
        right_count: number
      }>>`
        SELECT u.id::text user_id,u.member_id,u.username,u.full_name,u.status::text status,
          p.name package_name,rp.rank,n.position,n.left_count,n.right_count
        FROM binary_tree_nodes n
        JOIN users u ON u.id=n.user_id
        LEFT JOIN reseller_profiles rp ON rp.user_id=u.id
        LEFT JOIN packages p ON p.id=rp.package_id
        WHERE LOWER(CONCAT_WS(' ',u.member_id,u.username,u.full_name)) LIKE ${pattern}
        ORDER BY CASE WHEN LOWER(u.username)=LOWER(${search}) THEN 0 ELSE 1 END,u.full_name
        LIMIT 20
      `
      return NextResponse.json({ results })
    }

    let rootNode = rootUserId
      ? await prisma.binaryTreeNode.findUnique({ where: { user_id: rootUserId }, select: { id: true, user_id: true } })
      : null

    if (!rootNode) {
      const hiroma = await prisma.user.findUnique({
        where: { username: 'hiroma' },
        select: { binary_tree_node: { select: { id: true, user_id: true } } },
      })
      rootNode = hiroma?.binary_tree_node || await prisma.binaryTreeNode.findFirst({
        where: { parent_id: null },
        select: { id: true, user_id: true },
        orderBy: { id: 'asc' },
      })
    }

    if (!rootNode) {
      return NextResponse.json({ error: 'The binary network does not have a root node yet.' }, { status: 404 })
    }

    const [rows, summaryRows, unplacedRows] = await Promise.all([
      prisma.$queryRaw<NetworkRow[]>`
        WITH RECURSIVE subtree AS (
          SELECT n.id,n.user_id,n.parent_id,n.position,n.sponsor_id,n.left_count,n.right_count,0 depth
          FROM binary_tree_nodes n WHERE n.id=${rootNode.id}
          UNION ALL
          SELECT n.id,n.user_id,n.parent_id,n.position,n.sponsor_id,n.left_count,n.right_count,s.depth+1
          FROM binary_tree_nodes n
          JOIN subtree s ON n.parent_id=s.id
          WHERE s.depth<${maxDepth}
        )
        SELECT s.id::text,s.user_id::text,s.parent_id::text,
          parent_node.user_id::text parent_user_id,parent_user.username parent_username,
          s.position,s.depth,u.member_id,u.username,u.full_name,u.status::text status,u.created_at,
          pkg.name package_name,rp.rank,s.left_count,s.right_count,
          COALESCE(rp.left_points,0)::int left_points,COALESCE(rp.right_points,0)::int right_points,
          s.sponsor_id::text,sponsor.username sponsor_username,sponsor.full_name sponsor_name
        FROM subtree s
        JOIN users u ON u.id=s.user_id
        LEFT JOIN reseller_profiles rp ON rp.user_id=u.id
        LEFT JOIN packages pkg ON pkg.id=rp.package_id
        LEFT JOIN users sponsor ON sponsor.id=s.sponsor_id
        LEFT JOIN binary_tree_nodes parent_node ON parent_node.id=s.parent_id
        LEFT JOIN users parent_user ON parent_user.id=parent_node.user_id
        ORDER BY s.depth,s.position,u.created_at
      `,
      prisma.$queryRaw<Array<{ total_nodes: number; active_nodes: number; inactive_nodes: number; extra_roots: number }>>`
        SELECT COUNT(*)::int total_nodes,
          COUNT(*) FILTER(WHERE u.status='active')::int active_nodes,
          COUNT(*) FILTER(WHERE u.status<>'active')::int inactive_nodes,
          GREATEST(COUNT(*) FILTER(WHERE n.parent_id IS NULL)-1,0)::int extra_roots
        FROM binary_tree_nodes n JOIN users u ON u.id=n.user_id
      `,
      prisma.$queryRaw<Array<{ unplaced_resellers: number }>>`
        SELECT COUNT(*)::int unplaced_resellers FROM users u
        WHERE u.role='reseller' AND NOT EXISTS(SELECT 1 FROM binary_tree_nodes n WHERE n.user_id=u.id)
      `,
    ])

    const tree = buildTree(rows, rootNode.id)
    if (!tree) return NextResponse.json({ error: 'Unable to build the selected network.' }, { status: 404 })

    return NextResponse.json({
      tree,
      depth: maxDepth,
      summary: {
        ...(summaryRows[0] || { total_nodes: 0, active_nodes: 0, inactive_nodes: 0, extra_roots: 0 }),
        unplaced_resellers: unplacedRows[0]?.unplaced_resellers || 0,
      },
    })
  } catch (error) {
    console.error('[ADMIN NETWORK GET ERROR]', error)
    return NextResponse.json({ error: 'Unable to load the binary network.' }, { status: 500 })
  }
}
