import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { boundedPage, boundedPageSize } from '../src/app/lib/pagination'
import {
  assertPosRegistrationNetworkBinding,
  PosRegistrationNetworkBindingError,
  readPosRegistrationNetworkSnapshot,
} from '../src/app/lib/posRegistrationNetwork'
import { hashIdentityDocument } from '../src/app/lib/identityDocument'
import {
  assertPosRegistrationApplicantBinding,
  isLikelyOutstandingPosApplicant,
  PosRegistrationApplicantBindingError,
} from '../src/app/lib/posRegistrationApplicant'

const read = (path: string) => readFileSync(path, 'utf8')

test('pagination rejects malformed and unsafe values and caps result work', () => {
  assert.equal(boundedPage(null), 1)
  assert.equal(boundedPage('2'), 2)
  assert.equal(boundedPage('2x'), 1)
  assert.equal(boundedPage(String(Number.MAX_SAFE_INTEGER + 1)), 1)
  assert.equal(boundedPage('999999'), 10_000)
  assert.equal(boundedPageSize('-1'), 15)
  assert.equal(boundedPageSize('500000'), 50)
  assert.equal(boundedPageSize('20', 15, 100), 20)
})

test('every inventory and order list uses the shared bounded parser', () => {
  for (const path of [
    'src/app/api/admin/inventory/route.ts',
    'src/app/api/city/inventory/route.ts',
    'src/app/api/regional/inventory/route.ts',
    'src/app/api/provincial/inventory/route.ts',
    'src/app/api/admin/orders/route.ts',
    'src/app/api/city/orders/route.ts',
    'src/app/api/regional/orders/route.ts',
    'src/app/api/provincial/orders/route.ts',
    'src/app/api/reseller/orders/route.ts',
  ]) {
    const route = read(path)
    assert.match(route, /boundedPage\(searchParams\.get\('page'\)\)/)
    assert.match(route, /boundedPageSize\(searchParams\.get\('pageSize'\)/)
    assert.doesNotMatch(route, /pageSize\s*=\s*Math\.max\(/)
  }
})

test('paid POS network snapshot binds stable sponsor, parent, and leg', () => {
  const snapshot = readPosRegistrationNetworkSnapshot({
    referrer_username: 'sponsor',
    preferred_position: 'left',
    applicant_snapshot: {
      referrer_username: 'Sponsor',
      referrer_user_id: 'referrer-1',
      upline_username: 'Upline',
      parent_node_id: 'node-1',
      preferred_position: 'left',
    },
  })
  const valid = {
    referrerUserId: 'referrer-1',
    referrerUsername: 'sponsor',
    parentNodeId: 'node-1',
    parentUsername: 'upline',
    position: 'left' as const,
  }
  assert.doesNotThrow(() => assertPosRegistrationNetworkBinding(snapshot, valid))
  for (const replacement of [
    { ...valid, referrerUserId: 'attacker' },
    { ...valid, parentNodeId: 'other-node' },
    { ...valid, position: 'right' as const },
  ]) {
    assert.throws(
      () => assertPosRegistrationNetworkBinding(snapshot, replacement),
      PosRegistrationNetworkBindingError,
    )
  }
})

test('legacy paid POS snapshots remain usable only with their exact captured names', () => {
  const snapshot = readPosRegistrationNetworkSnapshot({
    referrer_username: 'Sponsor',
    preferred_position: 'right',
    applicant_snapshot: { upline_username: 'Upline', preferred_position: 'right' },
  })
  const valid = {
    referrerUserId: 'current-id',
    referrerUsername: 'SPONSOR',
    parentNodeId: 'current-node',
    parentUsername: 'UPLINE',
    position: 'right' as const,
  }
  assert.doesNotThrow(() => assertPosRegistrationNetworkBinding(snapshot, valid))
  assert.throws(
    () => assertPosRegistrationNetworkBinding(snapshot, { ...valid, parentUsername: 'replacement' }),
    PosRegistrationNetworkBindingError,
  )
})

test('paid POS applicant binding uses canonical identity plus exact captured name and mobile', () => {
  const previousSecret = process.env.IDENTITY_HASH_SECRET
  process.env.IDENTITY_HASH_SECRET = 'city-security-remediation-test-secret'
  try {
    const expected = {
      fullName: 'Juan Dela Cruz',
      mobile: '09171234567',
      identityDocumentHash: hashIdentityDocument('National ID', '12-34 5678'),
    }
    const legacy = {
      applicant_full_name: 'JUAN DELA CRUZ',
      applicant_mobile: '09171234567',
      identity_document_type: 'National ID',
      identity_document_reference: '1234-5678',
    }
    assert.ok(isLikelyOutstandingPosApplicant(legacy, expected))
    assert.doesNotThrow(() =>
      assertPosRegistrationApplicantBinding(legacy, expected),
    )
    assert.throws(
      () =>
        assertPosRegistrationApplicantBinding(
          { ...legacy, applicant_mobile: '09999999999' },
          expected,
        ),
      PosRegistrationApplicantBindingError,
    )
  } finally {
    if (previousSecret === undefined) delete process.env.IDENTITY_HASH_SECRET
    else process.env.IDENTITY_HASH_SECRET = previousSecret
  }
})

test('POS intake and locked encoding enforce the immutable network boundary', () => {
  const intake = read('src/app/api/city/pos/registrations/route.ts')
  const encoding = read('src/app/api/city/resellers/route.ts')
  assert.match(intake, /referrer_user_id: referrer\.id/)
  assert.match(intake, /parent_node_id: upline\.binary_tree_node\.id/)
  assert.match(intake, /user\.is_staff \? \{ cashier_id: actorId \} : \{\}/)
  assert.match(encoding, /FOR UPDATE`/)
  assert.match(encoding, /referrer_username, preferred_position, applicant_snapshot/)
  assert.match(encoding, /assertPosRegistrationNetworkBinding\([\s\S]*locked\[0\]/)
})

test('cash registration sales are included in both shift close and live drawer summary', () => {
  const helper = read('src/app/lib/posCashSales.ts')
  const shifts = read('src/app/api/city/pos/shifts/route.ts')
  const movements = read('src/app/api/city/pos/cash-movements/route.ts')
  assert.match(helper, /payment_method_id: null/)
  assert.match(helper, /released_pending_encoding[\s\S]*encoding_in_progress[\s\S]*registration_completed/)
  assert.match(shifts, /calculateShiftCashSales\(tx, shift\.id\)/)
  assert.match(shifts, /cashSales\.total/)
  assert.match(movements, /calculateShiftCashSales\(prisma, shift\.id\)/)
  assert.match(movements, /registration_cash_sales: cashSales\.registrationCash/)
})

test('staff upgrade mutation requires registration permission at both gates', () => {
  const proxy = read('src/proxy.ts')
  const route = read('src/app/api/city/resellers/upgrade/route.ts')
  assert.ok(
    proxy.indexOf("pathname === '/api/city/resellers/upgrade'") <
      proxy.indexOf("pathname.startsWith('/dashboard/city/resellers')"),
  )
  assert.match(proxy, /resellers\/upgrade'[\s\S]*method === 'PATCH'[\s\S]*return 'register_reseller'/)
  assert.match(route, /user\.is_staff && !user\.permissions\?\.includes\("register_reseller"\)/)
})

test('identity precheck uses no-store JSON POST rather than a PII URL', () => {
  const route = read('src/app/api/city/resellers/check-name/route.ts')
  assert.match(route, /export async function POST/)
  assert.match(route, /Cache-Control': 'no-store'/)
  assert.match(route, /await req\.json\(\)/)
  assert.doesNotMatch(route, /searchParams/)
  for (const path of [
    'src/app/dashboard/city/resellers/register/page.tsx',
    'src/app/dashboard/admin/resellers/register/page.tsx',
    'src/app/dashboard/city/resellers/page.tsx',
  ]) {
    const page = read(path)
    assert.doesNotMatch(page, /resellers\/check-name\?/) 
    assert.match(page, /fetch\(["']\/api\/city\/resellers\/check-name["'], \{[\s\S]*method: ["']POST["']/)
  }
})

test('welcome SMS issues one locked token and never accepts or embeds a password', () => {
  const route = read('src/app/api/city/resellers/send-welcome-sms/route.ts')
  const template = read('src/app/lib/sms.ts')
  assert.match(route, /FOR UPDATE/)
  assert.match(route, /expires_at: \{ gt: new Date\(\) \}/)
  assert.match(route, /WelcomeLinkAlreadyIssuedError/)
  assert.match(route, /createPasswordResetToken\(\)/)
  assert.doesNotMatch(route, /\{ reseller_id, password \}/)
  const callStart = route.indexOf('smsWelcomeReseller({')
  const callEnd = route.indexOf('}),', callStart)
  assert.ok(callStart >= 0 && callEnd > callStart)
  assert.doesNotMatch(route.slice(callStart, callEnd), /password/)
  assert.doesNotMatch(template, /Temporary Password:/)
  assert.match(template, /setup_url/)
  assert.match(template, /expires in 30 minutes/)
})

test('POS receipt replay is cashier-scoped for staff but remains owner-visible', () => {
  const registrations = read('src/app/api/city/pos/registrations/route.ts')
  const transactions = read('src/app/api/city/pos/transactions/route.ts')
  assert.match(registrations, /client_intake_id: clientIntakeId[\s\S]*user\.is_staff \? \{ cashier_id: actorId \} : \{\}/)
  assert.match(registrations, /error instanceof Prisma\.PrismaClientKnownRequestError[\s\S]*error\.code === "P2002"[\s\S]*client_intake_id: replayClientIntakeId[\s\S]*replayed: true/)
  assert.match(transactions, /cashierId \? \{ cashier_id: cashierId \} : \{\}/)
  assert.match(transactions, /!user\.is_staff \|\| existing\.cashier_id === actorId/)
})

test('released POS registration cannot bypass applicant or network binding by omitting its handoff id', () => {
  const route = read('src/app/api/city/resellers/route.ts')
  const intake = read('src/app/api/city/pos/registrations/route.ts')
  const schema = read('prisma/schema.prisma')
  assert.match(schema, /model PosRegistrationIntake[\s\S]*identity_document_hash\s+String\?/)
  assert.match(intake, /identity_document_hash: identityDocumentHash/)
  const release = read('src/app/lib/posRegistration.ts')
  const migration = read('prisma/migrations/20260903100000_bind_pos_registration_identity/migration.sql')
  assert.match(route, /prisma\.\$transaction\(async \(tx\) => \{[\s\S]*lockPosRegistrationApplicant\(tx, identityDocumentHash\)[\s\S]*if \(!posIntake\)[\s\S]*released_at: \{ not: null \}[\s\S]*PosRegistrationHandoffRequiredError/)
  assert.match(route, /assertPosRegistrationApplicantBinding\(posIntake, expectedPosApplicant\)/)
  assert.match(route, /FOR UPDATE[\s\S]*assertPosRegistrationApplicantBinding\([\s\S]*locked\[0\]/)
  assert.match(intake, /lockPosRegistrationApplicant\(tx, identityDocumentHash\)[\s\S]*posRegistrationIntake\.create/)
  assert.match(release, /lockPosRegistrationApplicant\(tx, identityDocumentHash\)[\s\S]*FOR UPDATE/)
  assert.match(migration, /pg_advisory_xact_lock/)
  assert.match(migration, /BEFORE INSERT OR UPDATE OF identity_document_hash, released_at/)
})
