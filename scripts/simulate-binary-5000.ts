import assert from 'node:assert/strict'
import type { Prisma } from '@prisma/client'
import {
  DuplicateBinarySettlementError,
  InsufficientBinaryReserveError,
  settleBinaryCommission,
} from '../src/app/lib/binaryCommission'

const requestedMembers = Number(process.env.BINARY_SIM_MEMBERS || 5_000)
if (!Number.isSafeInteger(requestedMembers) || requestedMembers < 2 || requestedMembers > 100_000) {
  throw new Error('BINARY_SIM_MEMBERS must be a whole number from 2 to 100,000.')
}
const MEMBERS = requestedMembers
const STARTER_POINTS = 600
const STARTER_PAIR_VALUE = 600
const STARTER_BINARY_RESERVE = 300

type SimAncestor = {
  id: string
  user_id: string
  parent_id: string | null
  position: 'left' | 'right' | null
  depth: number
}

type SimProfile = {
  user_id: string
  left_points: number
  right_points: number
  daily_pairing_count: number
  package: {
    id: string
    name: string
    pairing_bonus_value: number
  }
  user: { status: 'active' }
}

type CommissionRecord = {
  id: string
  source_event_kind: string
  source_event_id: string
  rule_version: string
  user_id: string
  type: string
  amount: number
  points: number | null
  source_user_id: string | null
  is_pair_overflow: boolean
  overflow_to: string | null
}

type PointLot = { id: string; recipient_user_id: string; leg: string; original_points: number; remaining_points: number; consumed: number }

class SimulatedFinancialDatabase {
  session: 1 | 2 = 1
  flushedPoints = 0
  unfundedCreated = 0
  private lotSequence = 0
  readonly pointLots = new Map<string, PointLot>()
  readonly lotsByUser = new Map<string, PointLot[]>()
  readonly sessionUsage = new Map<string, number>()
  readonly unfunded = new Map<string, number>()
  reserve: number
  paid = 0
  retained = 0
  pairEvents = 0
  pairingLogs = 0
  readonly profiles = new Map<string, SimProfile>()
  readonly settlements = new Set<string>()
  readonly commissions = new Map<string, CommissionRecord>()
  readonly funding = new Map<string, number>()
  readonly walletCredits = new Map<string, number>()
  readonly pairingDateIsToday = new Set<string>()

  constructor(
    readonly ancestors: SimAncestor[],
    profiles: SimProfile[],
    openingReserve: number,
    readonly dailyCap = 10,
  ) {
    this.reserve = openingReserve
    for (const profile of profiles) {
      this.profiles.set(profile.user_id, profile)
      for (const leg of ['left','right'] as const) {
        const points=leg==='left'?profile.left_points:profile.right_points
        if(points>0) this.addPointLot(profile.user_id,leg,points)
      }
    }
  }

  private addPointLot(userId: string, leg: string, points: number) {
    const lot: PointLot={id:`point-lot-${++this.lotSequence}`,recipient_user_id:userId,leg,original_points:points,remaining_points:points,consumed:0}
    this.pointLots.set(lot.id,lot)
    const lots=this.lotsByUser.get(userId) || [];lots.push(lot);this.lotsByUser.set(userId,lots)
    return lot
  }

  verify() {
    for(const [userId,profile] of this.profiles) {
      assert.ok(profile.daily_pairing_count<=this.dailyCap,'Simulated daily allowance exceeded')
      const lots=this.lotsByUser.get(userId) || []
      assert.equal(lots.filter(lot=>lot.leg==='left').reduce((sum,lot)=>sum+lot.remaining_points,0),profile.left_points)
      assert.equal(lots.filter(lot=>lot.leg==='right').reduce((sum,lot)=>sum+lot.remaining_points,0),profile.right_points)
    }
    for(const lot of this.pointLots.values()) assert.equal(lot.original_points-lot.remaining_points,lot.consumed)
    for(const usage of this.sessionUsage.values()) assert.ok(usage<=5,'Simulated session allowance exceeded')
  }

  addReserve(amount: number) {
    this.reserve += amount
  }

  private sqlText(strings: TemplateStringsArray) {
    return Array.from(strings).join(' ')
  }

  readonly tx = {
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = this.sqlText(strings)
      if (sql.includes('UPDATE reseller_profiles') && sql.includes('daily_pairing_count =')) {
        const userId = String(values[1])
        this.pairingDateIsToday.add(userId)
        const profile = this.profiles.get(userId)
        if (profile) profile.daily_pairing_count = Number(values[0])
      }
      return 1
    },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = this.sqlText(strings)

