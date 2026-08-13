import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { answerHiroQuestion, type HiroAccountContext } from '@/app/lib/hiroKnowledge'
import { HIRO_INACTIVITY_MESSAGE, HIRO_INACTIVITY_MS, isHiroCloseRequest, isHiroConversationInactive } from '@/app/lib/hiroConversation'
import { detectHiroLanguage, isLanguageRequest, isTicketConfirmation, type HiroLanguage } from '@/app/lib/hiroLanguage'
import { selectFairSupportAgent } from '@/app/lib/supportRouting'
import { getHiroRetentionCutoffs } from '@/app/lib/hiroRetention'
import { buildHiroBusinessBrief, type HiroCoachInsight } from '@/app/lib/hiroBusinessCoach'

const WELCOME_MESSAGE = 'Hello! I am Hiro. You can chat with me or ask about your Hiroma account and the Hiroma ecosystem.'

type SafeLink = { label: string; href: string }
type HiroCoachKind = HiroCoachInsight['kind'] | 'today'

function isHiroCoachKind(value: unknown): value is HiroCoachKind {
  return value === 'network' || value === 'pair' || value === 'payout' || value === 'sales' || value === 'today'
}

function getManilaBusinessTime(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || 0)
  const year = value('year')
  const month = value('month')
  const previousYear = month === 1 ? year - 1 : year
  const previousMonth = month === 1 ? 12 : month - 1
  const monthStart = (targetYear: number, targetMonth: number) => new Date(
    `${targetYear}-${String(targetMonth).padStart(2, '0')}-01T00:00:00+08:00`,
  )
  return {
    hour: value('hour'),
    currentMonthStart: monthStart(year, month),
    previousMonthStart: monthStart(previousYear, previousMonth),
  }
}

async function loadBusinessBrief(userId: string) {
  const { hour, currentMonthStart, previousMonthStart } = getManilaBusinessTime()
  const [account, wallet, tree, pendingPayouts, currentSales, previousSales] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        full_name: true,
        reseller_profile: { select: { total_points: true, left_points: true, right_points: true, package: { select: { pairing_bonus_value: true } } } },
      },
    }),
    prisma.wallet.findUnique({ where: { user_id: userId }, select: { balance: true } }),
    prisma.binaryTreeNode.findUnique({ where: { user_id: userId }, select: { left_count: true, right_count: true } }),
    prisma.payout.count({ where: { user_id: userId, status: 'pending' } }),
    prisma.order.aggregate({
      where: { seller_id: userId, status: 'delivered', created_at: { gte: currentMonthStart } },
      _sum: { total_amount: true },
    }),
    prisma.order.aggregate({
      where: { seller_id: userId, status: 'delivered', created_at: { gte: previousMonthStart, lt: currentMonthStart } },
      _sum: { total_amount: true },
    }),
  ])
  if (!account) return null
  return buildHiroBusinessBrief({
    fullName: account.full_name,
    points: account.reseller_profile?.total_points || 0,
    leftMembers: tree?.left_count || 0,
    rightMembers: tree?.right_count || 0,
    leftPoints: Number(account.reseller_profile?.left_points || 0),
    rightPoints: Number(account.reseller_profile?.right_points || 0),
    pointsPerPair: Number(account.reseller_profile?.package.pairing_bonus_value || 0),
    walletBalance: Number(wallet?.balance || 0),
    pendingPayouts,
    currentMonthSales: Number(currentSales._sum.total_amount || 0),
    previousMonthSales: Number(previousSales._sum.total_amount || 0),
  }, hour)
}

function safeLinks(value: unknown): SafeLink[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is SafeLink => Boolean(
    item && typeof item === 'object' &&
    typeof (item as SafeLink).label === 'string' &&
    typeof (item as SafeLink).href === 'string',
  ))
}

async function closeConversation(conversationId: string, userId: string, reason: string) {
  const closedAt = new Date()
  await prisma.$transaction(async (tx) => {
    const closed = await tx.hiroConversation.updateMany({
      where: { id: conversationId, user_id: userId, status: 'active' },
      data: { status: 'closed', closed_at: closedAt, close_reason: reason },
    })
    if (closed.count === 1) {
      await tx.hiroMessage.create({
        data: { conversation_id: conversationId, role: 'system', text: reason === 'inactivity' ? HIRO_INACTIVITY_MESSAGE : 'This conversation has ended. Start a new chat whenever you need Hiro.' },
      })
    }
  })
}

