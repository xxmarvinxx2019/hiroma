import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, hashPassword } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { sendSMS, smsWelcomeReseller } from '@/app/lib/sms'

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

async function updateAncestorCounts(
  parentNodeId: string,
  positionUnderParent: 'left' | 'right'
) {
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

  const updates: Promise<any>[] = []
  for (let i = 0; i < ancestors.length; i++) {
    const node = ancestors[i]
    const side = i === 0 ? positionUnderParent : (ancestors[i - 1].position as 'left' | 'right')
    if (!side) continue
    updates.push(
      side === 'left'
        ? prisma.$executeRaw`UPDATE binary_tree_nodes SET left_count = left_count + 1 WHERE id = ${node.id}`
        : prisma.$executeRaw`UPDATE binary_tree_nodes SET right_count = right_count + 1 WHERE id = ${node.id}`
    )
  }
  await Promise.all(updates)
}

async function creditDirectReferralBonus(referrerId: string, newUserId: string, amount: number) {
  if (amount <= 0) return
  await prisma.commission.create({
    data: { user_id: referrerId, type: 'direct_referral', amount, source_user_id: newUserId, is_pair_overflow: false },
  })
  await prisma.wallet.update({
    where: { user_id: referrerId },
    data:  { balance: { increment: amount }, total_earned: { increment: amount } },
  })
}

// ============================================================
// BINARY PAIRING
// ============================================================

const DAILY_PAIRING_CAP    = 10
const BINARY_POINT_TO_PESO = 0.50