      if (sql.includes('FROM system_settings')) return [] // rewards disabled; default three-year expiry
      if (sql.includes('FROM binary_pair_events WHERE')) return [{count:'0'}]
      if (sql.includes('FROM binary_point_lots')) {
        if(sql.includes('expires_at<=')) return [] // all simulated lots are current
        return (this.lotsByUser.get(String(values[0])) || []).filter(lot=>lot.leg===String(values[1]) && lot.remaining_points>0).map(lot=>({...lot}))
      }
      if (sql.includes('WITH RECURSIVE ancestor_chain')) return this.ancestors

      if (sql.includes('FROM reseller_profiles r') && sql.includes('JOIN packages p')) {
        return this.ancestors.map((ancestor) => ({
          user_id: ancestor.user_id,
          enabled: true,
          session: this.session,
          session_cap: 5,
          used_session: this.pairingDateIsToday.has(ancestor.user_id) ? this.sessionUsage.get(`${this.session}:${ancestor.user_id}`) || 0 : 0,
          cap: this.dailyCap,
          used_today: this.pairingDateIsToday.has(ancestor.user_id) ? this.profiles.get(ancestor.user_id)?.daily_pairing_count || 0 : 0,
        }))
      }

      if (sql.includes('FROM "binary_reserve_lots"')) {
        return [{ available_amount: this.reserve.toFixed(2) }]
      }

      if (sql.includes('INSERT INTO "commissions"')) {
        const id = String(values[0])
        const eventKey = String(values[1])
        if (this.commissions.has(eventKey)) return []

        const record: CommissionRecord = {
          id,
          source_event_kind: String(values[2]),
          source_event_id: String(values[3]),
          rule_version: String(values[4]),
          user_id: String(values[5]),
          type: String(values[6]),
          amount: Number(values[7]),
          points: values[8] == null ? null : Number(values[8]),
          source_user_id: values[9] == null ? null : String(values[9]),
          is_pair_overflow: Boolean(values[10]),
          overflow_to: values[11] == null ? null : String(values[11]),
        }
        this.commissions.set(eventKey, record)

        if (record.is_pair_overflow) {
          this.retained += record.amount
        } else {
          const funded=Math.min(this.reserve,record.amount)
          const gap=record.amount-funded
          this.reserve -= funded
          this.paid += record.amount
          this.funding.set(id, funded)
          this.unfunded.set(id,gap)
          this.unfundedCreated+=gap
          this.walletCredits.set(id, record.amount)
        }
        return [{ id }]
      }

      if (sql.includes('FROM "binary_reserve_consumptions"')) {
        const amount = this.funding.get(String(values[0])) ?? 0
        return [{ funded_amount: amount.toFixed(2), unfunded_amount: (this.unfunded.get(String(values[0])) || 0).toFixed(2) }]
      }

      if (sql.includes('FROM "wallet_ledger_entries"')) {
        const amount = this.walletCredits.get(String(values[0]))
        return amount == null
          ? []
          : [{
              id: `wallet-${String(values[0])}`,
              balance_delta: amount.toFixed(2),
              total_earned_delta: amount.toFixed(2),
            }]
      }

