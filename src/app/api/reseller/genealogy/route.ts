import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ── GET reseller's full downline as a flat list ──
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const search   = searchParams.get('search')   || ''
    const position = searchParams.get('position') || 'all' // left | right | all
    const page     = Math.max(1, parseInt(searchParams.get('page')     || '1'))
    const pageSize = Math.max(1, parseInt(searchParams.get('pageSize') || '15'))

    // Get this reseller's tree node
    const myNode = await prisma.binaryTreeNode.findUnique({
      where: { user_id: user.id },
      select: { id: true, left_count: true, right_count: true },
    })

    if (!myNode) {
      return NextResponse.json({ downline: [], meta: { total: 0, page: 1, pageSize, totalPages: 0 }, summary: { total: 0, left: 0, right: 0 } })
    }

    // Collect all descendant node IDs using BFS
    const allDescendantIds: string[] = []
    const queue = [myNode.id]

    while (queue.length > 0) {
      const batch = queue.splice(0, 50)
      const children = await prisma.binaryTreeNode.findMany({
        where:  { parent_id: { in: batch } },
        select: { id: true, user_id: true },
      })
      for (const child of children) {
        allDescendantIds.push(child.id)
        queue.push(child.id)
      }
    }

    if (allDescendantIds.length === 0) {
      return NextResponse.json({
        downline: [],
        meta:    { total: 0, page: 1, pageSize, totalPages: 0 },
        summary: { total: 0, left: myNode.left_count, right: myNode.right_count },
      })
    }

    // Build filter
    const where: any = {
      id: { in: allDescendantIds },
    }

    if (position !== 'all') {
      where.position = position
    }

    if (search) {
      where.user = {
        OR: [
          { full_name: { contains: search, mode: 'insensitive' } },
          { username:  { contains: search, mode: 'insensitive' } },
        ],
      }
    }

    const [total, nodes] = await Promise.all([
      prisma.binaryTreeNode.count({ where }),
      prisma.binaryTreeNode.findMany({
        where,
        orderBy: { created_at: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id:          true,
          position:    true,
          is_overflow: true,
          created_at:  true,
          user: {
            select: {
              full_name: true,
              username:  true,
              mobile:    true,
              status:    true,
              reseller_profile: {
                select: {
                  total_points: true,
                  package: { select: { name: true } },
                },
              },
            },
          },
          sponsor: {
            select: { full_name: true, username: true },
          },
          parent: {
            select: {
              user: { select: { full_name: true, username: true } },
            },
          },
        },
      }),
    ])

    return NextResponse.json({
      downline: nodes,
      summary: {
        total: allDescendantIds.length,
        left:  myNode.left_count,
        right: myNode.right_count,
      },
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    })
  } catch (error) {
    console.error('[RESELLER GENEALOGY ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}