async function createConversation(userId: string) {
  const now = new Date()
  return prisma.hiroConversation.create({
    data: {
      user_id: userId,
      started_at: now,
      last_activity: now,
      messages: { create: { role: 'hiro', text: WELCOME_MESSAGE, intent: 'greeting' } },
    },
  })
}

async function getConversation(userId: string, createWhenMissing: boolean) {
  let conversation = await prisma.hiroConversation.findFirst({
    where: { user_id: userId },
    orderBy: { last_activity: 'desc' },
  })
  if (!conversation && createWhenMissing) conversation = await createConversation(userId)
  if (conversation?.status === 'active' && isHiroConversationInactive(conversation.last_activity)) {
    await closeConversation(conversation.id, userId, 'inactivity')
    conversation = await prisma.hiroConversation.findUnique({ where: { id: conversation.id } })
  }
  return conversation
}

async function conversationResponse(userId: string, createWhenMissing = true) {
  const conversation = await getConversation(userId, createWhenMissing)
  if (!conversation) return { conversation: null, messages: [] }
  const messages = await prisma.hiroMessage.findMany({
    where: { conversation_id: conversation.id },
    orderBy: { created_at: 'asc' },
    take: 200,
  })
  return {
    conversation: {
      id: conversation.id,
      status: conversation.status,
      lastActivity: conversation.last_activity.toISOString(),
      closedAt: conversation.closed_at?.toISOString() || null,
      closeReason: conversation.close_reason,
      inactivityMs: HIRO_INACTIVITY_MS,
    },
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      text: message.text,
      intent: message.intent,
      links: safeLinks(message.links),
      createdAt: message.created_at.toISOString(),
    })),
  }
}

async function loadSafeContext(userId: string): Promise<HiroAccountContext | null> {
  const [account, wallet, treeNode, orders, pendingPayouts, openTickets, products] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        full_name: true,
        username: true,
        member_id: true,
        reseller_profile: {
          select: { total_points: true, rank: true, package: { select: { name: true } } },
        },
      },
    }),
    prisma.wallet.findUnique({ where: { user_id: userId }, select: { balance: true, total_earned: true, total_withdrawn: true } }),
    prisma.binaryTreeNode.findUnique({ where: { user_id: userId }, select: { left_count: true, right_count: true } }),
    prisma.order.groupBy({ by: ['status'], where: { buyer_id: userId }, _count: { status: true } }),
    prisma.payout.count({ where: { user_id: userId, status: 'pending' } }),
    prisma.supportRequest.count({ where: { user_id: userId, status: { not: 'resolved' } } }),
    prisma.product.findMany({
      where: { is_active: true },
      select: { name: true, description: true, type: true, price: true, reseller_price: true },
      orderBy: { name: 'asc' },
      take: 100,
    }),
  ])
  if (!account) return null
  const orderCounts: Record<string, number> = { total: 0 }
  for (const row of orders) {
    orderCounts[row.status] = row._count.status
    orderCounts.total += row._count.status
  }
  return {
    fullName: account.full_name,
    username: account.username,
    memberId: account.member_id,
    packageName: account.reseller_profile?.package.name || 'Not assigned',
    rank: account.reseller_profile?.rank || 'Default',
    points: account.reseller_profile?.total_points || 0,
    walletBalance: Number(wallet?.balance || 0),
    totalEarned: Number(wallet?.total_earned || 0),
    totalWithdrawn: Number(wallet?.total_withdrawn || 0),
    orderCounts,
    pendingPayouts,
    openTickets,
    leftNetworkCount: treeNode?.left_count || 0,
    rightNetworkCount: treeNode?.right_count || 0,
    products: products.map((product) => ({
      name: product.name,
      description: product.description,
      type: product.type,
      srp: Number(product.price),
      resellerPrice: Number(product.reseller_price),
    })),
  }
}

async function requireReseller() {
  const user = await getCurrentUser()
  return user?.role === 'reseller' ? user : null
}

async function deleteExpiredHiroChats(userId: string) {
  const { closedBefore, abandonedBefore } = getHiroRetentionCutoffs()
  await prisma.hiroConversation.deleteMany({
    where: {
      user_id: userId,
      OR: [
        { status: 'closed', last_activity: { lte: closedBefore } },
        { status: 'active', last_activity: { lte: abandonedBefore } },
      ],
    },
  })
}

