import { NextRequest, NextResponse } from 'next/server'
import { Prisma, TreePosition } from '@prisma/client'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

function parseJoinedDateSearch(value: string) {
  const trimmed = value.trim()
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  const parts = slashMatch
    ? { month: Number(slashMatch[1]), day: Number(slashMatch[2]), year: Number(slashMatch[3]) }
    : isoMatch
      ? { month: Number(isoMatch[2]), day: Number(isoMatch[3]), year: Number(isoMatch[1]) }
      : null

  if (!parts || parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) return null

  const start = new Date(`${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T00:00:00+08:00`)
  if (Number.isNaN(start.getTime())) return null
  return { gte: start, lt: new Date(start.getTime() + 24 * 60 * 60 * 1000) }
}

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
    const where: Prisma.BinaryTreeNodeWhereInput = {
      id: { in: allDescendantIds },
    }

    if (position === 'left' || position === 'right') {
      where.position = position as TreePosition
    }

    if (search) {
      const term = search.trim()
      const normalizedTerm = term.toLowerCase()
      const pointsMatch = normalizedTerm.match(/^-?\d+(?:\s*pts?)?$/)
      const joinedDate = parseJoinedDateSearch(term)
      const searchFilters: Prisma.BinaryTreeNodeWhereInput[] = [
        { user: { full_name: { contains: term, mode: 'insensitive' } } },
        { user: { username: { contains: term.replace(/^@/, ''), mode: 'insensitive' } } },
        {
          user: {
            reseller_profile: {
              is: { package: { name: { contains: term, mode: 'insensitive' } } },
            },
          },
        },
      ]

      if (normalizedTerm === 'left' || normalizedTerm === 'right') {
        searchFilters.push({ position: normalizedTerm as TreePosition })
      }
      if (pointsMatch) {
        searchFilters.push({
          user: {
            reseller_profile: { is: { total_points: Number.parseInt(normalizedTerm, 10) } },
          },
        })
      }
      if (joinedDate) searchFilters.push({ created_at: joinedDate })

      where.OR = searchFilters
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
