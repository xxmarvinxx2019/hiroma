import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflow = readFileSync(
  '.github/workflows/pull-request-quality.yml',
  'utf8',
)

test('pull requests to main run the complete application quality gate', () => {
  assert.match(workflow, /pull_request:\s*\n\s+branches:\s*\n\s+- main/)
  assert.match(workflow, /permissions:\s*\n\s+contents: read/)
  assert.match(workflow, /npm ci/)
  assert.match(workflow, /npx prisma generate/)
  assert.match(workflow, /npm run test:all/)
  assert.match(workflow, /npx tsc --noEmit/)
  assert.match(workflow, /npx prisma validate/)
  assert.match(workflow, /npm run build/)
})

test('quality workflow has no production credentials and pins third-party actions', () => {
  assert.doesNotMatch(workflow, /secrets\./)
  assert.doesNotMatch(workflow, /FINANCIAL_RUNTIME_DATABASE_URL|PRODUCTION_DATABASE_URL/)

  const actions = [...workflow.matchAll(/uses:\s+[^@\s]+@([^\s#]+)/g)]
  assert.ok(actions.length >= 2)
  for (const action of actions) {
    assert.match(action[1], /^[0-9a-f]{40}$/i)
  }
})

test('superseded pull-request quality runs are cancelled without sharing a global lock', () => {
  assert.match(
    workflow,
    /group: application-quality-\$\{\{ github\.event\.pull_request\.number \}\}/,
  )
  assert.match(workflow, /cancel-in-progress: true/)
})
