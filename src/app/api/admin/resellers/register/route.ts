import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, hashPassword } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { sendSMS, smsWelcomeReseller } from '@/app/lib/sms'

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
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
      return NextResponse.json({ error: 'Username must start with a letter and contain only letters and numbers.' }, { status: 400 })
    }

    // Validate username format
    const nameParts    = full_name.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const firstName    = nameParts[0]?.replace(/[^a-z]/g, '') || ''
    const initials     = nameParts.slice(1).map((p: string) => p.replace(/[^a-z]/g, '')[0] || '').join('')
    const expectedBase = (firstName + initials).replace(/[^a-z0-9]/g, '')
    const usernameBase = cleanUsername.replace(/[0-9]+$/, '')

    if (usernameBase !== expectedBase) {
      return NextResponse.json({
        error: `Username must follow the format: "${expectedBase}" or "${expectedBase}1", etc.`,
      }, { status: 400 })
    }

    // Run pre-checks in parallel
    const [existingUser, pin, slotTaken, parentNodeExists, referrer] = await Promise.all([
      prisma.user.findUnique({ where: { username: cleanUsername } }),
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

    if (existingUser)    return NextResponse.json({ error: 'Username already taken.' }, { status: 400 })
    if (!pin || pin.status !== 'unused') return NextResponse.json({ error: 'PIN is invalid or already used.' }, { status: 400 })
    if (pin.city_dist_id !== user.id)    return NextResponse.json({ error: 'This PIN does not belong to admin.' }, { status: 400 })
    if (slotTaken)       return NextResponse.json({ error: 'Slot already taken. Please refresh.' }, { status: 400 })
    if (!parentNodeExists) return NextResponse.json({ error: 'Parent node not found.' }, { status: 400 })
    if (!referrer)       return NextResponse.json({ error: 'Referrer not found.' }, { status: 400 })

    const normalizedName = full_name.trim().toLowerCase()
    const nameCap = await prisma.nameCapRegistry.findUnique({ where: { normalized_name: normalizedName } })
    if (nameCap && nameCap.count >= nameCap.max_allowed) {
      return NextResponse.json({ error: `Maximum accounts (${nameCap.max_allowed}) reached for "${full_name}".` }, { status: 400 })
    }

    const isHiromaNode   = referrer.username === 'hiroma'

    // Check referrer daily cap
    const referrerProfile = !isHiromaNode ? await prisma.resellerProfile.findUnique({
      where:  { user_id: referrer.id },
      select: { daily_referral_count: true, last_referral_date: true, package: { select: { direct_referral_bonus: true } } },
    }) : null

    let overflowToHiroma = false
    if (!isHiromaNode && referrerProfile) {
      const today    = new Date(); today.setHours(0, 0, 0, 0)
      const isToday  = referrerProfile.last_referral_date ? new Date(referrerProfile.last_referral_date) >= today : false
      const count    = isToday ? referrerProfile.daily_referral_count : 0
      overflowToHiroma = count >= 10
    }

    // Fetch package products
    const packageProducts = await prisma.packageProduct.findMany({
      where:  { package_id: pin.package_id },
      select: { product_id: true, quantity: true, product: { select: { name: true } } },
    })

    // Check admin's inventory
    const productIds   = packageProducts.map((pp) => pp.product_id)
    const inventoryItems = await prisma.inventory.findMany({
      where:  { owner_id: user.id, product_id: { in: productIds } },
      select: { product_id: true, quantity: true },
    })
    const inventoryMap = new Map(inventoryItems.map((i) => [i.product_id, i.quantity]))

    const stockErrors = packageProducts
      .filter((pp) => (inventoryMap.get(pp.product_id) ?? 0) < pp.quantity)
      .map((pp) => `"${pp.product.name}": need ${pp.quantity}, only ${inventoryMap.get(pp.product_id) ?? 0} in stock`)

    if (stockErrors.length > 0) {
      return NextResponse.json({ error: `Insufficient inventory:\n${stockErrors.join('\n')}` }, { status: 400 })
    }

    const hashedPassword = await hashPassword(password)

    // Create user in transaction
    const newUser = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          username:      cleanUsername,
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
          city_dist_id:         user.id,  // admin acts as city dist
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
          user_id:    created.id,
          parent_id:  actual_parent_node_id,
          position:   actual_position,
          sponsor_id: overflowToHiroma ? null : referrer.id,
          left_count:  0, right_count: 0,
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

    // Post-transaction: deduct inventory
    try {
      await Promise.all(packageProducts.map((pp) =>
        prisma.inventory.updateMany({
          where: { owner_id: user.id, product_id: pp.product_id },
          data:  { quantity: { decrement: pp.quantity } },
        })
      ))
    } catch (e) { console.error('[ADMIN REGISTER] Inventory error:', e) }

    // Update ancestor counts
    try {
      const ancestors = await prisma.$queryRaw<{ id: string; parent_id: string | null; position: string | null }[]>`
        WITH RECURSIVE ancestor_chain AS (
          SELECT id, parent_id, position FROM binary_tree_nodes WHERE id = ${actual_parent_node_id}
          UNION ALL
          SELECT n.id, n.parent_id, n.position FROM binary_tree_nodes n
          INNER JOIN ancestor_chain a ON n.id = a.parent_id
        ) SELECT id, parent_id, position FROM ancestor_chain
      `
      await Promise.all(ancestors.map((node, i) => {
        const side = i === 0 ? actual_position : (ancestors[i - 1].position as string)
        if (!side) return Promise.resolve()
        return side === 'left'
          ? prisma.$executeRaw`UPDATE binary_tree_nodes SET left_count = left_count + 1 WHERE id = ${node.id}`
          : prisma.$executeRaw`UPDATE binary_tree_nodes SET right_count = right_count + 1 WHERE id = ${node.id}`
      }))
    } catch (e) { console.error('[ADMIN REGISTER] Ancestor count error:', e) }

    // Direct referral bonus
    if (!overflowToHiroma && !isHiromaNode) {
      try {
        const today   = new Date(); today.setHours(0, 0, 0, 0)
        const isToday = referrerProfile?.last_referral_date ? new Date(referrerProfile.last_referral_date) >= today : false
        await prisma.resellerProfile.update({
          where: { user_id: referrer.id },
          data:  { daily_referral_count: isToday ? { increment: 1 } : 1, last_referral_date: new Date() },
        })
        const directBonus = Number(referrerProfile?.package?.direct_referral_bonus || 0)
        if (directBonus > 0) {
          await prisma.commission.create({ data: { user_id: referrer.id, type: 'direct_referral', amount: directBonus, source_user_id: newUser.id, is_pair_overflow: false } })
          await prisma.wallet.update({ where: { user_id: referrer.id }, data: { balance: { increment: directBonus }, total_earned: { increment: directBonus } } })
        }
      } catch (e) { console.error('[ADMIN REGISTER] Referral bonus error:', e) }
    }

    // Binary pairing
    try {
      const pkg = await prisma.package.findUnique({ where: { id: pin.package_id }, select: { pairing_bonus_value: true } })
      const newUserPts = Number(pkg?.pairing_bonus_value || 0)
      if (newUserPts > 0) {
        // Reuse the same firePointsPairingBonus logic via city resellers endpoint
        // by calling it directly here (simplified version)
        const ancestors = await prisma.$queryRaw<{ id: string; user_id: string; parent_id: string | null; position: string | null }[]>`
          WITH RECURSIVE ancestor_chain AS (
            SELECT id, user_id, parent_id, position FROM binary_tree_nodes WHERE id = ${actual_parent_node_id}
            UNION ALL
            SELECT n.id, n.user_id, n.parent_id, n.position FROM binary_tree_nodes n
            INNER JOIN ancestor_chain a ON n.id = a.parent_id
          ) SELECT id, user_id, parent_id, position FROM ancestor_chain
        `
        const hiromaUser = await prisma.user.findFirst({ where: { username: 'hiroma' }, select: { id: true } })
        const today = new Date(); today.setHours(0, 0, 0, 0)
        let currentLeg = actual_position as 'left' | 'right'

        for (let i = 0; i < ancestors.length; i++) {
          const ancestor = ancestors[i]

          // Fresh read per ancestor to avoid stale data
          const profile = await prisma.resellerProfile.findUnique({
            where:  { user_id: ancestor.user_id },
            select: { user_id: true, left_points: true, right_points: true, daily_pairing_count: true, daily_pairing_date: true, package: { select: { pairing_bonus_value: true } } },
          })
          if (!profile) { currentLeg = (ancestor.position as 'left' | 'right') || currentLeg; continue }

          const ancestorPkgPts = Number(profile.package?.pairing_bonus_value || 0)
          if (ancestorPkgPts <= 0) { currentLeg = (ancestor.position as 'left' | 'right') || currentLeg; continue }

          const isToday = profile.daily_pairing_date ? new Date(profile.daily_pairing_date) >= today : false
          let leftPts   = Number(profile.left_points  || 0)
          let rightPts  = Number(profile.right_points || 0)

          if (currentLeg === 'left') leftPts  += newUserPts
          else                       rightPts += newUserPts

          // Option C: pointsPerPair = MIN(ancestor pkg, new reseller pkg)
          const pointsPerPair = Math.min(ancestorPkgPts, newUserPts)

          // Pair fires when both sides have any points
          const matchable     = Math.min(leftPts, rightPts)
          const possiblePairs = matchable > 0 ? 1 : 0

          if (possiblePairs > 0) {
            const usedToday    = isToday ? Number(profile.daily_pairing_count || 0) : 0
            const paidPairs    = Math.min(possiblePairs, Math.max(0, 10 - usedToday))
            const paidEarnings = paidPairs * matchable * 0.50
            const deduct       = matchable
            leftPts  -= deduct; rightPts -= deduct

            if (paidPairs > 0 && paidEarnings > 0) {
              await prisma.commission.create({ data: { user_id: ancestor.user_id, type: 'binary_pairing', amount: paidEarnings, points: paidPairs * matchable, source_user_id: newUser.id, is_pair_overflow: false } })
              await prisma.wallet.update({ where: { user_id: ancestor.user_id }, data: { balance: { increment: paidEarnings }, total_earned: { increment: paidEarnings } } })
            }
            await prisma.resellerProfile.update({
              where: { user_id: ancestor.user_id },
              data:  { left_points: leftPts, right_points: rightPts, daily_pairing_count: isToday ? { increment: paidPairs } : paidPairs, daily_pairing_date: today },
            })
          } else {
            await prisma.resellerProfile.update({ where: { user_id: ancestor.user_id }, data: { left_points: leftPts, right_points: rightPts } })
          }
          currentLeg = (ancestor.position as 'left' | 'right') || currentLeg
        }
      }
    } catch (e) { console.error('[ADMIN REGISTER] Binary pairing error:', e) }

    // Return success
    const packageWithProducts = await prisma.package.findUnique({
      where:  { id: pin.package_id },
      select: { name: true, price: true, products: { select: { quantity: true, product: { select: { name: true, type: true, price: true } } } } },
    })

    // ── Send welcome SMS ──
   /* try {
      const pkg = packageWithProducts
      const smsMessage = smsWelcomeReseller({
        full_name,
        username:     cleanUsername,
        password,
        package_name: pkg?.name || 'Starter',
      })
      await sendSMS(mobile, smsMessage)
    } catch (e) {
      console.error('[ADMIN REGISTER] SMS error:', e)
      // Non-blocking — registration still succeeds even if SMS fails
    }
  */
    return NextResponse.json({
      success:  true,
      message:  `${full_name} has been registered successfully.`,
      reseller: { full_name, username: cleanUsername },
      package:  packageWithProducts ? {
        name:           packageWithProducts.name,
        pin_price:      Number(packageWithProducts.price),
        products_total: packageWithProducts.products.reduce((s, p) => s + Number(p.product.price || 0) * p.quantity, 0),
        total_price:    Number(packageWithProducts.price) + packageWithProducts.products.reduce((s, p) => s + Number(p.product.price || 0) * p.quantity, 0),
        products:       packageWithProducts.products.map((p) => ({ name: p.product.name, type: p.product.type, quantity: p.quantity, srp: Number(p.product.price || 0), subtotal: Number(p.product.price || 0) * p.quantity })),
      } : null,
    })
  } catch (error: any) {
    console.error('[ADMIN REGISTER RESELLER ERROR]', error?.message || error)
    return NextResponse.json({ error: `Registration failed: ${error?.message || 'Please try again.'}` }, { status: 500 })
  }
}