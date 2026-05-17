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
  // Single recursive CTE — walks entire ancestor chain in one DB round trip
  // Much faster than looping with 2 queries per level
  //
  // Strategy:
  // 1. Start at parentNodeId — increment based on positionUnderParent
  // 2. Walk up — for each ancestor, increment based on which side
  //    the previous node was positioned under it
  //
  // We do this by fetching the full ancestor chain first (1 query),
  // then doing targeted updates per node (still parallel-safe)

  // Step 1: Fetch full ancestor chain in one recursive query
  const ancestors = await prisma.$queryRaw<{
    id: string
    parent_id: string | null
    position: string | null
  }[]>`
    WITH RECURSIVE ancestor_chain AS (
      -- Start: the parent node of the newly placed reseller
      SELECT id, parent_id, position
      FROM binary_tree_nodes
      WHERE id = ${parentNodeId}

      UNION ALL

      -- Walk up to each ancestor
      SELECT n.id, n.parent_id, n.position
      FROM binary_tree_nodes n
      INNER JOIN ancestor_chain a ON n.id = a.parent_id
    )
    SELECT id, parent_id, position FROM ancestor_chain
  `

  if (!ancestors || ancestors.length === 0) return

  // Step 2: For each ancestor, determine which side to increment
  // The first node (parentNodeId) increments based on positionUnderParent
  // Each subsequent ancestor increments based on its child's position
  const updates: Promise<any>[] = []

  for (let i = 0; i < ancestors.length; i++) {
    const node = ancestors[i]

    // Which side do we increment for this ancestor?
    // - For the first node: use positionUnderParent (the new reseller's position)
    // - For subsequent nodes: use the position of the node below it (ancestors[i-1].position)
    const side = i === 0
      ? positionUnderParent
      : (ancestors[i - 1].position as 'left' | 'right')

    if (!side) continue

    updates.push(
      side === 'left'
        ? prisma.$executeRaw`UPDATE binary_tree_nodes SET left_count = left_count + 1 WHERE id = ${node.id}`
        : prisma.$executeRaw`UPDATE binary_tree_nodes SET right_count = right_count + 1 WHERE id = ${node.id}`
    )
  }

  // Run all updates in parallel — one round trip per update but all concurrent
  await Promise.all(updates)
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

// ── Fire pairing bonus at a node ──
// Bonus = lowest package value of the two paired resellers
// + any pending_pairing_balance from previous higher-package pairings
// Remainder saved back to pending_pairing_balance for next pairing
async function firePairingAtNode(
  nodeId: string,
  newUserId: string,
  leftChildId: string,
  rightChildId: string
) {
  // Get both children's package values
  const [leftNode, rightNode, parentNode] = await Promise.all([
    prisma.binaryTreeNode.findUnique({
      where:  { id: leftChildId },
      select: {
        user: {
          select: {
            reseller_profile: {
              select: { package: { select: { pairing_bonus_value: true } } },
            },
          },
        },
      },
    }),
    prisma.binaryTreeNode.findUnique({
      where:  { id: rightChildId },
      select: {
        user: {
          select: {
            reseller_profile: {
              select: { package: { select: { pairing_bonus_value: true } } },
            },
          },
        },
      },
    }),
    prisma.binaryTreeNode.findUnique({
      where:  { id: nodeId },
      select: {
        id:      true,
        user_id: true,
        parent_id: true,
        user: {
          select: {
            reseller_profile: {
              select: {
                pending_pairing_balance: true,
                package: { select: { pairing_bonus_value: true } },
              },
            },
          },
        },
      },
    }),
  ])

  if (!parentNode?.user.reseller_profile) return

  const leftBonus    = Number(leftNode?.user.reseller_profile?.package?.pairing_bonus_value  || 0)
  const rightBonus   = Number(rightNode?.user.reseller_profile?.package?.pairing_bonus_value || 0)
  const pendingBal   = Number(parentNode.user.reseller_profile.pending_pairing_balance || 0)

  // Bonus = lowest of the two paired packages + any pending balance
  const lowestBonus  = Math.min(leftBonus, rightBonus)
  const remainder    = Math.abs(leftBonus - rightBonus) // difference stays pending
  const totalBonus   = lowestBonus + pendingBal         // add any pending from before

  console.log(`[PAIRING] Node ${nodeId} | left:₱${leftBonus} right:₱${rightBonus} pending:₱${pendingBal} | bonus:₱${totalBonus} new_remainder:₱${remainder}`)

  if (totalBonus <= 0) return

  // Credit bonus to this node's owner
  await prisma.commission.create({
    data: {
      user_id:           parentNode.user_id,
      type:              'binary_pairing',
      amount:            totalBonus,
      source_user_id:    newUserId,
      cascade_remainder: remainder > 0 ? remainder : null,
      is_pair_overflow:  false,
    },
  })

  await prisma.wallet.update({
    where: { user_id: parentNode.user_id },
    data:  { balance: { increment: totalBonus }, total_earned: { increment: totalBonus } },
  })

  // Save remainder as pending for next pairing
  await prisma.resellerProfile.update({
    where: { user_id: parentNode.user_id },
    data:  { pending_pairing_balance: remainder },
  })

  console.log(`[PAIRING] ✅ ₱${totalBonus} → ${parentNode.user_id} | new pending: ₱${remainder}`)
}

