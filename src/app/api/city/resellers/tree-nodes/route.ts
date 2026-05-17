import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ============================================================
// GET available nodes under a referrer for tree placement
// Uses a single batch query instead of recursive individual queries
// ============================================================

interface TreeNode {
  id: string
  user_id: string
  username: string
  full_name: string
  position: string | null
  left_available: boolean
  right_available: boolean
  left_child: TreeNode | null
  right_child: TreeNode | null
  depth: number
}

// Fetch ALL nodes in the subtree with one recursive CTE query
async function fetchSubtree(rootNodeId: string, maxDepth: number) {
  const nodes = await prisma.$queryRaw<{
    id: string
    user_id: string
    parent_id: string | null
    position: string | null
    username: string
    full_name: string
    depth: number
  }[]>`
    WITH RECURSIVE subtree AS (
      -- Root node
      SELECT
        n.id, n.user_id, n.parent_id, n.position,
        u.username, u.full_name,
        0 AS depth
      FROM binary_tree_nodes n
      JOIN users u ON u.id = n.user_id
      WHERE n.id = ${rootNodeId}

      UNION ALL

      -- Children up to maxDepth
      SELECT
        n.id, n.user_id, n.parent_id, n.position,
        u.username, u.full_name,
        s.depth + 1
      FROM binary_tree_nodes n
      JOIN users u ON u.id = n.user_id
      JOIN subtree s ON n.parent_id = s.id
      WHERE s.depth < ${maxDepth}
    )
    SELECT * FROM subtree
  `

  return nodes
}

// Build tree structure from flat node list in memory
function buildTreeFromNodes(
  nodes: {
    id: string
    user_id: string
    parent_id: string | null
    position: string | null
    username: string
    full_name: string
    depth: number
  }[],
  rootId: string,
  currentDepth: number
): TreeNode | null {
  const node = nodes.find((n) => n.id === rootId)
  if (!node) return null

  const leftChild  = nodes.find((n) => n.parent_id === rootId && n.position === 'left')
  const rightChild = nodes.find((n) => n.parent_id === rootId && n.position === 'right')

  return {
    id:              node.id,
    user_id:         node.user_id,
    username:        node.username,
    full_name:       node.full_name,
    position:        node.position,
    left_available:  !leftChild,
    right_available: !rightChild,
    left_child:  leftChild  ? buildTreeFromNodes(nodes, leftChild.id,  currentDepth + 1) : null,
    right_child: rightChild ? buildTreeFromNodes(nodes, rightChild.id, currentDepth + 1) : null,
    depth: currentDepth,
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const referrerNodeId = searchParams.get('node_id')
    const direction      = searchParams.get('direction') as 'left' | 'right' | null

    if (!referrerNodeId || !direction) {
      return NextResponse.json(
        { error: 'node_id and direction are required.' },
        { status: 400 }
      )
    }

    // Check if direct slot is available
    const directionChild = await prisma.binaryTreeNode.findFirst({
      where:  { parent_id: referrerNodeId, position: direction },
      select: { id: true },
    })

    if (!directionChild) {
      return NextResponse.json({ direct_available: true, tree: null })
    }

    // Fetch entire subtree in ONE query instead of recursive individual queries
    const allNodes = await fetchSubtree(directionChild.id, 4)

    // Build tree structure in memory — no DB calls
    const tree = buildTreeFromNodes(allNodes, directionChild.id, 0)

    return NextResponse.json({ direct_available: false, tree })
  } catch (error) {
    console.error('[TREE NODES ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}