      throw new Error(`Unhandled simulation query: ${sql.replace(/\s+/g, ' ').trim()}`)
    },
    binaryPointLot: {
      create: async ({data}:{data:{recipient_user_id:string;leg:string;original_points:number}}) => this.addPointLot(data.recipient_user_id,data.leg,data.original_points),
      updateMany: async ({where,data}:{where:{id:string;remaining_points:number};data:{remaining_points:{decrement:number}}}) => {
        const lot=this.pointLots.get(where.id)
        if(!lot || lot.remaining_points!==where.remaining_points) return {count:0}
        lot.remaining_points-=data.remaining_points.decrement
        return {count:1}
      },
    },
    binaryPointConsumption: { create: async ({data}:{data:{point_lot_id:string;points:number}}) => {
      const lot=this.pointLots.get(data.point_lot_id)
      assert.ok(lot);lot.consumed+=data.points
      return {id:`consumption-${lot.id}-${lot.consumed}`}
    } },
    binarySettlementEvent: {
      findUnique: async ({ where }: { where: { source_kind_source_event_id: { source_kind: string; source_event_id: string } } }) => {
        const key = `${where.source_kind_source_event_id.source_kind}:${where.source_kind_source_event_id.source_event_id}`
        return this.settlements.has(key) ? { id: key } : null
      },
      create: async ({ data }: { data: { source_kind: string; source_event_id: string } }) => {
        const key = `${data.source_kind}:${data.source_event_id}`
        this.settlements.add(key)
        return { id: key }
      },
    },
    resellerProfile: {
      findMany: async ({ where }: { where: { user_id: { in: string[] } } }) =>
        where.user_id.in.flatMap((id) => {
          const profile = this.profiles.get(id)
          return profile ? [profile] : []
        }),
      update: async ({ where, data }: {
        where: { user_id: string }
        data: {
          left_points: number
          right_points: number
          daily_pairing_count?: number | { increment: number }
        }
      }) => {
        const profile = this.profiles.get(where.user_id)
        if (!profile) throw new Error(`Missing simulated profile ${where.user_id}`)
        profile.left_points = data.left_points
        profile.right_points = data.right_points
        if (data.daily_pairing_count !== undefined) profile.daily_pairing_count = typeof data.daily_pairing_count === 'number'
          ? data.daily_pairing_count
          : profile.daily_pairing_count + data.daily_pairing_count.increment
        return profile
      },
    },
    user: {
      findFirst: async () => ({ id: 'hiroma-admin' }),
    },
    commission: {
      findUnique: async ({ where }: { where: { event_key: string } }) =>
        this.commissions.get(where.event_key) ?? null,
    },
    binaryPairEvent: {
      create: async ({data}:{data:{recipient_user_id:string;payable_pairs:number;inactive_flashout_pairs:number;source_points_flushed:number}}) => {
        this.flushedPoints+=data.source_points_flushed
        const key=`${this.session}:${data.recipient_user_id}`
        this.sessionUsage.set(key,(this.sessionUsage.get(key) || 0)+data.payable_pairs+data.inactive_flashout_pairs)
        this.pairEvents += 1
        return { id: `pair-${this.pairEvents}` }
      },
    },
    pairingLog: {
      create: async () => {
        this.pairingLogs += 1
        return { id: `log-${this.pairingLogs}` }
      },
    },
  } as unknown as Prisma.TransactionClient
}

function packageProfile(
  userId: string,
  packageName: 'Starter' | 'Silver' | 'Gold',
  pointsPerPair: number,
  leftPoints: number,
  rightPoints: number,
): SimProfile {
  return {
    user_id: userId,
    left_points: leftPoints,
    right_points: rightPoints,
    daily_pairing_count: 0,
    package: {
      id: `${packageName.toLowerCase()}-package`,
      name: packageName,
      pairing_bonus_value: pointsPerPair,
    },
    user: { status: 'active' },
  }
}

async function settleStarterRegistration(
  database: SimulatedFinancialDatabase,
  sourceEventId: string,
  parentNodeId: string,
) {
  database.addReserve(STARTER_BINARY_RESERVE)
  return settleBinaryCommission(database.tx, {
    sourceUserId: `member-${sourceEventId}`,
    sourcePoints: STARTER_POINTS,
    parentNodeId,
    position: 'right',
    sourceKind: 'registration',
    sourceEventId,
  })
}

