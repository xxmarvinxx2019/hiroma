import test from 'node:test'
import assert from 'node:assert/strict'
import { buildHiroBusinessBrief, getHiroGreeting } from '../src/app/lib/hiroBusinessCoach'

test('uses the correct time-based greeting', () => {
  assert.equal(getHiroGreeting(8), 'Good morning')
  assert.equal(getHiroGreeting(14), 'Good afternoon')
  assert.equal(getHiroGreeting(20), 'Good evening')
})

test('builds verified network, pair, payout, and sales coaching', () => {
  const brief = buildHiroBusinessBrief({
    fullName: 'Noel Aring', points: 345, leftMembers: 51, rightMembers: 28,
    leftPoints: 580, rightPoints: 280, pointsPerPair: 300,
    walletBalance: 2300, pendingPayouts: 0, currentMonthSales: 1180, previousMonthSales: 1000,
  }, 8)
  assert.equal(brief.greeting, 'Good morning, Noel!')
  assert.match(brief.insights[0].text, /Right Team/)
  assert.match(brief.insights[0].explanation, /fewer members/)
  assert.match(brief.insights[0].question, /network balance/)
  assert.match(brief.insights[1].text, /20 more matched points/)
  assert.match(brief.insights[1].explanation, /300 matched points per pair/)
  assert.match(brief.insights[2].text, /2,300/)
  assert.equal(brief.insights[2].actionLabel, 'Review Payouts')
  assert.match(brief.insights[3].text, /18.0% up/)
  assert.equal(brief.insights[3].href, '/dashboard/reseller/orders')
  assert.equal(brief.dailyPlan.title, 'What should I do today?')
  assert.match(brief.dailyPlan.actions[0].text, /Right Team/)
  assert.match(brief.dailyPlan.actions[1].text, /20 more matched points/)
  assert.ok(brief.dailyPlan.actions.every((action) => action.question.length > 10))
  assert.match(brief.dailyPlan.explanation, /current verified account data/)
  assert.equal(brief.dailyPlan.actions.some((action) => /3 prospects/.test(action.text)), false)
  assert.equal(brief.networkOpportunity.left.status, 'Strong branch')
  assert.equal(brief.networkOpportunity.right.status, 'Needs attention')
  assert.equal(brief.networkOpportunity.gap, 23)
  assert.match(brief.networkOpportunity.insight, /23 fewer members/)
  assert.match(brief.networkOpportunity.insight, /not a promise of income/)
  assert.match(brief.networkOpportunity.right.question, /Right Team opportunity/)
})

test('daily actions adapt to balanced networks, pending payouts, and no sales', () => {
  const brief = buildHiroBusinessBrief({ fullName: 'Sample Member', points: 0, leftMembers: 3, rightMembers: 3, leftPoints: 0, rightPoints: 0, pointsPerPair: 300, walletBalance: 500, pendingPayouts: 2, currentMonthSales: 0, previousMonthSales: 0 }, 14)
  assert.match(brief.dailyPlan.actions[0].text, /both network teams/)
  assert.match(brief.dailyPlan.actions.find((action) => action.kind === 'payout')?.reason || '', /2 pending requests/)
  assert.match(brief.dailyPlan.actions.find((action) => action.kind === 'sales')?.text || '', /reconnect with customers/)
  assert.equal(brief.networkOpportunity.left.status, 'Growth opportunity')
  assert.equal(brief.networkOpportunity.right.status, 'Growth opportunity')
  assert.match(brief.networkOpportunity.insight, /do not guarantee commissions/)
})
