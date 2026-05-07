import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/app/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)

    const referrer = searchParams.get('referrer')

    if (!referrer) {
      return NextResponse.json(
        { error: 'Referrer required.' },
        { status: 400 }
      )
    }

    const referrerUser = await prisma.user.findUnique({
      where: {
        username: referrer.trim().toLowerCase(),
      },
      select: {
        id: true,
      },
    })

    if (!referrerUser) {
      return NextResponse.json(
        { error: 'Referrer not found.' },
        { status: 404 }
      )
    }

    const nodes = await prisma.binaryTreeNode.findMany({
      where: {
        OR: [
          {
            sponsor_id: referrerUser.id,
          },
          {
            user_id: referrerUser.id,
          },
        ],
      },
      include: {
        user: {
          select: {
            username: true,
            full_name: true,
          },
        },
        children: {
          select: {
            position: true,
          },
        },
      },
      take: 100,
    })

    const formattedNodes = nodes.map((node) => {
      const leftOccupied = node.children.some(
        (child) => child.position === 'left'
      )

      const rightOccupied = node.children.some(
        (child) => child.position === 'right'
      )

      return {
        id: node.id,
        username: node.user.username,
        full_name: node.user.full_name,
        leftOccupied,
        rightOccupied,
      }
    })

    return NextResponse.json({
      nodes: formattedNodes,
    })
  } catch (error) {
    console.error(error)

    return NextResponse.json(
      { error: 'Failed to load placement options.' },
      { status: 500 }
    )
  }
}