async function runSingleRootScenario() {
  const ancestors: SimAncestor[] = [{
    id: 'root-node',
    user_id: 'root-user',
    parent_id: null,
    position: null,
    depth: 1,
  }]
  const rootVolumeMembers = Math.max(MEMBERS,10)
  const openingReserve = rootVolumeMembers * STARTER_BINARY_RESERVE
  const database = new SimulatedFinancialDatabase(
    ancestors,
    [packageProfile('root-user', 'Starter', STARTER_PAIR_VALUE, rootVolumeMembers * STARTER_POINTS, 0)],
    openingReserve,
  )

  let completedPairs = 0
  for (let event = 1; event <= 5; event += 1) {
    const result = await settleStarterRegistration(database, `root-right-${event}`, 'root-node')
    completedPairs += result.completedPairs
  }

  const morningPairs=completedPairs
  const cappedResult=await settleStarterRegistration(database,'root-morning-capped','root-node')
  assert.equal(cappedResult.completedPairs,0)
  assert.equal(database.flushedPoints,600)
  database.session=2
  for(let event=1;event<=6;event+=1) completedPairs+=(await settleStarterRegistration(database,`root-afternoon-${event}`,'root-node')).completedPairs
  assert.equal(morningPairs,5)
  assert.equal(completedPairs,10)
  assert.equal(database.flushedPoints,1200)
  database.verify()
  let duplicateRejected = false
  try {
    await settleBinaryCommission(database.tx, {
      sourceUserId: 'member-root-right-1',
      sourcePoints: STARTER_POINTS,
      parentNodeId: 'root-node',
      position: 'right',
      sourceKind: 'registration',
      sourceEventId: 'root-right-1',
    })
  } catch (error) {
    duplicateRejected = error instanceof DuplicateBinarySettlementError
  }

  return {
    scenario: `${rootVolumeMembers.toLocaleString()} on one root left; two sessions plus post-cap attempts on root right`,
    openingReserve,
    reserveAdded: 12 * STARTER_BINARY_RESERVE,
    completedPairs,
    flushedIncomingPoints: database.flushedPoints,
    paid: database.paid,
    closingReserve: database.reserve,
    duplicateRejected,
    rootClosingLeftPoints: database.profiles.get('root-user')!.left_points,
    rootClosingRightPoints: database.profiles.get('root-user')!.right_points,
  }
}

function deepAncestors() {
  return Array.from({ length: MEMBERS }, (_, index): SimAncestor => ({
    id: `node-${index + 1}`,
    user_id: `upline-${index + 1}`,
    parent_id: index === MEMBERS - 1 ? null : `node-${index + 2}`,
    position: 'right',
    depth: index + 1,
  }))
}

async function runDeepCascadeScenario(openingReserve: number) {
  const ancestors = deepAncestors()
  const database = new SimulatedFinancialDatabase(
    ancestors,
    ancestors.map((ancestor) =>
      packageProfile(ancestor.user_id, 'Starter', STARTER_PAIR_VALUE, STARTER_POINTS, 0)),
    openingReserve,
  )
  const before = database.reserve
  database.addReserve(STARTER_BINARY_RESERVE)

  try {
    const result = await settleBinaryCommission(database.tx, {
      sourceUserId: 'deep-new-member',
      sourcePoints: STARTER_POINTS,
      parentNodeId: ancestors[0].id,
      position: 'right',
      sourceKind: 'registration',
      sourceEventId: `deep-right-${openingReserve}`,
    })
    database.verify()
    return {
      unfundedCreated: database.unfundedCreated,
      scenario: `one Starter event through ${MEMBERS.toLocaleString()} ready uplines; opening reserve ₱${before.toLocaleString()}`,
      outcome: 'committed',
      completedPairs: result.completedPairs,
      required: result.payableAmount,
      paid: database.paid,
      closingReserve: database.reserve,
      walletCredits: database.walletCredits.size,
    }
  } catch (error) {
    if (!(error instanceof InsufficientBinaryReserveError)) throw error
    return {
      scenario: `one Starter event through ${MEMBERS.toLocaleString()} ready uplines; opening reserve ₱${before.toLocaleString()}`,
      outcome: 'rolled_back',
      completedPairs: 0,
      required: error.requiredAmount,
      availableAfterNewLot: error.availableAmount,
      paid: database.paid,
      closingReserve: before,
      walletCredits: database.walletCredits.size,
    }
  }
}

async function runDeepUpgradeScenario(input: {
  label: string
  sourcePoints: number
  reserveAdded: number
  uplinePackage: 'Silver' | 'Gold'
  pointsPerPair: number
  openingRightPoints: number
  openingReserve: number
}) {
  const ancestors = deepAncestors()
  const database = new SimulatedFinancialDatabase(
    ancestors,
    ancestors.map((ancestor) => packageProfile(
      ancestor.user_id,
      input.uplinePackage,
      input.pointsPerPair,
      input.pointsPerPair,
      input.openingRightPoints,
    )),
    input.openingReserve,
  )
  database.addReserve(input.reserveAdded)

  try {
    const result = await settleBinaryCommission(database.tx, {
      sourceUserId: `upgrade-member-${input.label}`,
      sourcePoints: input.sourcePoints,
      parentNodeId: ancestors[0].id,
      position: 'right',
      sourceKind: 'upgrade',
      sourceEventId: `upgrade-${input.label}`,
    })
    database.verify()
    return {
      unfundedCreated: database.unfundedCreated,
      scenario: `${input.label} through ${MEMBERS.toLocaleString()} ready ${input.uplinePackage} uplines`,
      outcome: 'committed',
      openingReserve: input.openingReserve,
      reserveAdded: input.reserveAdded,
      completedPairs: result.completedPairs,
      required: result.payableAmount,
      paid: database.paid,
      closingReserve: database.reserve,
      walletCredits: database.walletCredits.size,
    }
  } catch (error) {
    if (!(error instanceof InsufficientBinaryReserveError)) throw error
    return {
      scenario: `${input.label} through ${MEMBERS.toLocaleString()} ready ${input.uplinePackage} uplines`,
      outcome: 'rolled_back',
      openingReserve: input.openingReserve,
      reserveAdded: input.reserveAdded,
      completedPairs: 0,
      required: error.requiredAmount,
      availableAfterNewLot: error.availableAmount,
      paid: 0,
      closingReserve: input.openingReserve,
      walletCredits: 0,
    }
  }
}