function languageMessage(language: HiroLanguage, key: 'changed' | 'ticket_created' | 'ticket_declined') {
  const messages = {
    en: { changed: 'Sure. I will reply in English.', ticket_created: 'Your support ticket has been created. The Hiroma support team can continue helping you there.', ticket_declined: 'Okay, I will not create a ticket. You can ask me another question anytime.' },
    tl: { changed: 'Sige. Sasagot ako sa Tagalog.', ticket_created: 'Nagawa na ang support ticket mo. Maaari kang tulungan ng Hiroma support team doon.', ticket_declined: 'Sige, hindi ako gagawa ng ticket. Maaari kang magtanong ulit anumang oras.' },
    ceb: { changed: 'Sige. Motubag ko sa Bisaya.', ticket_created: 'Nahimo na ang imong support ticket. Ang Hiroma support team makapadayon sa pagtabang nimo didto.', ticket_declined: 'Sige, dili ko maghimo og ticket. Pwede ka mangutana pag-usab bisan kanus-a.' },
  }
  return messages[language][key]
}

async function createHiroSupportTicket(user: { id: string; full_name: string }, question: string) {
  const sequence = await prisma.$queryRawUnsafe<{ value: bigint }[]>(`SELECT nextval('"support_ticket_number_seq"') AS value`)
  const ticketNumber = `HSP${String(sequence[0].value).padStart(6, '0')}`
  const assignee = await selectFairSupportAgent()
  return prisma.supportRequest.create({
    data: {
      ticket_number: ticketNumber,
      user_id: user.id,
      source: 'member',
      category: 'other',
      category_detail: 'Question escalated by Hiro Smart Assistant',
      name: user.full_name,
      subject: `Hiro assistance: ${question.slice(0, 100)}`,
      message: question,
      assigned_to: assignee?.id || null,
      messages: assignee ? { create: { author_name: 'Hiroma Support', author_role: 'system', message: `Your ticket ${ticketNumber} has been assigned to ${assignee.full_name}. This support specialist will review your concern and reply here shortly.` } } : undefined,
    },
  })
}