// ── Check and fire pairing bonus walking UP the tree ──
// Uses recursive CTE to fetch entire ancestor chain in ONE query
// then processes each level — safe for deep trees on Vercel
async function checkAndFirePairingBonus(
  parentNodeId: string,
  newUserId: string,
  newPosition: 'left' | 'right'
) {
  // Step 1: Fetch entire ancestor chain + their children in one CTE
  const ancestors = await prisma.$queryRaw<{
    id: string
    parent_id: string | null
    position: string | null
  }[]>`
    WITH RECURSIVE ancestor_chain AS (
      SELECT id, parent_id, position
      FROM binary_tree_nodes
      WHERE id = ${parentNodeId}

      UNION ALL

      SELECT n.id, n.parent_id, n.position
      FROM binary_tree_nodes n
      INNER JOIN ancestor_chain a ON n.id = a.parent_id
    )
    SELECT id, parent_id, position FROM ancestor_chain
  `

  if (!ancestors || ancestors.length === 0) return

  // Step 2: Fetch ALL children for ALL ancestors in two batch queries
  const ancestorIds = ancestors.map((a) => a.id)

  const [allLeftChildren, allRightChildren] = await Promise.all([
    prisma.binaryTreeNode.findMany({
      where:  { parent_id: { in: ancestorIds }, position: 'left' },
      select: { id: true, parent_id: true },
    }),
    prisma.binaryTreeNode.findMany({
      where:  { parent_id: { in: ancestorIds }, position: 'right' },
      select: { id: true, parent_id: true },
    }),
  ])

  const leftMap  = new Map(allLeftChildren.map((c)  => [c.parent_id, c.id]))
  const rightMap = new Map(allRightChildren.map((c) => [c.parent_id, c.id]))

  // Process each ancestor — only fire if both sides exist
  // Run sequentially to preserve order (bottom up)
  for (const ancestor of ancestors) {
    const leftId  = leftMap.get(ancestor.id)
    const rightId = rightMap.get(ancestor.id)

    if (!leftId || !rightId) {
      console.log(`[PAIRING] Node ${ancestor.id} missing a leg — skip`)
      continue
    }

    await firePairingAtNode(ancestor.id, newUserId, leftId, rightId)
  }
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

    // ── Username format validation ──
    // Must start with a letter, contain only letters and numbers
    const cleanUsername = username.trim().toLowerCase()
    if (!/^[a-z][a-z0-9]*$/.test(cleanUsername)) {
      return NextResponse.json({
        error: 'Username must start with a letter and contain only letters and numbers.',
      }, { status: 400 })
    }

    // ── Generate expected username base from full name ──
    // Format: firstname + initials of remaining names + optional trailing numbers
    const nameParts    = full_name.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const firstName    = nameParts[0]?.replace(/[^a-z]/g, '') || ''
    const initials     = nameParts.slice(1).map((p: string) => p.replace(/[^a-z]/g, '')[0] || '').join('')
    const expectedBase = (firstName + initials).replace(/[^a-z0-9]/g, '')
    const usernameBase = cleanUsername.replace(/[0-9]+$/, '')

    if (usernameBase !== expectedBase) {
      return NextResponse.json({
        error: `Username must follow the format: "${expectedBase}" or "${expectedBase}1", "${expectedBase}2", etc.`,
      }, { status: 400 })
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
        select: { product_id: true, quantity: true, product: { select: { name: true } } },
      }),
      prisma.binaryTreeNode.findFirst({
        where:  { parent_id: actual_parent_node_id, position: actual_position === 'left' ? 'right' : 'left' },
        select: { id: true },
      }),
    ])

    // ── Validate city distributor has enough stock — single batch query ──
    const packageProductIds = packageProducts.map((pp) => pp.product_id)
    const inventoryItems    = await prisma.inventory.findMany({
      where:  { owner_id: user.id, product_id: { in: packageProductIds } },
      select: { product_id: true, quantity: true },
    })
    const inventoryMap = new Map(inventoryItems.map((i) => [i.product_id, i.quantity]))

    const stockErrors = packageProducts
      .filter((pp) => (inventoryMap.get(pp.product_id) ?? 0) < pp.quantity)
      .map((pp) => `"${pp.product.name}": need ${pp.quantity}, only ${inventoryMap.get(pp.product_id) ?? 0} in stock`)

    if (stockErrors.length > 0) {
      return NextResponse.json({
        error: `Insufficient inventory to complete registration:\n${stockErrors.join('\n')}`,
      }, { status: 400 })
    }

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

    // Deduct package inventory — all in parallel
    try {
      await Promise.all(
        packageProducts.map((pp) =>
          prisma.inventory.updateMany({
            where: { owner_id: user.id, product_id: pp.product_id },
            data:  { quantity: { decrement: pp.quantity } },
          })
        )
      )
    } catch (e) {
      console.error('[REGISTER] Inventory deduct error:', e)
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