export type HiroBusinessCoachInput = {
  fullName: string
  points: number
  leftMembers: number
  rightMembers: number
  leftPoints: number
  rightPoints: number
  pointsPerPair: number
  walletBalance: number
  pendingPayouts: number
  currentMonthSales: number
  previousMonthSales: number
}

export type HiroCoachInsight = {
  kind: 'network' | 'pair' | 'payout' | 'sales'
  text: string
  question: string
  explanation: string
  actionLabel: string
  href: string
}

export type HiroDailyAction = {
  kind: 'network' | 'pair' | 'payout' | 'sales' | 'learning'
  text: string
  reason: string
  actionLabel: string
  href: string
  question: string
}

export type HiroDailyPlan = {
  title: string
  summary: string
  question: string
  explanation: string
  actions: HiroDailyAction[]
}

export type HiroNetworkOpportunity = {
  left: { members: number; points: number; status: 'Strong branch' | 'Needs attention' | 'Growth opportunity'; question: string }
  right: { members: number; points: number; status: 'Strong branch' | 'Needs attention' | 'Growth opportunity'; question: string }
  gap: number
  insight: string
  question: string
}

export type HiroBusinessBrief = {
  greeting: string
  summary: string
  insights: HiroCoachInsight[]
  dailyPlan: HiroDailyPlan
  networkOpportunity: HiroNetworkOpportunity
}

function firstName(fullName: string) {
  return fullName.trim().split(/\s+/)[0] || 'Reseller'
}

export function getHiroGreeting(hour: number) {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function peso(value: number) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value)
}

