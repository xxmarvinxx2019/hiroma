import test from 'node:test'
import assert from 'node:assert/strict'
import { resolvePasskeyConfig } from '../src/app/lib/passkeyConfig'

test('production falls back to the exact HTTPS request origin', () => {
  assert.deepEqual(resolvePasskeyConfig({
    requestOrigin: 'https://hiroma.vercel.app',
    production: true,
  }), {
    origin: 'https://hiroma.vercel.app',
    rpID: 'hiroma.vercel.app',
    rpName: 'Hiroma',
  })
})

test('explicit configuration remains authoritative and supports a parent RP ID', () => {
  assert.deepEqual(resolvePasskeyConfig({
    requestOrigin: 'https://preview-host.vercel.app',
    configuredOrigin: 'https://app.hiromadigital.com',
    configuredRPID: 'hiromadigital.com',
    configuredRPName: ' Hiroma Secure ',
    production: true,
  }), {
    origin: 'https://app.hiromadigital.com',
    rpID: 'hiromadigital.com',
    rpName: 'Hiroma Secure',
  })
})

test('partial or cross-site explicit configuration is rejected', () => {
  assert.throws(() => resolvePasskeyConfig({
    requestOrigin: 'https://hiroma.vercel.app',
    configuredOrigin: 'https://hiroma.vercel.app',
    production: true,
  }), /configured together/)

  assert.throws(() => resolvePasskeyConfig({
    requestOrigin: 'https://hiroma.vercel.app',
    configuredOrigin: 'https://hiroma.vercel.app',
    configuredRPID: 'attacker.example',
    production: true,
  }), /must match/)
})

test('unsafe or malformed production origins are rejected', () => {
  for (const requestOrigin of [
    'http://hiroma.vercel.app',
    'https://user:password@hiroma.vercel.app',
    'https://hiroma.vercel.app/path',
    'https://hiroma.vercel.app.evil.example:443/path',
  ]) {
    assert.throws(() => resolvePasskeyConfig({ requestOrigin, production: true }))
  }
})

test('localhost HTTP remains available only for local development', () => {
  assert.equal(resolvePasskeyConfig({
    requestOrigin: 'http://localhost:3003',
    production: false,
  }).rpID, 'localhost')
  assert.throws(() => resolvePasskeyConfig({
    requestOrigin: 'http://localhost:3003',
    production: true,
  }), /HTTPS/)
})