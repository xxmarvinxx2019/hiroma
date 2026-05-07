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
      // actual_parent_node_id = the node the city dist selected in the visual tree
      // actual_position = left or right slot under that node
      actual_parent_node_id,
      actual_position,
    } = await req.json()

    if (!full_name || !username || !mobile || !password || !pin_id ||
      !referrer_username || !actual_parent_node_id || !actual_position) {
      return NextResponse.json(
        { error: 'All required fields must be filled.' },
        { status: 400 }
      )
    }

    console.log('[REGISTER] Starting:', username, '| parent node:', actual_parent_node_id, '| position:', actual_position)

    // ── Check username uniqueness ──
    const existingUser = await prisma.user.findUnique({
      where: { username: username.trim().toLowerCase() },
    })
    if (existingUser) {
      return NextResponse.json({ error: 'Username already taken.' }, { status: 400 })
    }

    // ── Check email uniqueness if provided ──
    if (email?.trim()) {
      const existingEmail = await prisma.user.findUnique({
        where: { email: email.trim().toLowerCase() },
      })
      if (existingEmail) {
        return NextResponse.json({ error: 'Email is already in use.' }, { status: 400 })
      }
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

    // ── Verify the selected slot is still available ──
    const slotTaken = await prisma.binaryTreeNode.findFirst({
      where: { parent_id: actual_parent_node_id, position: actual_position },
    })
    if (slotTaken) {
      return NextResponse.json({
        error: 'This slot was just taken by another registration. Please refresh and try again.',
      }, { status: 400 })
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

    // ── Get referrer's package for pairing bonus ──
    const referrerProfile = !isHiromaNode
      ? await prisma.resellerProfile.findUnique({
          where: { user_id: referrer.id },
          select: {
            daily_referral_count: true,
            last_referral_date: true,
            package: {
              select: {
                pairing_bonus_value: true,
                direct_referral_bonus: true,
              },
            },
          },
        })
      : null

    // ── Check daily referral cap ──
    let overflowToHiroma = false
    if (!isHiromaNode && referrerProfile) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const isToday = referrerProfile.last_referral_date
        ? new Date(referrerProfile.last_referral_date) >= today
        : false
      const dailyCount = isToday ? referrerProfile.daily_referral_count : 0
      overflowToHiroma = dailyCount >= 10
    }

    const hashedPassword = await hashPassword(password)

    // ── Get referrer's binary tree node ──
    const referrerNode = await prisma.binaryTreeNode.findUnique({
      where: { user_id: referrer.id },
      select: { id: true },
    })

    await prisma.$transaction(async (tx) => {
      // 1. Create user
      const newUser = await tx.user.create({
        data: {
          username: username.trim().toLowerCase(),
          full_name: full_name.trim(),
          email: email?.trim().toLowerCase() || null,
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

      // 4. Create binary tree node at chosen slot
      await tx.binaryTreeNode.create({
        data: {
          user_id: newUser.id,
          parent_id: actual_parent_node_id,
          position: actual_position,
          sponsor_id: referrer.id,
          left_count: 0,
          right_count: 0,
          is_overflow: overflowToHiroma,
        },
      })

      // 5. Update parent node leg count
      await tx.binaryTreeNode.update({
        where: { id: actual_parent_node_id },
        data: actual_position === 'left'
          ? { left_count: { increment: 1 } }
          : { right_count: { increment: 1 } },
      })

      // 6. Mark PIN as used
      await tx.pin.update({
        where: { id: pin.id },
        data: { status: 'used', used_by: newUser.id, used_at: new Date() },
      })

      // 7. Update name cap registry
      await tx.nameCapRegistry.upsert({
        where: { normalized_name: normalizedName },
        update: { count: { increment: 1 } },
        create: { normalized_name: normalizedName, count: 1, max_allowed: 7 },
      })

      // 8. Update referrer daily count
      if (!isHiromaNode && !overflowToHiroma && referrerNode) {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const isToday = referrerProfile?.last_referral_date
          ? new Date(referrerProfile.last_referral_date) >= today
          : false

        await tx.resellerProfile.update({
          where: { user_id: referrer.id },
          data: {
            daily_referral_count: isToday ? { increment: 1 } : 1,
            last_referral_date: new Date(),
          },
        })

        // 9. ── CHECK PAIRING BONUS ──
        // A pairing bonus fires when the parent node now has BOTH left and right children
        // and the sponsor of those children is the same referrer
        if (referrerNode) {
          const parentLeftChild = await tx.binaryTreeNode.findFirst({
            where: { parent_id: actual_parent_node_id, position: 'left' },
            select: { id: true, sponsor_id: true },
          })
          const parentRightChild = await tx.binaryTreeNode.findFirst({
            where: { parent_id: actual_parent_node_id, position: 'right' },
            select: { id: true, sponsor_id: true },
          })

          // Both slots filled under this parent node
          if (parentLeftChild && parentRightChild) {
            // Find the owner of the parent node to credit pairing bonus
            const parentNode = await tx.binaryTreeNode.findUnique({
              where: { id: actual_parent_node_id },
              select: {
                user_id: true,
                user: {
                  select: {
                    reseller_profile: {
                      select: {
                        package: {
                          select: {
                            pairing_bonus_value: true,
                            direct_referral_bonus: true,
                          },
                        },
                      },
                    },
                    wallet: { select: { balance: true } },
                  },
                },
              },
            })

            if (parentNode && parentNode.user.reseller_profile?.package) {
              const pairingBonus = Number(
                parentNode.user.reseller_profile.package.pairing_bonus_value
              )

              if (pairingBonus > 0) {
                // Credit pairing bonus to parent node owner
                await tx.commission.create({
                  data: {
                    user_id: parentNode.user_id,
                    type: 'binary_pairing',
                    amount: pairingBonus,
                    source_user_id: newUser.id,
                    is_pair_overflow: false,
                  },
                })

                // Add to wallet
                await tx.wallet.update({
                  where: { user_id: parentNode.user_id },
                  data: {
                    balance: { increment: pairingBonus },
                    total_earned: { increment: pairingBonus },
                  },
                })

                console.log('[REGISTER] Pairing bonus ₱', pairingBonus, 'credited to', parentNode.user_id)
              }
            }
          }
        }

        // 10. ── DIRECT REFERRAL BONUS ──
        // Credit direct referral bonus to the referrer
        if (referrerProfile?.package?.direct_referral_bonus) {
          const directBonus = Number(referrerProfile.package.direct_referral_bonus)

          if (directBonus > 0) {
            await tx.commission.create({
              data: {
                user_id: referrer.id,
                type: 'direct_referral',
                amount: directBonus,
                source_user_id: newUser.id,
                is_pair_overflow: false,
              },
            })

            await tx.wallet.update({
              where: { user_id: referrer.id },
              data: {
                balance: { increment: directBonus },
                total_earned: { increment: directBonus },
              },
            })

            console.log('[REGISTER] Direct referral bonus ₱', directBonus, 'credited to referrer:', referrer.id)
          }
        }
      }
    })

    console.log('[REGISTER] ✅ Complete for:', username)

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