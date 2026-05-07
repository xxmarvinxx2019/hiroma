import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ============================================================
// GET available nodes in a direction under a referrer
// Returns a tree structure for visual display
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

async function buildTree(
  nodeId: string,
  depth: number,
  maxDepth: number
): Promise<TreeNode | null> {
  if (depth > maxDepth) return null

  const node = await prisma.binaryTreeNode.findUnique({
    where: { id: nodeId },
    select: {
      id: true,
      user_id: true,
      position: true,
      user: { select: { username: true, full_name: true } },
    },
  })

  if (!node) return null

  const leftChild = await prisma.binaryTreeNode.findFirst({
    where: { parent_id: nodeId, position: 'left' },
    select: { id: true },
  })

  const rightChild = await prisma.binaryTreeNode.findFirst({
    where: { parent_id: nodeId, position: 'right' },
    select: { id: true },
  })

  const leftAvailable = !leftChild
  const rightAvailable = !rightChild

  return {
    id: node.id,
    user_id: node.user_id,
    username: node.user.username,
    full_name: node.user.full_name,
    position: node.position,
    left_available: leftAvailable,
    right_available: rightAvailable,
    left_child: leftChild
      ? await buildTree(leftChild.id, depth + 1, maxDepth)
      : null,
    right_child: rightChild
      ? await buildTree(rightChild.id, depth + 1, maxDepth)
      : null,
    depth,
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
    const direction = searchParams.get('direction') as 'left' | 'right' | null

    if (!referrerNodeId || !direction) {
      return NextResponse.json(
        { error: 'node_id and direction are required.' },
        { status: 400 }
      )
    }

    // ── Get the child node in the chosen direction ──
    const directionChild = await prisma.binaryTreeNode.findFirst({
      where: { parent_id: referrerNodeId, position: direction },
      select: { id: true },
    })

    if (!directionChild) {
      // Direct slot is available — no tree needed
      return NextResponse.json({
        direct_available: true,
        tree: null,
      })
    }

    // ── Build tree from that child — max 4 levels deep ──
    const tree = await buildTree(directionChild.id, 0, 4)

    return NextResponse.json({
      direct_available: false,
      tree,
    })
  } catch (error) {
    console.error('[TREE NODES ERROR]', error)
    return NextResponse.json(
      { error: 'Something went wrong.' },
      { status: 500 }
    )
  }
}