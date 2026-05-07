import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, hashPassword } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { Prisma } from "@prisma/client"

// ── GET all distributors ──
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const distributors = await prisma.user.findMany({
      where: { role: { in: ['regional', 'provincial', 'city'] } },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        full_name: true,
        username: true,
        mobile: true,
        address: true,
        status: true,
        created_at: true,
        distributor_profile: {
          select: {
            dist_level: true,
            coverage_area: true,
            is_active: true,
            contract_signed_at: true,
          },
        },
      },
    })

    return NextResponse.json({ distributors })
  } catch (error) {
    console.error('[GET DISTRIBUTORS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── POST create new distributor ──
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { full_name, username, mobile, password, address, dist_level, coverage_area } = body

    if (!full_name || !username || !mobile || !password || !dist_level || !coverage_area) {
      return NextResponse.json({ error: 'All required fields must be filled.' }, { status: 400 })
    }

    const existing = await prisma.user.findUnique({
      where: { username: username.trim().toLowerCase() },
    })
    if (existing) {
      return NextResponse.json({ error: 'Username already taken.' }, { status: 400 })
    }

    const roleMap: Record<string, string> = {
      regional: 'regional',
      provincial: 'provincial',
      city: 'city',
    }
    const role = roleMap[dist_level]
    if (!role) {
      return NextResponse.json({ error: 'Invalid distributor level.' }, { status: 400 })
    }

    const hashedPassword = await hashPassword(password)

    const newDist = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const newUser = await tx.user.create({
        data: {
          username: username.trim().toLowerCase(),
          full_name: full_name.trim(),
          mobile: mobile.trim(),
          password_hash: hashedPassword,
          role: role as any,
          status: 'active',
          address: address?.trim() || null,
          created_by: user.id,
        },
      })

      await tx.distributorProfile.create({
        data: {
          user_id: newUser.id,
          dist_level: dist_level as any,
          coverage_area: coverage_area.trim(),
          contract_signed_at: new Date(),
          is_active: true,
        },
      })

      await tx.wallet.create({
        data: {
          user_id: newUser.id,
          balance: 0,
          total_earned: 0,
          total_withdrawn: 0,
        },
      })

      return newUser
    })

    return NextResponse.json({
      success: true,
      message: 'Distributor registered successfully.',
      distributor: { id: newDist.id, username: newDist.username },
    })
  } catch (error) {
    console.error('[CREATE DISTRIBUTOR ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}