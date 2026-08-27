import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const manifest = fs.readFileSync('src/app/manifest.ts', 'utf8')
const worker = fs.readFileSync('public/sw-pos.js', 'utf8')
const config = fs.readFileSync('next.config.ts', 'utf8')
const offlineQueue = fs.readFileSync('src/app/lib/posOfflineQueue.ts', 'utf8')
const posPage = fs.readFileSync('src/app/dashboard/city/pos/page.tsx', 'utf8')

test('Hiroma POS manifest keeps authentication inside the standalone application', () => {
  assert.match(manifest, /name: 'Hiroma Point of Sale'/)
  assert.match(manifest, /start_url: '\/dashboard\/city\/pos\?source=pwa'/)
  assert.match(manifest, /scope: '\/'/)
  assert.match(manifest, /display: 'standalone'/)
  assert.match(manifest, /purpose: 'maskable'/)
})

test('POS service worker never caches authenticated API or RSC responses', () => {
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)/)
  assert.match(worker, /request\.headers\.get\('rsc'\) === '1'/)
  assert.doesNotMatch(worker, /cache\.put\(request/)
})

test('POS service worker does not cache login redirects as the cashier shell', () => {
  assert.match(worker, /response\.redirected/)
  assert.match(worker, /responseUrl\.pathname\.startsWith\('\/dashboard\/city\/pos'\)/)
})

test('service worker is served with safe update and scope headers', () => {
  assert.match(config, /no-cache, no-store, must-revalidate/)
  assert.match(config, /Service-Worker-Allowed/)
  assert.match(config, /Service-Worker-Allowed', value: '\/'/)
})


test('a blocked IndexedDB upgrade cannot leave the POS bootstrap loading forever', () => {
  assert.match(offlineQueue, /request\.onblocked/)
  assert.match(offlineQueue, /setTimeout\([\s\S]*3000\)/)
  assert.match(offlineQueue, /db\.onversionchange = \(\) => db\.close\(\)/)
  assert.match(posPage, /if \(!navigator\.onLine\) \{[\s\S]*await loadPosBootstrap/)
  assert.match(posPage, /void loadPosBootstrap<Bootstrap>\(\)/)
})
