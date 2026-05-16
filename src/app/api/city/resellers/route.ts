import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, hashPassword } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ============================================================
// GET — paginated resellers
// ============================================================

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const page     = Math.max(1, parseInt(searchParams.get('page')     || '1'))
    const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get('pageSize') || '15')))
    const search   = searchParams.get('search') || ''

    const where: any = { role: 'reseller', created_by: user.id }
    if (search) {
      where.OR = [
        { full_name: { contains: search, mode: 'insensitive' } },
        { username:  { contains: search, mode: 'insensitive' } },
      ]
    }

    const total     = await prisma.user.count({ where })
    const resellers = await prisma.user.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, full_name: true, username: true,
        mobile: true, address: true, status: true, created_at: true,
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
// HELPERS — all use prisma directly (outside transaction)
// ============================================================

async function updateAncestorCounts(
  parentNodeId: string,
  positionUnderParent: 'left' | 'right'
) {
  let currentId  = parentNodeId
  let currentPos = positionUnderParent

  while (currentId) {
    await prisma.binaryTreeNode.update({
      where: { id: currentId },
      data:  currentPos === 'left'
        ? { left_count: { increment: 1 } }
        : { right_count: { increment: 1 } },
    })

    const thisNode = await prisma.binaryTreeNode.findUnique({
      where:  { id: currentId },
      select: { parent_id: true, position: true },
    })

    if (!thisNode?.parent_id) break
    currentPos = thisNode.position as 'left' | 'right'
    currentId  = thisNode.parent_id
  }
}

async function creditDirectReferralBonus(
  referrerId: string,
  newUserId: string,
  amount: number
) {
  if (amount <= 0) return

  await prisma.commission.create({
    data: {
      user_id:          referrerId,
      type:             'direct_referral',
      amount,
      source_user_id:   newUserId,
      is_pair_overflow: false,
    },
  })

  await prisma.wallet.update({
    where: { user_id: referrerId },
    data:  { balance: { increment: amount }, total_earned: { increment: amount } },
  })
}

async function creditPairingBonusWithCascade(
  startNodeId: string,
  newUserId: string,
  triggerBonusAmount: number
) {
  let currentNodeId: string | null = startNodeId
  let remaining                    = triggerBonusAmount

  while (currentNodeId && remaining > 0) {
    const node = await prisma.binaryTreeNode.findUnique({
      where:  { id: currentNodeId },
      select: {
        id: true, user_id: true, parent_id: true,
        user: {
          select: {
            reseller_profile: {
              select: { package: { select: { pairing_bonus_value: true } } },
            },
          },
        },
      },
    })

    if (!node) break

    const uplineTierBonus = Number(
      node.user.reseller_profile?.package?.pairing_bonus_value || 0
    )

    if (uplineTierBonus <= 0) { currentNodeId = node.parent_id; continue }

    const claimed = Math.min(uplineTierBonus, remaining)
    remaining    -= claimed

    await prisma.commission.create({
      data: {
        user_id:           node.user_id,
        type:              'binary_pairing',
        amount:            claimed,
        source_user_id:    newUserId,
        cascade_remainder: remaining > 0 ? remaining : null,
        is_pair_overflow:  false,
      },
    })

    await prisma.wallet.update({
      where: { user_id: node.user_id },
      data:  { balance: { increment: claimed }, total_earned: { increment: claimed } },
    })

    currentNodeId = node.parent_id
  }
}

async function checkAndFirePairingBonus(
  parentNodeId: string,
  newUserId: string,
  newPosition: 'left' | 'right'
) {
  const otherPosition = newPosition === 'left' ? 'right' : 'left'

  const otherChild = await prisma.binaryTreeNode.findFirst({
    where:  { parent_id: parentNodeId, position: otherPosition },
    select: { id: true },
  })

  if (!otherChild) return

  const parentNode = await prisma.binaryTreeNode.findUnique({
    where:  { id: parentNodeId },
    select: {
      id: true, user_id: true,
      user: {
        select: {
          reseller_profile: {
            select: { package: { select: { pairing_bonus_value: true } } },
          },
        },
      },
    },
  })

  if (!parentNode) return

  const pairingBonusValue = Number(
    parentNode.user.reseller_profile?.package?.pairing_bonus_value || 0
  )

  if (pairingBonusValue <= 0) return

  await creditPairingBonusWithCascade(parentNodeId, newUserId, pairingBonusValue)
}

