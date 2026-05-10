import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ============================================================
// TYPES
// ============================================================

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
}

// ============================================================
// RECURSIVE TREE BUILDER — max 4 levels deep
// ============================================================

async function buildTree(
  nodeId: string,
  depth: number,
  maxDepth: number,
  selfUserId: string
): Promise<TreeNode | null> {
  if (depth > maxDepth) return null

  const node = await prisma.binaryTreeNode.findUnique({
    where: { id: nodeId },
    select: {
      id:       true,
      user_id:  true,
      position: true,
      user: {
        select: {
          username:          true,
          full_name:         true,
          reseller_profile: {
            select: {
              package: { select: { name: true } },
            },
          },
        },
      },
    },
  })

  if (!node) return null

  const [leftChild, rightChild] = await Promise.all([
    prisma.binaryTreeNode.findFirst({
      where: { parent_id: nodeId, position: 'left' },
      select: { id: true },
    }),
    prisma.binaryTreeNode.findFirst({
      where: { parent_id: nodeId, position: 'right' },
      select: { id: true },
    }),
  ])

  return {
    id:           node.id,
    user_id:      node.user_id,
    username:     node.user.username,
    full_name:    node.user.full_name,
    package_name: node.user.reseller_profile?.package?.name || null,
    position:     node.position,
    is_self:      node.user_id === selfUserId,
    depth,
    left_child:  leftChild  ? await buildTree(leftChild.id,  depth + 1, maxDepth, selfUserId) : null,
    right_child: rightChild ? await buildTree(rightChild.id, depth + 1, maxDepth, selfUserId) : null,
  }
}

// ============================================================
// GET — reseller's own binary tree
// ============================================================

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const maxDepth = Math.min(
      parseInt(searchParams.get('depth') || '4'),
      6 // hard cap at 6 levels
    )

    // Get this reseller's tree node
    const myNode = await prisma.binaryTreeNode.findUnique({
      where: { user_id: user.id },
      select: {
        id:          true,
        position:    true,
        left_count:  true,
        right_count: true,
        sponsor: {
          select: { username: true, full_name: true },
        },
        parent: {
          select: {
            id:      true,
            user: { select: { username: true, full_name: true } },
          },
        },
      },
    })

    if (!myNode) {
      return NextResponse.json({ error: 'Tree node not found.' }, { status: 404 })
    }

    // Build tree downward from this reseller
    const tree = await buildTree(myNode.id, 0, maxDepth, user.id)

    // Summary counts
    const totalDownline = await prisma.binaryTreeNode.count({
      where: {
        OR: [
          // All nodes that have this node somewhere in their ancestry
          // We approximate with left_count + right_count from the node itself
        ],
      },
    })

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
    })
  } catch (error) {
    console.error('[RESELLER TREE GET ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}