async function runBalancedGrowthScenario(options: {
  label: string
  companyBuffer: number
  resetDailyCapBeforeEachEvent: boolean
  captureTrace?: boolean
}) {
  const mutableAncestors: SimAncestor[] = []
  const root = {
    id: 'balanced-node-0',
    user_id: 'balanced-user-0',
    parent_id: null,
    position: null as 'left' | 'right' | null,
  }
  const nodes = [root]
  const nodeById = new Map([[root.id, root]])
  const database = new SimulatedFinancialDatabase(
    mutableAncestors,
    [packageProfile(root.user_id, 'Starter', STARTER_PAIR_VALUE, 0, 0)],
    STARTER_BINARY_RESERVE + options.companyBuffer,
  )
  let completedPairs = 0
  let committedMembers = 1
  const trace: Array<Record<string, number | string>> = options.captureTrace
    ? [{
        member: 1,
        pathUplines: 0,
        openingReserve: options.companyBuffer,
        reserveAdded: STARTER_BINARY_RESERVE,
        pairs: 0,
        payable: 0,
        closingReserve: STARTER_BINARY_RESERVE + options.companyBuffer,
        outcome: 'committed',
      }]
    : []
  let blocked: null | {
    attemptedMember: number
    required: number
    availableAfterNewLot: number
  } = null

  for (let index = 1; index < MEMBERS; index += 1) {
    if (options.resetDailyCapBeforeEachEvent) {
      database.pairingDateIsToday.clear()
      database.sessionUsage.clear()
    }
    const parentIndex = Math.floor((index - 1) / 2)
    const parent = nodes[parentIndex]
    const position: 'left' | 'right' = index % 2 === 1 ? 'left' : 'right'
    const node = {
      id: `balanced-node-${index}`,
      user_id: `balanced-user-${index}`,
      parent_id: parent.id,
      position,
    }
    nodes.push(node)
    nodeById.set(node.id, node)
    database.profiles.set(
      node.user_id,
      packageProfile(node.user_id, 'Starter', STARTER_PAIR_VALUE, 0, 0),
    )

    const chain: SimAncestor[] = []
    let cursor: typeof root | undefined = parent
    let depth = 1
    while (cursor) {
      chain.push({ ...cursor, depth })
      cursor = cursor.parent_id
        ? nodeById.get(cursor.parent_id)
        : undefined
      depth += 1
    }
    mutableAncestors.splice(0, mutableAncestors.length, ...chain)

    const reserveBeforeEvent = database.reserve
    database.addReserve(STARTER_BINARY_RESERVE)
    try {
      const result = await settleBinaryCommission(database.tx, {
        sourceUserId: node.user_id,
        sourcePoints: STARTER_POINTS,
        parentNodeId: parent.id,
        position,
        sourceKind: 'registration',
        sourceEventId: `balanced-registration-${index}`,
      })
      completedPairs += result.completedPairs
      committedMembers += 1
      if (options.captureTrace) {
        trace.push({
          member: index + 1,
          pathUplines: chain.length,
          openingReserve: reserveBeforeEvent,
          reserveAdded: STARTER_BINARY_RESERVE,
          pairs: result.completedPairs,
          payable: result.payableAmount,
          closingReserve: database.reserve,
          outcome: 'committed',
        })
      }
    } catch (error) {
      if (!(error instanceof InsufficientBinaryReserveError)) throw error
      database.reserve = reserveBeforeEvent
      database.profiles.delete(node.user_id)
      nodeById.delete(node.id)
      nodes.pop()
      blocked = {
        attemptedMember: index + 1,
        required: error.requiredAmount,
        availableAfterNewLot: error.availableAmount,
      }
      if (options.captureTrace) {
        trace.push({
          member: index + 1,
          pathUplines: chain.length,
          openingReserve: reserveBeforeEvent,
          reserveAdded: STARTER_BINARY_RESERVE,
          pairs: error.requiredAmount / (STARTER_PAIR_VALUE * 0.5),
          payable: error.requiredAmount,
          closingReserve: reserveBeforeEvent,
          outcome: 'rolled_back',
        })
      }
      break
    }
  }

  database.verify()
  return {
    unfundedCreated: database.unfundedCreated,
    flushedIncomingPoints: database.flushedPoints,
    scenario: options.label,
    outcome: blocked ? 'blocked_before_target' : 'reached_target',
    committedMembers,
    attemptedTarget: MEMBERS,
    companyBuffer: options.companyBuffer,
    reserveContributed: committedMembers * STARTER_BINARY_RESERVE,
    completedPairs,
    payablePairs: database.paid / (STARTER_PAIR_VALUE * 0.5),
    capFlashoutPairs: database.retained / (STARTER_PAIR_VALUE * 0.5),
    paid: database.paid,
    retainedByCap: database.retained,
    closingReserve: database.reserve,
    amountBeyondBinaryAllocations: Math.max(
      0,
      database.paid - committedMembers * STARTER_BINARY_RESERVE,
    ),
    blocked,
    ...(options.captureTrace ? { trace } : {}),
  }
}

