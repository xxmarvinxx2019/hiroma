import type { Prisma } from '@prisma/client'

export function isBinaryTreeSlotConflict(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const code = Reflect.get(error, 'code')
  const meta = Reflect.get(error, 'meta')
  if (code !== 'P2002') return false
  const target = JSON.stringify(meta || {})
  return target.includes('parent_id') && target.includes('position')
}

export class InvalidBinaryTreePlacementError extends Error {
  constructor() {
    super('The selected binary-tree placement is outside the direct referrer\'s organization.')
    this.name = 'InvalidBinaryTreePlacementError'
  }
}

export async function assertPlacementWithinReferrerSubtree(
  tx: Prisma.TransactionClient,
  referrerId: string,
  placementParentNodeId: string,
) {
  const rows = await tx.$queryRaw<{ is_allowed: boolean }[]>`
    SELECT EXISTS (
      WITH RECURSIVE subtree AS (
        SELECT id
        FROM binary_tree_nodes
        WHERE user_id = ${referrerId}

        UNION ALL

        SELECT child.id
        FROM binary_tree_nodes child
        INNER JOIN subtree parent ON child.parent_id = parent.id
      )
      SELECT 1
      FROM subtree
      WHERE id = ${placementParentNodeId}
    ) AS is_allowed
  `

  if (!rows[0]?.is_allowed) {
    throw new InvalidBinaryTreePlacementError()
  }
}
