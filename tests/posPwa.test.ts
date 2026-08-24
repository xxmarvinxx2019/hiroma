import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const manifest = fs.readFileSync('src/app/manifest.ts', 'utf8')
const worker = fs.readFileSync('public/sw-pos.js', 'utf8')
const config = fs.readFileSync('next.config.ts', 'utf8')

test('Hiroma POS manifest opens as a scoped standalone application', () => {
  assert.match(manifest, /name: 'Hiroma Point of Sale'/)
  assert.match(manifest, /start_url: '\/dashboard\/city\/pos\?source=pwa'/)
  assert.match(manifest, /scope: '\/dashboard\/city\/pos'/)
  assert.match(manifest, /display: 'standalone'/)
  assert.match(manifest, /purpose: 'maskable'/)
})

test('POS service worker never caches authenticated API or RSC responses', () => {
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)/)
  assert.match(worker, /request\.headers\.get\('rsc'\) === '1'/)
  assert.doesNotMatch(worker, /cache\.put\(request/)
})

test('service worker is served with safe update and scope headers', () => {
  assert.match(config, /no-cache, no-store, must-revalidate/)
  assert.match(config, /Service-Worker-Allowed/)
  assert.match(config, /\/dashboard\/city\/pos/)
})
