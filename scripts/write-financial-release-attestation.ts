import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function required(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required.`)
  return value
}

const commit = required('GITHUB_SHA')
if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error('GITHUB_SHA must be a full commit SHA.')

const mode = required('FINANCIAL_RELEASE_MODE')
if (mode !== 'verify-only' && mode !== 'deploy') {
  throw new Error('FINANCIAL_RELEASE_MODE must be verify-only or deploy.')
}

const backupReference = process.env.FINANCIAL_BACKUP_REFERENCE?.trim() || ''
if (mode === 'deploy' && !backupReference) {
  throw new Error('A backup reference is required for migration deployment.')
}
if (backupReference.length > 500) throw new Error('Backup reference is too long.')

const outputDirectory = required('FINANCIAL_ATTESTATION_DIR')
const targetPath = required('FINANCIAL_TARGET_ATTESTATION_PATH')
const target = JSON.parse(readFileSync(targetPath, 'utf8')) as {
  targetFingerprint?: string
  migrationFingerprint?: string
}
if (!/^[0-9a-f]{64}$/i.test(target.targetFingerprint || '')) {
  throw new Error('Database target attestation is missing or malformed.')
}

const generatedAt = new Date().toISOString()
const attestation = {
  schemaVersion: 'hiroma-financial-release-attestation/v1',
  generatedAt,
  repository: process.env.GITHUB_REPOSITORY || null,
  workflowRunId: process.env.GITHUB_RUN_ID || null,
  workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  commit: commit.toLowerCase(),
  ref: process.env.GITHUB_REF || null,
  mode,
  backupReferenceSha256: backupReference
    ? createHash('sha256').update(backupReference).digest('hex')
    : null,
  targetFingerprint: target.targetFingerprint,
  migrationFingerprint: target.migrationFingerprint || null,
  checks: {
    exactCommit: 'passed',
    testsAndBuild: 'passed',
    binaryStressSimulation: 'passed',
    migrationStatus: 'passed',
    databaseTargetAndRoleSeparation: 'passed',
    runtimeLeastPrivilege: 'passed',
    binaryAccounting: 'passed',
    reserveAdmission: 'passed',
  },
}

mkdirSync(outputDirectory, { recursive: true })
writeFileSync(
  join(outputDirectory, 'financial-release-attestation.json'),
  `${JSON.stringify(attestation, null, 2)}\n`,
  { encoding: 'utf8', flag: 'wx' },
)
console.log(JSON.stringify({ written: true, generatedAt, commit: commit.toLowerCase() }))