async function main() {
  const results = [
    await runSingleRootScenario(),
    await runDeepCascadeScenario(MEMBERS * STARTER_BINARY_RESERVE),
    await runDeepCascadeScenario(1_200_000),
    await runDeepUpgradeScenario({
      label: 'Starter-to-Silver upgrade',
      sourcePoints: 400,
      reserveAdded: 200,
      uplinePackage: 'Silver',
      pointsPerPair: 1_000,
      openingRightPoints: 600,
      openingReserve: 2_500_000,
    }),
    await runDeepUpgradeScenario({
      label: 'Starter-to-Gold upgrade',
      sourcePoints: 1_400,
      reserveAdded: 700,
      uplinePackage: 'Gold',
      pointsPerPair: 2_000,
      openingRightPoints: 600,
      openingReserve: 5_000_000,
    }),
    await runDeepUpgradeScenario({
      label: 'Silver-to-Gold upgrade',
      sourcePoints: 1_000,
      reserveAdded: 500,
      uplinePackage: 'Gold',
      pointsPerPair: 2_000,
      openingRightPoints: 1_000,
      openingReserve: 5_000_000,
    }),
    await runBalancedGrowthScenario({
      label: 'balanced Starter growth, same Manila day, binary allocation only',
      companyBuffer: 0,
      resetDailyCapBeforeEachEvent: false,
      captureTrace: true,
    }),
    await runBalancedGrowthScenario({
      label: `balanced Starter growth to ${MEMBERS.toLocaleString()}, same Manila day, measurement buffer`,
      companyBuffer: 20_000_000,
      resetDailyCapBeforeEachEvent: false,
    }),
    await runBalancedGrowthScenario({
      label: `balanced Starter growth to ${MEMBERS.toLocaleString()}, cap reset before every event (slow-growth upper exposure)`,
      companyBuffer: 20_000_000,
      resetDailyCapBeforeEachEvent: true,
    }),
  ]

  console.log(JSON.stringify({
    assumptions: {
      members: MEMBERS,
      package: 'Starter',
      sourcePoints: STARTER_POINTS,
      pointsPerPair: STARTER_PAIR_VALUE,
      pesosPerPoint: 0.5,
      reservePerRegistration: STARTER_BINARY_RESERVE,
      dailyCapPerUpline: 10,
      sessionCaps: [5,5],
      afternoonStart: "13:00 Asia/Manila",
      productRewardsEnabled: false,
      fundingBehavior: "Qualified commissions record funding shortfalls; a shortage does not block settlement.",
      note: 'The simulation executes the production settleBinaryCommission function against an isolated deterministic transaction double; no configured database is used. The legacy paid field means credited commission, not bank payouts. SQL constraints and real bottle credits are verified separately by integration tests.',
    },
    results,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
