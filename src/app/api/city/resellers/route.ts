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
// HELPERS
// ============================================================

// Walk ALL ancestors and update their leg counts correctly
// We trace from the placed node's parent upward
// At each ancestor, we need to know which side the new node is on
async function updateAncestorCounts(
  tx: any,
  parentNodeId: string,
  positionUnderParent: 'left' | 'right'
) {
  let currentId  = parentNodeId
  let currentPos = positionUnderParent

  while (currentId) {
    // Increment this node's count on the correct side
    await tx.binaryTreeNode.update({
      where: { id: currentId },
      data: currentPos === 'left'
        ? { left_count: { increment: 1 } }
        : { right_count: { increment: 1 } },
    })

    // Move up to this node's parent
    const thisNode = await tx.binaryTreeNode.findUnique({
      where:  { id: currentId },
      select: { parent_id: true, position: true },
    })

    if (!thisNode?.parent_id) break

    // The position for the next ancestor is THIS node's position in its parent
    currentPos = thisNode.position as 'left' | 'right'
    currentId  = thisNode.parent_id
  }
}

// Credit direct referral bonus
async function creditDirectReferralBonus(
  tx: any,
  referrerId: string,
  newUserId: string,
  amount: number
) {
  if (amount <= 0) return

  await tx.commission.create({
    data: {
      user_id:          referrerId,
      type:             'direct_referral',
      amount,
      source_user_id:   newUserId,
      is_pair_overflow: false,
    },
  })

  await tx.wallet.update({
    where: { user_id: referrerId },
    data: {
      balance:      { increment: amount },
      total_earned: { increment: amount },
    },
  })

  console.log('[BINARY] Direct referral ₱', amount, '→', referrerId)
}

// Credit pairing bonus with cascade rule
// Rule: upline claims their tier's pairing_bonus_value first.
// If remaining > 0 after upline claims, cascade DOWN to the next node
// until remaining is exhausted or no more nodes.
async function creditPairingBonusWithCascade(
  tx: any,
  startNodeId: string,
  newUserId: string,
  triggerBonusAmount: number
) {
  let currentNodeId: string | null = startNodeId
  let remaining                    = triggerBonusAmount

  while (currentNodeId && remaining > 0) {
    const node = await tx.binaryTreeNode.findUnique({
      where:  { id: currentNodeId },
      select: {
        id:        true,
        user_id:   true,
        parent_id: true,
        user: {
          select: {
            reseller_profile: {
              select: {
                package: { select: { pairing_bonus_value: true } },
              },
            },
          },
        },
      },
    })

    if (!node) break

    const uplineTierBonus = Number(
      node.user.reseller_profile?.package?.pairing_bonus_value || 0
    )

    if (uplineTierBonus <= 0) {
      // No bonus tier — move to parent
      currentNodeId = node.parent_id
      continue
    }

    // How much does this upline claim?
    const claimed   = Math.min(uplineTierBonus, remaining)
    remaining      -= claimed

    await tx.commission.create({
      data: {
        user_id:           node.user_id,
        type:              'binary_pairing',
        amount:            claimed,
        source_user_id:    newUserId,
        cascade_remainder: remaining > 0 ? remaining : null,
        is_pair_overflow:  false,
      },
    })

    await tx.wallet.update({
      where: { user_id: node.user_id },
      data: {
        balance:      { increment: claimed },
        total_earned: { increment: claimed },
      },
    })

    console.log('[BINARY] Pairing ₱', claimed, '→', node.user_id, '| remaining:', remaining)

    // Cascade remaining to parent
    currentNodeId = node.parent_id
  }
}

