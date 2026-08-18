import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { resolveApplicationUrl } from '../src/app/lib/applicationUrl'

test('production requires an explicitly configured exact HTTPS application origin', () => {
  assert.equal(resolveApplicationUrl({
    configuredUrl: 'https://hiroma.vercel.app',
    requestOrigin: 'https://attacker.example',
    production: true,
  }), 'https://hiroma.vercel.app')

  assert.throws(() => resolveApplicationUrl({
    requestOrigin: 'https://attacker.example',
    production: true,
  }), /required in production/)
})

test('unsafe production application URLs are rejected', () => {
  for (const configuredUrl of [
    'http://hiroma.vercel.app',
    'https://user:password@hiroma.vercel.app',
    'https://hiroma.vercel.app/reset-password',
    'https://hiroma.vercel.app?next=evil',
  ]) {
    assert.throws(() => resolveApplicationUrl({
      configuredUrl,
      requestOrigin: 'https://hiroma.vercel.app',
      production: true,
    }))
  }
})

test('local development may use localhost HTTP but not an arbitrary HTTP host', () => {
  assert.equal(resolveApplicationUrl({
    requestOrigin: 'http://localhost:3003',
    production: false,
  }), 'http://localhost:3003')
  assert.throws(() => resolveApplicationUrl({
    requestOrigin: 'http://attacker.example',
    production: false,
  }), /HTTPS/)
})

test('password reset resolves the trusted URL before creating a token', () => {
  const route = readFileSync('src/app/api/admin/resellers/[id]/password-reset/route.ts', 'utf8')
  const resolution = route.indexOf('resolveApplicationUrl({')
  const token = route.indexOf('createPasswordResetToken()')
  assert.ok(resolution >= 0 && resolution < token)
  assert.doesNotMatch(route, /process\.env\.APP_URL \|\| req\.nextUrl\.origin/)
})