export function buildHiroBusinessBrief(input: HiroBusinessCoachInput, hour = new Date().getHours()): HiroBusinessBrief {
  const insights: HiroCoachInsight[] = []
  const dailyActions: HiroDailyAction[] = []
  const weakerSide = input.leftMembers === input.rightMembers ? null : input.leftMembers < input.rightMembers ? 'Left' : 'Right'
  const memberGap = Math.abs(input.leftMembers - input.rightMembers)
  const leftStatus: HiroNetworkOpportunity['left']['status'] = input.leftMembers === input.rightMembers ? 'Growth opportunity' : input.leftMembers > input.rightMembers ? 'Strong branch' : 'Needs attention'
  const rightStatus: HiroNetworkOpportunity['right']['status'] = input.leftMembers === input.rightMembers ? 'Growth opportunity' : input.rightMembers > input.leftMembers ? 'Strong branch' : 'Needs attention'
  const networkOpportunity: HiroNetworkOpportunity = {
    left: { members: input.leftMembers, points: input.leftPoints, status: leftStatus, question: `Explain my Left Team opportunity using my ${input.leftMembers} members and ${input.leftPoints.toLocaleString()} carryover points.` },
    right: { members: input.rightMembers, points: input.rightPoints, status: rightStatus, question: `Explain my Right Team opportunity using my ${input.rightMembers} members and ${input.rightPoints.toLocaleString()} carryover points.` },
    gap: memberGap,
    insight: weakerSide
      ? `Your ${weakerSide} Team currently has ${memberGap} fewer member${memberGap === 1 ? '' : 's'} than your other team. Support genuine activity and qualified growth on that side; this is guidance, not a promise of income.`
      : 'Your team counts are balanced. Compare eligible activity and carryover points before deciding which side needs attention; balanced counts do not guarantee commissions.',
    question: 'Analyze my Network Opportunity Map and recommend responsible actions for both teams.',
  }

  if (weakerSide) {
    const gap = Math.abs(input.leftMembers - input.rightMembers)
    dailyActions.push({ kind: 'network', text: `Support your ${weakerSide} Team today.`, reason: `It currently has ${gap} fewer member${gap === 1 ? '' : 's'} than your other team.`, actionLabel: 'Open Binary Tree', href: '/dashboard/reseller/tree', question: `Why should I focus on my ${weakerSide} Team today, and what practical steps should I take?` })
  } else {
    dailyActions.push({ kind: 'network', text: 'Review activity on both network teams.', reason: 'Your member counts are balanced, so actual eligible activity and points should guide your next action.', actionLabel: 'Open Binary Tree', href: '/dashboard/reseller/tree', question: 'My network member counts are balanced. What activity should I review on both teams today?' })
  }

  insights.push({
    kind: 'network',
    text: weakerSide
      ? `Your Left Team has ${input.leftMembers} member${input.leftMembers === 1 ? '' : 's'} and your Right Team has ${input.rightMembers}. Focus on your ${weakerSide} Team to improve your network balance.`
      : `Your network is balanced at ${input.leftMembers} member${input.leftMembers === 1 ? '' : 's'} on both the Left and Right Teams.`,
    question: 'Explain my current network balance and recommend what I should do next.',
    explanation: weakerSide
      ? `Your ${weakerSide} Team currently has fewer members, so it is the side that needs more attention. A healthier balance can create more opportunities for matching activity, but results still depend on qualified members and actual volume. Focus on helping your existing ${weakerSide} Team become active, follow up with interested prospects, and place future qualified members carefully instead of recruiting only to create a pair.`
      : 'Your Left and Right Teams currently have the same number of members. Keep supporting activity on both sides and monitor actual points or volume, because equal member counts do not always mean equal binary volume.',
    actionLabel: 'Open Binary Tree',
    href: '/dashboard/reseller/tree',
  })

  if (input.pointsPerPair > 0) {
    const matchedCarryover = Math.min(input.leftPoints, input.rightPoints)
    const progress = matchedCarryover % input.pointsPerPair
    const needed = progress === 0 ? input.pointsPerPair : input.pointsPerPair - progress
    dailyActions.push({ kind: 'pair', text: `Work toward ${needed.toLocaleString()} more matched point${needed === 1 ? '' : 's'}.`, reason: `Your verified carryover is ${input.leftPoints.toLocaleString()} Left / ${input.rightPoints.toLocaleString()} Right.`, actionLabel: 'View Pairing Details', href: '/dashboard/reseller/tree', question: `Explain why I need ${needed.toLocaleString()} more matched points and recommend a responsible next step.` })
    insights.push({
      kind: 'pair',
      text: `You need ${needed.toLocaleString()} more matched point${needed === 1 ? '' : 's'} for your next binary pair. Current carryover: ${input.leftPoints.toLocaleString()} Left / ${input.rightPoints.toLocaleString()} Right.`,
      question: 'Explain my progress toward my next binary pair and recommend my next action.',
      explanation: `Your current carryover is ${input.leftPoints.toLocaleString()} points on the Left and ${input.rightPoints.toLocaleString()} on the Right. Binary matching is limited by the side with fewer eligible points. Based on your current package requirement of ${input.pointsPerPair.toLocaleString()} matched points per pair, you need ${needed.toLocaleString()} more matched point${needed === 1 ? '' : 's'} toward the next pair. Review which side needs qualified volume and support genuine activity there; do not create purchases or placements only to force a commission.`,
      actionLabel: 'View Pairing Details',
      href: '/dashboard/reseller/tree',
    })
  }

  insights.push({
    kind: 'payout',
    text: input.pendingPayouts > 0
      ? `You have ${peso(input.walletBalance)} in your wallet and ${input.pendingPayouts} pending payout request${input.pendingPayouts === 1 ? '' : 's'}.`
      : `You have ${peso(input.walletBalance)} in your wallet available for a payout request, subject to payout requirements.`,
    question: 'Explain my payout readiness and what I should check before requesting a payout.',
    explanation: input.pendingPayouts > 0
      ? `Your wallet balance is ${peso(input.walletBalance)}, and you already have ${input.pendingPayouts} pending payout request${input.pendingPayouts === 1 ? '' : 's'}. Check the pending request before submitting another one. Approval and release still depend on the payout schedule, an approved payment method, available balance, and Security PIN confirmation.`
      : `Your wallet balance is ${peso(input.walletBalance)}. Before requesting a payout, confirm that your payment method is approved, your available balance meets the current payout rules, and your Security PIN is ready. The displayed balance does not by itself guarantee immediate approval or release.`,
    actionLabel: 'Review Payouts',
    href: '/dashboard/reseller/payouts',
  })

  dailyActions.push({
    kind: 'payout',
    text: input.pendingPayouts > 0 ? 'Review your pending payout request.' : 'Check whether your wallet is payout-ready.',
    reason: input.pendingPayouts > 0 ? `You currently have ${input.pendingPayouts} pending request${input.pendingPayouts === 1 ? '' : 's'}.` : `Your current wallet balance is ${peso(input.walletBalance)}; approval still depends on payout requirements.`,
    actionLabel: 'Open Payouts', href: '/dashboard/reseller/payouts', question: input.pendingPayouts > 0 ? 'Explain the status of my pending payout and what I should check next.' : 'Is my wallet payout-ready, and what requirements should I check first?',
  })

  if (input.previousMonthSales > 0) {
    const change = ((input.currentMonthSales - input.previousMonthSales) / input.previousMonthSales) * 100
    insights.push({
      kind: 'sales',
      text: `Your reseller sales are ${Math.abs(change).toFixed(1)}% ${change >= 0 ? 'up' : 'down'} this month (${peso(input.currentMonthSales)} so far).`,
      question: 'Explain my reseller sales performance this month and recommend my next action.',
      explanation: `You have ${peso(input.currentMonthSales)} in delivered reseller sales this month compared with ${peso(input.previousMonthSales)} last month, a ${Math.abs(change).toFixed(1)}% ${change >= 0 ? 'increase' : 'decrease'}. ${change >= 0 ? 'Keep following up with repeat customers and continue the activities producing verified sales.' : 'Review recent customers, product availability, and follow-ups to identify where sales slowed down.'} Use the order history for the exact transactions behind this summary.`,
      actionLabel: 'View Orders',
      href: '/dashboard/reseller/orders',
    })
  } else if (input.currentMonthSales > 0) {
    insights.push({ kind: 'sales', text: `You have recorded ${peso(input.currentMonthSales)} in reseller sales this month.`, question: 'Explain my reseller sales performance this month and recommend my next action.', explanation: `You have ${peso(input.currentMonthSales)} in delivered reseller sales this month. There is no prior-month sales value available for a reliable percentage comparison. Continue following up with customers and use your order history to review which products and activities produced these sales.`, actionLabel: 'View Orders', href: '/dashboard/reseller/orders' })
  } else {
    insights.push({ kind: 'sales', text: 'No reseller sales have been recorded this month yet.', question: 'Explain my reseller sales status this month and recommend my next action.', explanation: 'No delivered reseller sales have been recorded for your account this month. Start by checking available products, reconnecting with previous customers, and following responsible selling guidance in the Learning Center. Orders only appear in this sales summary after they reach the qualifying delivered status.', actionLabel: 'View Products and Orders', href: '/dashboard/reseller/orders' })
  }

  dailyActions.push({ kind: 'sales', text: input.currentMonthSales > 0 ? 'Follow up with recent customers.' : 'Review products and reconnect with customers.', reason: input.currentMonthSales > 0 ? `Your verified delivered reseller sales this month total ${peso(input.currentMonthSales)}.` : 'No delivered reseller sales have been recorded for your account this month.', actionLabel: 'View Orders', href: '/dashboard/reseller/orders', question: input.currentMonthSales > 0 ? 'Based on my current sales this month, which customer follow-up should I prioritize today?' : 'I have no delivered reseller sales this month. What responsible sales action should I start with today?' })
  dailyActions.push({ kind: 'learning', text: 'Complete one relevant Learning Center lesson.', reason: weakerSide ? 'Choose a network-building or binary lesson that supports your weaker team.' : input.currentMonthSales <= 0 ? 'Choose product education or responsible-selling training.' : 'Choose a lesson related to your next business goal.', actionLabel: 'Open Learning Center', href: '/dashboard/reseller/learning-center', question: weakerSide ? `Which Learning Center topic can help me support my ${weakerSide} Team?` : input.currentMonthSales <= 0 ? 'Which product education or responsible-selling lesson should I take today?' : 'Which Learning Center lesson best matches my next business goal?' })

  const selectedActions = dailyActions.slice(0, 5)
  const explanation = `I built today's plan from your current verified account data. ${selectedActions.map((action, index) => `${index + 1}. ${action.text} ${action.reason}`).join(' ')} Start with the first item, then ask me about any item if you want a more detailed guide.`

  return {
    greeting: `${getHiroGreeting(hour)}, ${firstName(input.fullName)}!`,
    summary: `You currently have ${input.points.toLocaleString()} point${input.points === 1 ? '' : 's'}. Here is your verified business brief.`,
    insights,
    dailyPlan: { title: 'What should I do today?', summary: `${selectedActions.length} recommended actions based on your current account activity.`, question: "Explain why you recommended today's action plan and guide me through it.", explanation, actions: selectedActions },
    networkOpportunity,
  }
}