// Check if pairing bonus should fire at parentNode
// Fires when BOTH left and right slots under parentNode are now filled
// We pass the newPosition of the just-created node so we check the OTHER side
async function checkAndFirePairingBonus(
  tx: any,
  parentNodeId: string,
  newUserId: string,
  newPosition: 'left' | 'right'
) {
  // Check the OPPOSITE side — if it already has a child, we have a pair
  const otherPosition = newPosition === 'left' ? 'right' : 'left'

  const otherChild = await tx.binaryTreeNode.findFirst({
    where:  { parent_id: parentNodeId, position: otherPosition },
    select: { id: true, user_id: true },
  })

  // The newly created node is not yet visible in this query since it was
  // just inserted — but the OTHER side should already exist if it was placed before.
  // No other child = no pair yet.
  if (!otherChild) return

  // Both sides filled — get parent node owner's bonus value
  const parentNode = await tx.binaryTreeNode.findUnique({
    where:  { id: parentNodeId },
    select: {
      id:      true,
      user_id: true,
      user: {
        select: {
          reseller_profile: {
            select: {
              package: { select: { pairing_bonus_value: true } },
            },
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

  console.log('[BINARY] Pair detected under node', parentNodeId, '— firing ₱', pairingBonusValue)

  // Fire pairing bonus starting at the parent node with cascade
  await creditPairingBonusWithCascade(
    tx,
    parentNodeId,
    newUserId,
    pairingBonusValue
  )
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
      full_name,
      username,
      email,
      mobile,
      password,
      address,
      pin_id,
      referrer_username,
      actual_parent_node_id,
      actual_position,
    } = await req.json()

    if (
      !full_name || !username || !mobile || !password || !pin_id ||
      !referrer_username || !actual_parent_node_id || !actual_position
    ) {
      return NextResponse.json(
        { error: 'All required fields must be filled.' },
        { status: 400 }
      )
    }

    if (!['left', 'right'].includes(actual_position)) {
      return NextResponse.json({ error: 'Invalid position.' }, { status: 400 })
    }

    console.log('[REGISTER] Starting:', username, '| parent:', actual_parent_node_id, '| pos:', actual_position)

    // ── Username uniqueness ──
    const existingUser = await prisma.user.findUnique({
      where: { username: username.trim().toLowerCase() },
    })
    if (existingUser) {
      return NextResponse.json({ error: 'Username already taken.' }, { status: 400 })
    }

    // ── Email uniqueness ──
    if (email?.trim()) {
      const existingEmail = await prisma.user.findFirst({
        where: { email: email.trim().toLowerCase() },
      })
      if (existingEmail) {
        return NextResponse.json({ error: 'Email already in use.' }, { status: 400 })
      }
    }

    // ── Name cap ──
    const normalizedName = full_name.trim().toLowerCase()
    const nameCap = await prisma.nameCapRegistry.findUnique({
      where: { normalized_name: normalizedName },
    })
    if (nameCap && nameCap.count >= nameCap.max_allowed) {
      return NextResponse.json({
        error: `Maximum accounts (${nameCap.max_allowed}) reached for the name "${full_name}".`,
      }, { status: 400 })
    }

    // ── Verify PIN belongs to this city distributor ──
    const pin = await prisma.pin.findUnique({
      where:  { id: pin_id },
      select: { id: true, status: true, package_id: true, city_dist_id: true },
    })
    if (!pin || pin.status !== 'unused') {
      return NextResponse.json({ error: 'PIN is invalid or already used.' }, { status: 400 })
    }
    if (pin.city_dist_id !== user.id) {
      return NextResponse.json({ error: 'This PIN does not belong to your account.' }, { status: 400 })
    }

    // ── Verify slot is still open ──
    const slotTaken = await prisma.binaryTreeNode.findFirst({
      where: { parent_id: actual_parent_node_id, position: actual_position },
    })
    if (slotTaken) {
      return NextResponse.json({
        error: 'This slot was just taken. Please refresh and try again.',
      }, { status: 400 })
    }

    // ── Validate parent node exists ──
    const parentNodeExists = await prisma.binaryTreeNode.findUnique({
      where: { id: actual_parent_node_id },
    })
    if (!parentNodeExists) {
      return NextResponse.json({ error: 'Parent node not found.' }, { status: 400 })
    }

    // ── Find referrer ──
    const referrer = await prisma.user.findUnique({
      where:  { username: referrer_username.trim().toLowerCase() },
      select: { id: true, username: true, role: true },
    })
    if (!referrer) {
      return NextResponse.json({ error: 'Referrer not found.' }, { status: 400 })
    }

    const isHiromaNode = referrer.username === 'hiroma'

    // ── Get referrer package ──
    const referrerProfile = !isHiromaNode
      ? await prisma.resellerProfile.findUnique({
          where:  { user_id: referrer.id },
          select: {
            daily_referral_count: true,
            last_referral_date:   true,
            package: {
              select: {
                direct_referral_bonus: true,
                pairing_bonus_value:   true,
              },
            },
          },
        })
      : null

    // ── Daily referral cap — max 10/day ──
    let overflowToHiroma = false
    if (!isHiromaNode && referrerProfile) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const isToday    = referrerProfile.last_referral_date
        ? new Date(referrerProfile.last_referral_date) >= today
        : false
      const dailyCount = isToday ? referrerProfile.daily_referral_count : 0
      overflowToHiroma = dailyCount >= 10
    }

    const hashedPassword = await hashPassword(password)

    await prisma.$transaction(async (tx) => {

      // 1. Create user
      const newUser = await tx.user.create({
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

      // 2. Create reseller profile
      await tx.resellerProfile.create({
        data: {
          user_id:              newUser.id,
          package_id:           pin.package_id,
          city_dist_id:         user.id,
          pin_id:               pin.id,
          total_points:         0,
          daily_referral_count: 0,
          daily_pairs_count:    0,
        },
      })

      // 3. Create wallet
      await tx.wallet.create({
        data: {
          user_id:         newUser.id,
          balance:         0,
          total_earned:    0,
          total_withdrawn: 0,
        },
      })

      // 4. ── Check OTHER side BEFORE placing new node ──
      // We must check this before inserting to avoid false positives
      const otherSide    = actual_position === 'left' ? 'right' : 'left'
      const otherSideExists = await tx.binaryTreeNode.findFirst({
        where:  { parent_id: actual_parent_node_id, position: otherSide },
        select: { id: true },
      })
      console.log('[BINARY] Other side exists?', !!otherSideExists, '| side:', otherSide)

      // Now place reseller in binary tree
      await tx.binaryTreeNode.create({
        data: {
          user_id:     newUser.id,
          parent_id:   actual_parent_node_id,
          position:    actual_position,
          sponsor_id:  overflowToHiroma ? null : referrer.id,
          left_count:  0,
          right_count: 0,
          is_overflow: overflowToHiroma,
        },
      })

      // 5. ── Update ALL ancestors' leg counts ──
      await updateAncestorCounts(
        tx,
        actual_parent_node_id,
        actual_position as 'left' | 'right'
      )

      // 6. Mark PIN as used
      await tx.pin.update({
        where: { id: pin.id },
        data:  { status: 'used', used_by: newUser.id, used_at: new Date() },
      })

      // 7. Update name cap
      await tx.nameCapRegistry.upsert({
        where:  { normalized_name: normalizedName },
        update: { count: { increment: 1 } },
        create: { normalized_name: normalizedName, count: 1, max_allowed: 7 },
      })

      // ── Overflow — skip all commissions ──
      if (overflowToHiroma || isHiromaNode) {
        console.log('[REGISTER] Overflow to Hiroma — no commissions')
        return
      }

      // 8. Update referrer daily count
      const today   = new Date()
      today.setHours(0, 0, 0, 0)
      const isToday = referrerProfile?.last_referral_date
        ? new Date(referrerProfile.last_referral_date) >= today
        : false

      await tx.resellerProfile.update({
        where: { user_id: referrer.id },
        data: {
          daily_referral_count: isToday ? { increment: 1 } : 1,
          last_referral_date:   new Date(),
        },
      })

      // 9. ── DIRECT REFERRAL BONUS ──
      const directBonus = Number(referrerProfile?.package?.direct_referral_bonus || 0)
      await creditDirectReferralBonus(tx, referrer.id, newUser.id, directBonus)

      // 10. ── BINARY PAIRING BONUS with cascade ──
      // Only fires if the other side already existed before we placed this node
      if (otherSideExists) {
        console.log('[BINARY] ✅ Pair complete — firing pairing bonus')
        await checkAndFirePairingBonus(
          tx,
          actual_parent_node_id,
          newUser.id,
          actual_position as 'left' | 'right'
        )
      } else {
        console.log('[BINARY] No pair yet — pairing bonus not fired')
      }
    })

    console.log('[REGISTER] ✅ Complete:', username)

    return NextResponse.json({
      success: true,
      message: `${full_name} has been registered successfully.`,
    })
  } catch (error) {
    console.error('[REGISTER RESELLER ERROR]', error)
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}