export async function GET() {
  try {
    const user = await requireReseller()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    await deleteExpiredHiroChats(user.id)
    const [conversation, coach] = await Promise.all([conversationResponse(user.id), loadBusinessBrief(user.id)])
    return NextResponse.json({ ...conversation, coach })
  } catch (error) {
    console.error('[HIRO GET ERROR]', error)
    return NextResponse.json({ error: 'Hiro is temporarily unavailable.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireReseller()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    await deleteExpiredHiroChats(user.id)
    const body = await req.json()

    if (body.action === 'start') {
      const active = await prisma.hiroConversation.findMany({ where: { user_id: user.id, status: 'active' }, select: { id: true } })
      for (const conversation of active) await closeConversation(conversation.id, user.id, 'new_chat')
      await createConversation(user.id)
      return NextResponse.json(await conversationResponse(user.id))
    }

    const conversation = await getConversation(user.id, true)
    if (!conversation) return NextResponse.json({ error: 'Unable to start Hiro.' }, { status: 500 })

    if (body.action === 'close') {
      await closeConversation(conversation.id, user.id, body.reason === 'inactivity' ? 'inactivity' : 'member_ended')
      return NextResponse.json(await conversationResponse(user.id, false))
    }

    if (conversation.status !== 'active') {
      return NextResponse.json({ error: 'This conversation has ended.', ...(await conversationResponse(user.id, false)) }, { status: 409 })
    }
    const question = typeof body.question === 'string' ? body.question.trim() : ''
    if (!question || question.length > 500) {
      return NextResponse.json({ error: 'Enter a question with no more than 500 characters.' }, { status: 400 })
    }

    if (isHiroCloseRequest(question)) {
      await prisma.hiroMessage.create({
        data: { conversation_id: conversation.id, role: 'user', text: question, intent: 'close_conversation' },
      })
      await closeConversation(conversation.id, user.id, 'member_ended')
      return NextResponse.json(await conversationResponse(user.id, false))
    }

    const context = await loadSafeContext(user.id)
    if (!context) return NextResponse.json({ error: 'Account not found.' }, { status: 404 })
    const history = await prisma.hiroMessage.findMany({
      where: { conversation_id: conversation.id },
      orderBy: { created_at: 'desc' },
      take: 8,
    })
    const previousHiro = history.find((message) => message.role === 'hiro' && message.intent)
    const previousUser = history.find((message) => message.role === 'user')
    let language: HiroLanguage = 'en'
    for (const message of [...history].reverse()) {
      if (message.role === 'user') language = detectHiroLanguage(message.text, language)
    }
    language = detectHiroLanguage(question, language)

    if (isHiroCoachKind(body.coachKind)) {
      const brief = await loadBusinessBrief(user.id)
      if (body.coachKind === 'today' && brief?.dailyPlan) {
        const links = Array.from(new Map(brief.dailyPlan.actions.map((action) => [action.href, { label: action.actionLabel, href: action.href }])).values())
        const now = new Date()
        await prisma.$transaction([
          prisma.hiroMessage.create({ data: { conversation_id: conversation.id, role: 'user', text: question, intent: 'coach_today_question' } }),
          prisma.hiroMessage.create({ data: { conversation_id: conversation.id, role: 'hiro', text: brief.dailyPlan.explanation, intent: 'coach_today', links } }),
          prisma.hiroConversation.update({ where: { id: conversation.id }, data: { last_activity: now } }),
        ])
        return NextResponse.json(await conversationResponse(user.id, false))
      }
      const insight = brief?.insights.find((item) => item.kind === body.coachKind)
      if (insight) {
        const now = new Date()
        await prisma.$transaction([
          prisma.hiroMessage.create({ data: { conversation_id: conversation.id, role: 'user', text: question, intent: `coach_${insight.kind}_question` } }),
          prisma.hiroMessage.create({ data: { conversation_id: conversation.id, role: 'hiro', text: insight.explanation, intent: `coach_${insight.kind}`, links: [{ label: insight.actionLabel, href: insight.href }] } }),
          prisma.hiroConversation.update({ where: { id: conversation.id }, data: { last_activity: now } }),
        ])
        return NextResponse.json(await conversationResponse(user.id, false))
      }
    }

    if (isLanguageRequest(question)) {
      const now = new Date()
      await prisma.$transaction([
        prisma.hiroMessage.create({ data: { conversation_id: conversation.id, role: 'user', text: question, intent: 'language_request' } }),
        prisma.hiroMessage.create({ data: { conversation_id: conversation.id, role: 'hiro', text: languageMessage(language, 'changed'), intent: 'language_changed' } }),
        prisma.hiroConversation.update({ where: { id: conversation.id }, data: { last_activity: now } }),
      ])
      return NextResponse.json(await conversationResponse(user.id, false))
    }

    if (previousHiro?.intent === 'support_ticket_offer') {
      const confirmation = isTicketConfirmation(question)
      if (confirmation !== null) {
        let ticketId: string | null = null
        let links: SafeLink[] = []
        let answer = languageMessage(language, 'ticket_declined')
        let intent = 'support_ticket_declined'
        if (confirmation) {
          const concern = previousUser?.text || 'Question submitted through Hiro Smart Assistant'
          const ticket = await createHiroSupportTicket(user, concern)
          ticketId = ticket.id
          links = [{ label: language === 'tl' ? 'Buksan ang Ticket' : language === 'ceb' ? 'Ablihi ang Ticket' : 'Open Ticket', href: `/dashboard/reseller/support-center/${ticket.id}` }]
          answer = `${languageMessage(language, 'ticket_created')} Ticket number: ${ticket.ticket_number}.`
          intent = 'support_ticket_created'
        }
        const now = new Date()
        await prisma.$transaction([
          prisma.hiroMessage.create({ data: { conversation_id: conversation.id, role: 'user', text: question, intent: 'support_ticket_confirmation' } }),
          prisma.hiroMessage.create({ data: { conversation_id: conversation.id, role: 'hiro', text: answer, intent, links } }),
          prisma.hiroConversation.update({ where: { id: conversation.id }, data: { last_activity: now } }),
        ])
        return NextResponse.json({ ...(await conversationResponse(user.id, false)), ticketId })
      }
    }
    const reply = answerHiroQuestion(question, context, {
      previousIntent: previousHiro?.intent || undefined,
      previousQuestion: previousUser?.text,
      language,
    })
    if (reply.matchedIntent === 'fallback') reply.matchedIntent = 'support_ticket_offer'
    const now = new Date()
    await prisma.$transaction([
      prisma.hiroMessage.create({ data: { conversation_id: conversation.id, role: 'user', text: question } }),
      prisma.hiroMessage.create({ data: { conversation_id: conversation.id, role: 'hiro', text: reply.answer, intent: reply.matchedIntent, links: reply.links } }),
      prisma.hiroConversation.update({ where: { id: conversation.id }, data: { last_activity: now } }),
    ])
    return NextResponse.json(await conversationResponse(user.id, false))
  } catch (error) {
    console.error('[HIRO ASSISTANT ERROR]', error)
    return NextResponse.json({ error: 'Hiro is temporarily unavailable. Please try again.' }, { status: 500 })
  }
}
