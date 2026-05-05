import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, hashPassword } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ============================================================
// HELPER: Find available slot using BFS in chosen direction
// ============================================================

async function findAvailableSlot(
  startNodeId: string
): Promise<{ parentId: string; position: 'left' | 'right' } | null> {
  const queue: string[] = [startNodeId]

  while (queue.length > 0) {
    const nodeId = queue.shift()!

    const leftChild = await prisma.binaryTreeNode.findFirst({
      where: { parent_id: nodeId, position: 'left' },
      select: { id: true },
    })

    const rightChild = await prisma.binaryTreeNode.findFirst({
      where: { parent_id: nodeId, position: 'right' },
      select: { id: true },
    })

    if (!leftChild) return { parentId: nodeId, position: 'left' }
    if (!rightChild) return { parentId: nodeId, position: 'right' }

    queue.push(leftChild.id)
    queue.push(rightChild.id)
  }

  return null
}

// ============================================================
// GET — paginated resellers for this city distributor
// ============================================================

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get('pageSize') || '15')))
    const search = searchParams.get('search') || ''

    const where: any = { role: 'reseller', created_by: user.id }

    if (search) {
      where.OR = [
        { full_name: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
      ]
    }

    const total = await prisma.user.count({ where })

    const resellers = await prisma.user.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        full_name: true,
        username: true,
        mobile: true,
        address: true,
        status: true,
        created_at: true,
        reseller_profile: {
          select: {
            total_points: true,
            package: { select: { name: true } },
          },
        },
        wallet: { select: { balance: true } },
      },
    })

    return NextResponse.json({
      resellers,
      meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    })
  } catch (error) {
    console.error('[CITY GET RESELLERS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ============================================================
// POST — register new reseller with deep placement support
// ============================================================

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const {
      full_name,
      username,
      mobile,
      password,
      address,
      pin_id,
      referrer_username,
      placement, // 'left' or 'right' — direction chosen by referrer
    } = await req.json()

    if (!full_name || !username || !mobile || !password || !pin_id || !referrer_username || !placement) {
      return NextResponse.json(
        { error: 'All required fields must be filled.' },
        { status: 400 }
      )
    }

    // ── Check username uniqueness ──
    const existingUser = await prisma.user.findUnique({
      where: { username: username.trim().toLowerCase() },
    })
    if (existingUser) {
      return NextResponse.json({ error: 'Username already taken.' }, { status: 400 })
    }

    // ── Check name cap ──
    const normalizedName = full_name.trim().toLowerCase()
    const nameCap = await prisma.nameCapRegistry.findUnique({
      where: { normalized_name: normalizedName },
    })
    if (nameCap && nameCap.count >= nameCap.max_allowed) {
      return NextResponse.json({
        error: `Maximum accounts (${nameCap.max_allowed}) reached for the name "${full_name}".`,
      }, { status: 400 })
    }

    // ── Verify PIN ──
    const pin = await prisma.pin.findUnique({
      where: { id: pin_id },
      select: { id: true, status: true, package_id: true, city_dist_id: true },
    })
    if (!pin || pin.status !== 'unused') {
      return NextResponse.json({ error: 'PIN is invalid or already used.' }, { status: 400 })
    }
    if (pin.city_dist_id !== user.id) {
      return NextResponse.json(
        { error: 'This PIN does not belong to your account.' },
        { status: 400 }
      )
    }

    // ── Find referrer ──
    const referrer = await prisma.user.findUnique({
      where: { username: referrer_username.trim().toLowerCase() },
      select: { id: true, username: true, role: true },
    })
    if (!referrer) {
      return NextResponse.json({ error: 'Referrer not found.' }, { status: 400 })
    }

    const isHiromaNode = referrer.username === 'hiroma'
    if (!isHiromaNode && referrer.role !== 'reseller') {
      return NextResponse.json({ error: 'Invalid referrer.' }, { status: 400 })
    }

    // ── Find referrer's tree node ──
    const referrerNode = await prisma.binaryTreeNode.findUnique({
      where: { user_id: referrer.id },
      select: { id: true },
    })
    if (!referrerNode) {
      return NextResponse.json(
        { error: 'Referrer has no binary tree node.' },
        { status: 400 }
      )
    }

    // ── Find actual placement slot ──
    // Check if direct slot in chosen direction is available
    const directChild = await prisma.binaryTreeNode.findFirst({
      where: { parent_id: referrerNode.id, position: placement },
      select: { id: true },
    })

    let actualParentId: string
    let actualPosition: 'left' | 'right'

    if (!directChild) {
      // Direct slot is available
      actualParentId = referrerNode.id
      actualPosition = placement
    } else {
      // Direct slot occupied — find next available slot deeper in chosen direction
      const slot = await findAvailableSlot(directChild.id)
      if (!slot) {
        return NextResponse.json(
          { error: `No available slots found in the ${placement} direction. Try the other leg.` },
          { status: 400 }
        )
      }
      actualParentId = slot.parentId
      actualPosition = slot.position
    }

    // ── Check daily referral cap for resellers ──
    if (!isHiromaNode) {
      const referrerProfile = await prisma.resellerProfile.findUnique({
        where: { user_id: referrer.id },
        select: { daily_referral_count: true, last_referral_date: true },
      })

      if (referrerProfile) {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const lastDate = referrerProfile.last_referral_date
        const isToday = lastDate ? new Date(lastDate) >= today : false
        const dailyCount = isToday ? referrerProfile.daily_referral_count : 0

        if (dailyCount >= 10) {
          // Overflow to Hiroma top node
          const hiromaUser = await prisma.user.findUnique({
            where: { username: 'hiroma' },
            select: { id: true },
          })
          const hiromaNode = hiromaUser
            ? await prisma.binaryTreeNode.findUnique({
                where: { user_id: hiromaUser.id },
                select: { id: true },
              })
            : null

          if (hiromaNode) {
            const hiromaSlot = await findAvailableSlot(hiromaNode.id)
            if (hiromaSlot) {
              actualParentId = hiromaSlot.parentId
              actualPosition = hiromaSlot.position
            }
          }
        }
      }
    }

    const hashedPassword = await hashPassword(password)

    // ── Register reseller in transaction ──
    await prisma.$transaction(async (tx) => {
      // 1. Create user
      const newUser = await tx.user.create({
        data: {
          username: username.trim().toLowerCase(),
          full_name: full_name.trim(),
          mobile: mobile.trim(),
          password_hash: hashedPassword,
          role: 'reseller',
          status: 'active',
          address: address?.trim() || null,
          created_by: user.id,
        },
      })

      // 2. Create reseller profile
      await tx.resellerProfile.create({
        data: {
          user_id: newUser.id,
          package_id: pin.package_id,
          city_dist_id: user.id,
          pin_id: pin.id,
          total_points: 0,
          daily_referral_count: 0,
          daily_pairs_count: 0,
        },
      })

      // 3. Create wallet
      await tx.wallet.create({
        data: {
          user_id: newUser.id,
          balance: 0,
          total_earned: 0,
          total_withdrawn: 0,
        },
      })

      // 4. Create binary tree node at found slot
      await tx.binaryTreeNode.create({
        data: {
          user_id: newUser.id,
          parent_id: actualParentId,
          position: actualPosition,
          sponsor_id: referrer.id, // always the original referrer
          left_count: 0,
          right_count: 0,
          is_overflow: false,
        },
      })

      // 5. Update parent node leg count
      await tx.binaryTreeNode.update({
        where: { id: actualParentId },
        data: actualPosition === 'left'
          ? { left_count: { increment: 1 } }
          : { right_count: { increment: 1 } },
      })

      // 6. Update referrer's daily referral count (only for resellers)
      if (!isHiromaNode) {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const referrerProfile = await tx.resellerProfile.findUnique({
          where: { user_id: referrer.id },
          select: { daily_referral_count: true, last_referral_date: true },
        })
        if (referrerProfile) {
          const isToday = referrerProfile.last_referral_date
            ? new Date(referrerProfile.last_referral_date) >= today
            : false
          await tx.resellerProfile.update({
            where: { user_id: referrer.id },
            data: {
              daily_referral_count: isToday
                ? { increment: 1 }
                : 1,
              last_referral_date: new Date(),
            },
          })
        }
      }

      // 7. Mark PIN as used
      await tx.pin.update({
        where: { id: pin.id },
        data: {
          status: 'used',
          used_by: newUser.id,
          used_at: new Date(),
        },
      })

      // 8. Update name cap registry
      await tx.nameCapRegistry.upsert({
        where: { normalized_name: normalizedName },
        update: { count: { increment: 1 } },
        create: { normalized_name: normalizedName, count: 1, max_allowed: 7 },
      })
    })

    return NextResponse.json({
      success: true,
      message: `${full_name} has been registered successfully.`,
      placement_info: {
        actual_parent_id: actualParentId,
        actual_position: actualPosition,
        is_direct: actualParentId === referrerNode.id,
      },
    })
  } catch (error) {
    console.error('[REGISTER RESELLER ERROR]', error)
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}