// ============================================================
// POST — register new reseller
// ============================================================

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const {
      full_name, username, email, mobile, password, address,
      pin_id, referrer_username, actual_parent_node_id, actual_position,
    } = await req.json()

    if (!full_name || !username || !mobile || !password || !pin_id ||
        !referrer_username || !actual_parent_node_id || !actual_position) {
      return NextResponse.json({ error: 'All required fields must be filled.' }, { status: 400 })
    }

    if (!['left', 'right'].includes(actual_position)) {
      return NextResponse.json({ error: 'Invalid position.' }, { status: 400 })
    }

    // ── Run all pre-checks in parallel ──
    const [existingUser, pin, slotTaken, parentNodeExists, referrer] = await Promise.all([
      prisma.user.findUnique({ where: { username: username.trim().toLowerCase() } }),
      prisma.pin.findUnique({
        where:  { id: pin_id },
        select: { id: true, status: true, package_id: true, city_dist_id: true },
      }),
      prisma.binaryTreeNode.findFirst({
        where: { parent_id: actual_parent_node_id, position: actual_position },
      }),
      prisma.binaryTreeNode.findUnique({ where: { id: actual_parent_node_id } }),
      prisma.user.findUnique({
        where:  { username: referrer_username.trim().toLowerCase() },
        select: { id: true, username: true, role: true },
      }),
    ])

    if (existingUser)
      return NextResponse.json({ error: 'Username already taken.' }, { status: 400 })
    if (!pin || pin.status !== 'unused')
      return NextResponse.json({ error: 'PIN is invalid or already used.' }, { status: 400 })
    if (pin.city_dist_id !== user.id)
      return NextResponse.json({ error: 'This PIN does not belong to your account.' }, { status: 400 })
    if (slotTaken)
      return NextResponse.json({ error: 'This slot was just taken. Please refresh and try again.' }, { status: 400 })
    if (!parentNodeExists)
      return NextResponse.json({ error: 'Parent node not found.' }, { status: 400 })
    if (!referrer)
      return NextResponse.json({ error: 'Referrer not found.' }, { status: 400 })

    if (email?.trim()) {
      const existingEmail = await prisma.user.findFirst({ where: { email: email.trim().toLowerCase() } })
      if (existingEmail)
        return NextResponse.json({ error: 'Email already in use.' }, { status: 400 })
    }

    const normalizedName = full_name.trim().toLowerCase()
    const nameCap = await prisma.nameCapRegistry.findUnique({ where: { normalized_name: normalizedName } })
    if (nameCap && nameCap.count >= nameCap.max_allowed) {
      return NextResponse.json({
        error: `Maximum accounts (${nameCap.max_allowed}) reached for the name "${full_name}".`,
      }, { status: 400 })
    }

    const isHiromaNode = referrer.username === 'hiroma'

    const referrerProfile = !isHiromaNode
      ? await prisma.resellerProfile.findUnique({
          where:  { user_id: referrer.id },
          select: {
            daily_referral_count: true,
            last_referral_date:   true,
            package: { select: { direct_referral_bonus: true, pairing_bonus_value: true } },
          },
        })
      : null

    let overflowToHiroma = false
    if (!isHiromaNode && referrerProfile) {
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const isToday    = referrerProfile.last_referral_date
        ? new Date(referrerProfile.last_referral_date) >= today : false
      const dailyCount = isToday ? referrerProfile.daily_referral_count : 0
      overflowToHiroma = dailyCount >= 10
    }

    // ── Fetch package products + check other side BEFORE transaction ──
    const [packageProducts, otherSideExists] = await Promise.all([
      prisma.packageProduct.findMany({
        where:  { package_id: pin.package_id },
        select: { product_id: true, quantity: true },
      }),
      prisma.binaryTreeNode.findFirst({
        where:  { parent_id: actual_parent_node_id, position: actual_position === 'left' ? 'right' : 'left' },
        select: { id: true },
      }),
    ])

    const hashedPassword = await hashPassword(password)

    // ── SLIM TRANSACTION — only core data creation ──
    const newUser = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          username:      username.trim().toLowerCase(),
          full_name:     full_name.trim(),
          email:         email?.trim().toLowerCase() || null,
          mobile:        mobile.trim(),
          password_hash: hashedPassword,
          role:          'reseller',
          status:        'active',
          address:       address?.trim() || null,
          created_by:    user.id,
        },
      })

      await tx.resellerProfile.create({
        data: {
          user_id:              created.id,
          package_id:           pin.package_id,
          city_dist_id:         user.id,
          pin_id:               pin.id,
          total_points:         0,
          daily_referral_count: 0,
          daily_pairs_count:    0,
        },
      })

      await tx.wallet.create({
        data: { user_id: created.id, balance: 0, total_earned: 0, total_withdrawn: 0 },
      })

      await tx.binaryTreeNode.create({
        data: {
          user_id:     created.id,
          parent_id:   actual_parent_node_id,
          position:    actual_position,
          sponsor_id:  overflowToHiroma ? null : referrer.id,
          left_count:  0,
          right_count: 0,
          is_overflow: overflowToHiroma,
        },
      })

      await tx.pin.update({
        where: { id: pin.id },
        data:  { status: 'used', used_by: created.id, used_at: new Date() },
      })

      await tx.nameCapRegistry.upsert({
        where:  { normalized_name: normalizedName },
        update: { count: { increment: 1 } },
        create: { normalized_name: normalizedName, count: 1, max_allowed: 7 },
      })

      return created
    })

    // ── POST-TRANSACTION — non-critical work ──

    // Deduct package inventory
    for (const pp of packageProducts) {
      try {
        await prisma.inventory.updateMany({
          where: { owner_id: user.id, product_id: pp.product_id },
          data:  { quantity: { decrement: pp.quantity } },
        })
      } catch (e) {
        console.error('[REGISTER] Inventory deduct error:', e)
      }
    }

    // Update ancestor counts
    try {
      await updateAncestorCounts(actual_parent_node_id, actual_position as 'left' | 'right')
    } catch (e) {
      console.error('[REGISTER] Ancestor count error:', e)
    }

    // Commissions
    if (!overflowToHiroma && !isHiromaNode) {
      try {
        const today = new Date(); today.setHours(0, 0, 0, 0)
        const isToday = referrerProfile?.last_referral_date
          ? new Date(referrerProfile.last_referral_date) >= today : false

        await prisma.resellerProfile.update({
          where: { user_id: referrer.id },
          data:  {
            daily_referral_count: isToday ? { increment: 1 } : 1,
            last_referral_date:   new Date(),
          },
        })

        const directBonus = Number(referrerProfile?.package?.direct_referral_bonus || 0)
        await creditDirectReferralBonus(referrer.id, newUser.id, directBonus)

        if (otherSideExists) {
          await checkAndFirePairingBonus(
            actual_parent_node_id,
            newUser.id,
            actual_position as 'left' | 'right'
          )
        }
      } catch (e) {
        console.error('[REGISTER] Commission error:', e)
      }
    }

    // Success response
    const packageWithProducts = await prisma.package.findUnique({
      where:  { id: pin.package_id },
      select: {
        name: true, price: true,
        products: {
          select: {
            quantity: true,
            product: { select: { name: true, type: true } },
          },
        },
      },
    })

    return NextResponse.json({
      success:  true,
      message:  `${full_name} has been registered successfully.`,
      reseller: { full_name, username: username.trim().toLowerCase() },
      package:  packageWithProducts ? {
        name:     packageWithProducts.name,
        price:    Number(packageWithProducts.price),
        products: packageWithProducts.products.map((p) => ({
          name:     p.product.name,
          type:     p.product.type,
          quantity: p.quantity,
        })),
      } : null,
    })
  } catch (error: any) {
    console.error('[REGISTER RESELLER ERROR]', error?.message || error)
    return NextResponse.json(
      { error: `Registration failed: ${error?.message || 'Please try again.'}` },
      { status: 500 }
    )
  }
}