async function firePointsPairingBonus(
  newUserId:    string,
  newUserPts:   number,
  parentNodeId: string,
  newPosition:  'left' | 'right'
) {
  if (newUserPts <= 0) return

  // Fetch entire ancestor chain via CTE
  const ancestors = await prisma.$queryRaw<{
    id:        string
    user_id:   string
    parent_id: string | null
    position:  string | null
  }[]>`
    WITH RECURSIVE ancestor_chain AS (
      SELECT id, user_id, parent_id, position
      FROM binary_tree_nodes
      WHERE id = ${parentNodeId}
      UNION ALL
      SELECT n.id, n.user_id, n.parent_id, n.position
      FROM binary_tree_nodes n
      INNER JOIN ancestor_chain a ON n.id = a.parent_id
    )
    SELECT id, user_id, parent_id, position FROM ancestor_chain
  `

  if (!ancestors || ancestors.length === 0) return

  const hiromaUser = await prisma.user.findFirst({
    where:  { username: 'hiroma' },
    select: { id: true },
  })

  // Fetch reseller profiles + their package pairing_bonus_value
  const ancestorUserIds = ancestors.map((a) => a.user_id)
  console.log(`[BINARY] ancestors: ${ancestors.length}`)
  console.log(`[BINARY] newUserPts: ${newUserPts}, newPosition: ${newPosition}`)

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  let currentLeg = newPosition

  for (let i = 0; i < ancestors.length; i++) {
    const ancestor = ancestors[i]

    // ── Fresh read per ancestor to avoid stale data ──
    const profile = await prisma.resellerProfile.findUnique({
      where:  { user_id: ancestor.user_id },
      select: {
        user_id:             true,
        left_points:         true,
        right_points:        true,
        daily_pairing_count: true,
        daily_pairing_date:  true,
        package: { select: { pairing_bonus_value: true } },
      },
    })

    if (!profile) {
      console.log(`[BINARY] Skip ${ancestor.user_id} — no reseller profile`)
      currentLeg = (ancestor.position as 'left' | 'right') || currentLeg
      continue
    }

    const ancestorPkgPts = Number(profile.package?.pairing_bonus_value || 0)
    if (ancestorPkgPts <= 0) {
      console.log(`[BINARY] Skip ${ancestor.user_id} — no package pts`)
      currentLeg = (ancestor.position as 'left' | 'right') || currentLeg
      continue
    }

    const lastPairDate = profile.daily_pairing_date ? new Date(profile.daily_pairing_date) : null
    const isToday      = lastPairDate ? lastPairDate >= today : false

    let leftPts  = Number(profile.left_points  || 0)
    let rightPts = Number(profile.right_points || 0)

    // Add new reseller's points to correct leg
    if (currentLeg === 'left')  leftPts  += newUserPts
    else                        rightPts += newUserPts

    // A pair fires when BOTH sides have any points
    // pointsPerPair = MIN(ancestor pkg, new reseller pkg) — used for earnings calculation
    const pointsPerPair = Math.min(ancestorPkgPts, newUserPts)

    // Pair fires as long as both sides > 0
    // Use smaller side as the matchable amount
    const matchable     = Math.min(leftPts, rightPts)
    const possiblePairs = matchable > 0 ? 1 : 0

    console.log(`[BINARY] ${ancestor.user_id} | leg:${currentLeg} | L:${leftPts} R:${rightPts} | ppp:${pointsPerPair} | matchable:${matchable} | pairs:${possiblePairs}`)

    console.log(`[BINARY] ${ancestor.user_id} | leg:${currentLeg} | L:${leftPts} R:${rightPts} | ppp:${pointsPerPair} | matchable:${matchable} | pairs:${possiblePairs}`)

    if (possiblePairs > 0) {
      const usedToday = isToday ? Number(profile.daily_pairing_count || 0) : 0  // resets count on new day
      const remaining = Math.max(0, DAILY_PAIRING_CAP - usedToday)

      const paidPairs     = Math.min(possiblePairs, remaining)
      const overflowPairs = possiblePairs - paidPairs

      // earnings based on matchable points (smaller side)
      const paidEarnings     = paidPairs     * matchable * BINARY_POINT_TO_PESO
      const overflowEarnings = overflowPairs * matchable * BINARY_POINT_TO_PESO

      // deduct matchable from both sides
      const deduct = matchable
      leftPts  -= deduct
      rightPts -= deduct

      // Cap exceeded → flush carry over to HIROMA
      if (overflowPairs > 0) {
        const remainingPts  = Math.min(leftPts, rightPts)
        const flushEarnings = remainingPts * BINARY_POINT_TO_PESO
        if (flushEarnings > 0 && hiromaUser) {
          await prisma.commission.create({
            data: {
              user_id: hiromaUser.id, type: 'binary_pairing',
              amount: flushEarnings, points: remainingPts,
              source_user_id: newUserId, overflow_to: hiromaUser.id, is_pair_overflow: true,
            },
          })
          await prisma.wallet.upsert({
            where:  { user_id: hiromaUser.id },
            update: { balance: { increment: flushEarnings }, total_earned: { increment: flushEarnings } },
            create: { user_id: hiromaUser.id, balance: flushEarnings, total_earned: flushEarnings, total_withdrawn: 0 },
          })
        }
        leftPts  = 0
        rightPts = 0
      }

      console.log(`[BINARY] ✅ ${ancestor.user_id} | paid:${paidPairs} overflow:${overflowPairs} | ₱${paidEarnings}`)

      if (paidPairs > 0 && paidEarnings > 0) {
        await prisma.commission.create({
          data: {
            user_id: ancestor.user_id, type: 'binary_pairing',
            amount: paidEarnings, points: paidPairs * pointsPerPair,
            source_user_id: newUserId, is_pair_overflow: false,
          },
        })
        await prisma.wallet.update({
          where: { user_id: ancestor.user_id },
          data:  { balance: { increment: paidEarnings }, total_earned: { increment: paidEarnings } },
        })
      }

      if (overflowPairs > 0 && overflowEarnings > 0 && hiromaUser) {
        await prisma.commission.create({
          data: {
            user_id: hiromaUser.id, type: 'binary_pairing',
            amount: overflowEarnings, points: overflowPairs * pointsPerPair,
            source_user_id: newUserId, overflow_to: hiromaUser.id, is_pair_overflow: true,
          },
        })
        await prisma.wallet.upsert({
          where:  { user_id: hiromaUser.id },
          update: { balance: { increment: overflowEarnings }, total_earned: { increment: overflowEarnings } },
          create: { user_id: hiromaUser.id, balance: overflowEarnings, total_earned: overflowEarnings, total_withdrawn: 0 },
        })
      }

      await prisma.$executeRawUnsafe(
        `INSERT INTO pairing_logs (id, member_id, left_points_used, right_points_used, pairs_created, commission, date_created)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())`,
        ancestor.user_id,
        currentLeg === 'left'  ? deduct : 0,
        currentLeg === 'right' ? deduct : 0,
        paidPairs,
        paidEarnings
      )

      await prisma.resellerProfile.update({
        where: { user_id: ancestor.user_id },
        data: {
          left_points:         leftPts,
          right_points:        rightPts,
          daily_pairing_count: isToday ? { increment: paidPairs } : paidPairs,  // fresh count on new day
          daily_pairing_date:  today,
        },
      })
    } else {
      // No pair yet — just accumulate points (carry over)
      await prisma.resellerProfile.update({
        where: { user_id: ancestor.user_id },
        data:  { left_points: leftPts, right_points: rightPts },
      })
    }

    // Move up — update leg for next ancestor
    currentLeg = (ancestor.position as 'left' | 'right') || currentLeg
  }

  console.log('[BINARY] Tree walk complete')
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

    const cleanUsername = username.trim().toLowerCase()
    if (!/^[a-z][a-z0-9]*$/.test(cleanUsername)) {
      return NextResponse.json({
        error: 'Username must start with a letter and contain only letters and numbers.',
      }, { status: 400 })
    }

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

    // ── POST-TRANSACTION ──

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

    try {
      await updateAncestorCounts(actual_parent_node_id, actual_position as 'left' | 'right')
    } catch (e) {
      console.error('[REGISTER] Ancestor count error:', e)
    }

    // Direct referral bonus — only if NOT overflow and NOT hiroma
    if (!overflowToHiroma && !isHiromaNode) {
      try {
        const today   = new Date(); today.setHours(0, 0, 0, 0)
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
      } catch (e) {
        console.error('[REGISTER] Direct referral error:', e)
      }
    }

    // Binary pairing — ALWAYS fires regardless of referrer or overflow
    try {
      const pkg = await prisma.package.findUnique({
        where:  { id: pin.package_id },
        select: { pairing_bonus_value: true },
      })
      const newUserPts = Number(pkg?.pairing_bonus_value || 0)
      console.log(`[REGISTER] firing binary pairing | pkg: ${pkg?.pairing_bonus_value} | newUserPts: ${newUserPts} | parentNode: ${actual_parent_node_id} | position: ${actual_position}`)
      await firePointsPairingBonus(
        newUser.id,
        newUserPts,
        actual_parent_node_id,
        actual_position as 'left' | 'right'
      )
      console.log('[REGISTER] binary pairing complete')
    } catch (e) {
      console.error('[REGISTER] Binary pairing error FULL:', e)
      console.error('[REGISTER] Binary pairing stack:', (e as any)?.stack)
    }

    const packageWithProducts = await prisma.package.findUnique({
      where:  { id: pin.package_id },
      select: {
        name: true, price: true,
        products: {
          select: {
            quantity: true,
            product: { select: { name: true, type: true, price: true, reseller_price: true } },
          },
        },
      },
    })

    // ── Send welcome SMS ──
    /*try {
      const smsMessage = smsWelcomeReseller({
        full_name,
        username:     username.trim().toLowerCase(),
        password,
        package_name: packageWithProducts?.name || 'Starter',
      })
      await sendSMS(mobile, smsMessage)
    } catch (e) {
      console.error('[REGISTER] SMS error:', e)
    }*/

    return NextResponse.json({
      success:  true,
      message:  `${full_name} has been registered successfully.`,
      reseller: { full_name, username: username.trim().toLowerCase() },
      package:  packageWithProducts ? (() => {
        const pinPrice      = Number(packageWithProducts.price)
        const productsTotal = packageWithProducts.products.reduce((sum, p) => {
          return sum + (Number(p.product.price || 0) * p.quantity)
        }, 0)
        return {
          name:           packageWithProducts.name,
          pin_price:      pinPrice,
          products_total: productsTotal,
          total_price:    pinPrice + productsTotal,
          products:       packageWithProducts.products.map((p) => ({
            name:     p.product.name,
            type:     p.product.type,
            quantity: p.quantity,
            srp:      Number(p.product.price || 0),
            subtotal: Number(p.product.price || 0) * p.quantity,
          })),
        }
      })() : null,
    })
  } catch (error: any) {
    console.error('[REGISTER RESELLER ERROR]', error?.message || error)
    return NextResponse.json(
      { error: `Registration failed: ${error?.message || 'Please try again.'}` },
      { status: 500 }
    )
  }
}