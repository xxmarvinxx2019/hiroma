import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = process.cwd()
const migration = fs.readFileSync(path.join(root, 'prisma/migrations/20260812130000_add_audit_logs/migration.sql'), 'utf8')
const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8')

test('audit log migration creates the expected durable evidence table', () => {
  assert.match(migration, /CREATE TABLE "audit_logs"/)
  assert.match(migration, /"metadata" JSONB NOT NULL DEFAULT '\{\}'::jsonb/)
  assert.match(migration, /CONSTRAINT "audit_logs_pkey" PRIMARY KEY/)
  assert.equal((migration.match(/CREATE INDEX "audit_logs_/g) || []).length, 7)
  assert.doesNotMatch(migration, /FOREIGN KEY/)
})

test('Prisma audit model matches the table and preserves nullable actor fields', () => {
  const model = schema.match(/model AuditLog \{[\s\S]*?@@map\("audit_logs"\)\r?\n\}/)?.[0] || ''
  assert.ok(model)
  for (const field of ['user_id', 'user_name', 'user_role', 'member_id', 'ip_address', 'device']) {
    assert.match(model, new RegExp(`\\b${field}\\s+String\\?`))
  }
  assert.match(model, /metadata\s+Json\s+@default\("\{\}"\)/)
  assert.equal((model.match(/@@index/g) || []).length, 7)
})
