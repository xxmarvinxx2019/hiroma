export {}

type Position = 'left' | 'right'

type Node = {
  parent: number | null
  position: Position | null
  left: number | null
  right: number | null
  leftPoints: number
  rightPoints: number
  pairingDay: number
  dailyPairs: number
}

type Result = {
  pairs: number
  payablePairs: number
  flashoutPairs: number
  unmatchedPoints: number
  maximumDepth: number
  rootLeftMembers: number
  rootRightMembers: number
}

const MEMBERS = Number(process.env.BINARY_SIM_MEMBERS || 10_000)
const DAYS = Number(process.env.BINARY_SIM_DAYS || 730)
const RUNS = Number(process.env.BINARY_SIM_RUNS || 100)
const POINTS_PER_REGISTRATION = 400
const POINTS_PER_PAIR = 400
const DAILY_CAP = 10

if (!Number.isSafeInteger(MEMBERS) || MEMBERS < 2) throw new Error('BINARY_SIM_MEMBERS must be at least 2.')
if (!Number.isSafeInteger(DAYS) || DAYS < 1) throw new Error('BINARY_SIM_DAYS must be positive.')
if (!Number.isSafeInteger(RUNS) || RUNS < 1) throw new Error('BINARY_SIM_RUNS must be positive.')

function random(seed: number) {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function node(parent: number | null, position: Position | null): Node {
  return {
    parent,
    position,
    left: null,
    right: null,
    leftPoints: 0,
    rightPoints: 0,
    pairingDay: -1,
    dailyPairs: 0,
  }
}

function settle(nodes: Node[], parentIndex: number, sourcePosition: Position, day: number, totals: Result) {
  let cursor: number | null = parentIndex
  let leg = sourcePosition
  let depth = 1
  while (cursor != null) {
    const recipient = nodes[cursor]
    if (recipient.pairingDay !== day) {
      recipient.pairingDay = day
      recipient.dailyPairs = 0
    }
    if (leg === 'left') recipient.leftPoints += POINTS_PER_REGISTRATION
    else recipient.rightPoints += POINTS_PER_REGISTRATION

    const completed = Math.floor(Math.min(recipient.leftPoints, recipient.rightPoints) / POINTS_PER_PAIR)
    if (completed > 0) {
      recipient.leftPoints -= completed * POINTS_PER_PAIR
      recipient.rightPoints -= completed * POINTS_PER_PAIR
      totals.pairs += completed
      const payable = Math.min(completed, Math.max(0, DAILY_CAP - recipient.dailyPairs))
      recipient.dailyPairs += payable
      totals.payablePairs += payable
      totals.flashoutPairs += completed - payable
    }
    leg = recipient.position || leg
    cursor = recipient.parent
    depth += 1
  }
  totals.maximumDepth = Math.max(totals.maximumDepth, depth)
}

function descendants(nodes: Node[], start: number | null) {
  if (start == null) return 0
  let count = 0
  const stack = [start]
  while (stack.length > 0) {
    const current = nodes[stack.pop()!]
    count += 1
    if (current.left != null) stack.push(current.left)
    if (current.right != null) stack.push(current.right)
  }
  return count
}

function finish(nodes: Node[], result: Result) {
  result.unmatchedPoints = nodes.reduce((sum, item) => sum + item.leftPoints + item.rightPoints, 0)
  result.rootLeftMembers = descendants(nodes, nodes[0].left)
  result.rootRightMembers = descendants(nodes, nodes[0].right)
  return result
}

function balanced(): Result {
  const nodes = [node(null, null)]
  const result: Result = { pairs: 0, payablePairs: 0, flashoutPairs: 0, unmatchedPoints: 0, maximumDepth: 0, rootLeftMembers: 0, rootRightMembers: 0 }
  for (let index = 1; index < MEMBERS; index += 1) {
    const parentIndex = Math.floor((index - 1) / 2)
    const position: Position = index % 2 === 1 ? 'left' : 'right'
    nodes.push(node(parentIndex, position))
    nodes[parentIndex][position] = index
    settle(nodes, parentIndex, position, Math.floor(index * DAYS / MEMBERS), result)
  }
  return finish(nodes, result)
}

// Each registration descends from the root until it reaches an open slot.
// `leftProbability` represents a persistent market preference for one leg;
// different sponsors and spillover still create both legs throughout the tree.
function unbalanced(seed: number, leftProbability: number): Result {
  const rng = random(seed)
  const nodes = [node(null, null)]
  const result: Result = { pairs: 0, payablePairs: 0, flashoutPairs: 0, unmatchedPoints: 0, maximumDepth: 0, rootLeftMembers: 0, rootRightMembers: 0 }
  for (let index = 1; index < MEMBERS; index += 1) {
    let parentIndex = 0
    let position: Position
    while (true) {
      position = rng() < leftProbability ? 'left' : 'right'
      const child = nodes[parentIndex][position]
      if (child == null) break
      parentIndex = child
    }
    nodes.push(node(parentIndex, position))
    nodes[parentIndex][position] = index
    settle(nodes, parentIndex, position, Math.floor(index * DAYS / MEMBERS), result)
  }
  return finish(nodes, result)
}

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) * p)]
}

function summarize(label: string, results: Result[]) {
  const fields: Array<keyof Result> = ['pairs', 'payablePairs', 'flashoutPairs', 'unmatchedPoints', 'maximumDepth', 'rootLeftMembers', 'rootRightMembers']
  return {
    scenario: label,
    runs: results.length,
    ...Object.fromEntries(fields.map((field) => [field, {
      p10: percentile(results.map((result) => result[field]), 0.10),
      median: percentile(results.map((result) => result[field]), 0.50),
      p90: percentile(results.map((result) => result[field]), 0.90),
    }])),
  }
}

const balancedResult = balanced()
const moderate = Array.from({ length: RUNS }, (_, index) => unbalanced(10_000 + index, 0.70))
const severe = Array.from({ length: RUNS }, (_, index) => unbalanced(20_000 + index, 0.85))

console.log(JSON.stringify({
  assumptions: {
    members: MEMBERS,
    growthDays: DAYS,
    registrationsPerDay: MEMBERS / DAYS,
    pointsPerRegistration: POINTS_PER_REGISTRATION,
    pointsPerPair: POINTS_PER_PAIR,
    binaryPairValue: 200,
    dailyPairCap: DAILY_CAP,
    pointExpiryDays: 1_095,
    note: 'The unbalanced cases are seeded scenario ranges, not forecasts from HIROMA production history. Three-year expiry does not affect points during a two-year growth window.',
  },
  balanced: balancedResult,
  scenarios: [
    summarize('moderate unbalance: 70% left-path preference', moderate),
    summarize('severe unbalance: 85% left-path preference', severe),
  ],
}, null, 2))
