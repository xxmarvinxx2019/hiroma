import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflow = readFileSync(
  '.github/workflows/production-financial-attestation.yml',
  'utf8',
)
const targetVerifier = readFileSync(
  'scripts/verify-production-database-target.ts',
  'utf8',
)

test('production attestation is manual, protected, serialized, and main-only', () => {
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /pull_request:/)
  assert.match(workflow, /environment:\s*production/)
  assert.match(workflow, /cancel-in-progress:\s*false/)
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/)
})

test('third-party workflow actions are pinned to immutable commit hashes', () => {
  for (const match of workflow.matchAll(/uses:\s*[^\s]+@([^\s#]+)/g)) {
    assert.match(match[1], /^[0-9a-f]{40}$/i)
  }
})

test('owner credentials are limited to migration and target-attestation steps', () => {
  const uses = workflow.match(/secrets\.PRODUCTION_DATABASE_URL/g) || []
  assert.equal(uses.length, 3)
  assert.match(workflow, /DATABASE_URL:\s*\$\{\{ secrets\.PRODUCTION_DATABASE_URL \}\}/)
  assert.doesNotMatch(workflow, /env:\s*\n\s*PRODUCTION_DATABASE_URL:[\s\S]*name:\s*Run full tests/)
})

test('production attestation generates Prisma before importing application tests', () => {
  const generateIndex = workflow.indexOf('run: npx prisma generate')
  const testIndex = workflow.indexOf('run: npm run test:all')
  assert.ok(generateIndex >= 0)
  assert.ok(testIndex > generateIndex)
  assert.match(workflow, /Generate Prisma client without production credentials[\s\S]*DATABASE_URL: postgresql:\/\/invalid:invalid@127\.0\.0\.1:9\/invalid/)
})

test('database verifier requires separate owner/runtime roles and approved target name', () => {
  assert.match(targetVerifier, /PRODUCTION_DATABASE_EXPECTED_NAME/)
  assert.match(targetVerifier, /owner\.role_name === runtime\.role_name/)
  assert.match(targetVerifier, /ownerUrl === runtimeUrl/)
  assert.match(targetVerifier, /targetFingerprint/)
  assert.doesNotMatch(targetVerifier, /console\.log\([^)]*role_name/)
})
