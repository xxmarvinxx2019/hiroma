import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const manifest = fs.readFileSync('src/app/manifest.ts', 'utf8')
const worker = fs.readFileSync('public/sw-pos.js', 'utf8')
const config = fs.readFileSync('next.config.ts', 'utf8')
const offlineQueue = fs.readFileSync('src/app/lib/posOfflineQueue.ts', 'utf8')
const posPage = fs.readFileSync('src/app/dashboard/city/pos/page.tsx', 'utf8')
const cityLayout = fs.readFileSync('src/app/dashboard/city/layout.tsx', 'utf8')
const rootLayout = fs.readFileSync('src/app/layout.tsx', 'utf8')

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
  assert.match(config, /Service-Worker-Allowed["'], value: ["']\/["']/)
})

test('all application responses receive baseline browser security headers', () => {
  assert.match(config, /source: "\/:path\*"/)
  assert.match(config, /poweredByHeader: false/)
  assert.match(config, /Content-Security-Policy/)
  assert.match(config, /frame-ancestors 'none'/)
  assert.match(config, /object-src 'none'/)
  assert.match(config, /Referrer-Policy[^\n]+strict-origin-when-cross-origin/)
  assert.match(config, /X-Content-Type-Options[^\n]+nosniff/)
  assert.match(config, /X-Frame-Options[^\n]+DENY/)
})


test('local development removes stale POS service workers and caches', () => {
  assert.match(cityLayout, /process\.env\.NODE_ENV === ["']production["']/)
  assert.match(cityLayout, /navigator\.serviceWorker\s*\?\.getRegistrations\(\)/)
  assert.match(cityLayout, /registration\.unregister\(\)/)
  assert.match(cityLayout, /key\.startsWith\(["']hiroma-pos-["']\)/)
  assert.match(rootLayout, /process\.env\.NODE_ENV !== ["']production["']/)
  assert.match(rootLayout, /strategy="beforeInteractive"/)
  assert.match(rootLayout, /new URL\(worker\.scriptURL\)\.pathname === ['"]\/sw-pos\.js['"]/)
  assert.match(rootLayout, /key\.startsWith\(['"]hiroma-pos-['"]\)/)
  assert.match(rootLayout, /window\.location\.reload\(\)/)
  assert.match(posPage, /process\.env\.NODE_ENV !== ["']production["']\) return;[\s\S]*serviceWorker[\s\S]*\.register\("\/sw-pos\.js\?v=5"/)
})


test('a blocked IndexedDB upgrade cannot leave the POS bootstrap loading forever', () => {
  assert.match(offlineQueue, /request\.onblocked/)
  assert.match(offlineQueue, /setTimeout\([\s\S]*3000\)/)
  assert.match(offlineQueue, /db\.onversionchange = \(\) => db\.close\(\)/)
  assert.match(posPage, /if \(!navigator\.onLine\) \{[\s\S]*await loadPosBootstrap/)
  assert.doesNotMatch(posPage, /void loadPosBootstrap<Bootstrap>\(\)/)
})

test('automatic POS synchronization waits until the protected terminal scope is active', () => {
  assert.match(
    posPage,
    /await savePosBootstrap\(result\);\s*setError\(""\);\s*setData\(result\)/,
  )
  assert.match(posPage, /if \(!online \|\| !data\?\.terminal\.id\) return;/)
  assert.match(
    posPage,
    /if \(!data\?\.terminal\.id\) return;[\s\S]*void refreshQueue\(\)/,
  )
  assert.match(posPage, /\} finally \{\s*active = false;/)
})
