import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { CURATED_QUOTES, getDailyInspiration, getRecentInspirations } from '../src/app/lib/dailyInspiration'

test('curated library provides a complete non-repeating 365-day cycle', () => {
  assert.equal(CURATED_QUOTES.length, 365)
  assert.equal(new Set(CURATED_QUOTES.map((quote) => quote.text)).size, 365)
  assert.ok(CURATED_QUOTES.filter((quote) => quote.category === 'Business & Entrepreneurship').length >= 50)
  assert.doesNotMatch(CURATED_QUOTES.map((quote) => quote.text).join(' '), /take the next step with confidence/i)
  const attributedQuotes = CURATED_QUOTES.filter((quote) => quote.author !== 'Hiroma Daily Reflection')
  assert.ok(attributedQuotes.length >= 10)
  assert.ok(attributedQuotes.every((quote) => quote.source))
  const finalSixWords = CURATED_QUOTES.map((quote) => quote.text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).slice(-6).join(' '))
  const endingFrequency = new Map<string, number>()
  finalSixWords.forEach((ending) => endingFrequency.set(ending, (endingFrequency.get(ending) || 0) + 1))
  assert.ok(Math.max(...endingFrequency.values()) <= 1)
  const cycle = Array.from({ length: 365 }, (_, day) =>
    getDailyInspiration(new Date(Date.parse('2026-01-01T04:00:00Z') + day * 86_400_000)),
  )
  assert.equal(new Set(cycle.map((quote) => quote.text)).size, 365)
  assert.ok(new Set(cycle.slice(0, 14).map((quote) => quote.category)).size >= 4)
})

test('Daily Inspiration is deterministic for the same Philippine day', () => {
  const morning = getDailyInspiration(new Date('2026-08-24T01:00:00Z'))
  const evening = getDailyInspiration(new Date('2026-08-24T14:00:00Z'))
  assert.deepEqual(morning, evening)
  assert.equal(morning.date, '2026-08-24')
  assert.equal(morning.author, 'Hiroma Daily Reflection')
})

test('recent reflections return one approved reflection per day', () => {
  const recent = getRecentInspirations(7, new Date('2026-08-24T04:00:00Z'))
  assert.equal(recent.length, 7)
  assert.equal(new Set(recent.map((item) => item.date)).size, 7)
})

test('reseller UI exposes optional Daily Inspiration without external content dependency', () => {
  const dashboard = readFileSync('src/app/dashboard/reseller/page.tsx', 'utf8')
  const layout = readFileSync('src/app/dashboard/reseller/layout.tsx', 'utf8')
  const page = readFileSync('src/app/dashboard/reseller/daily-inspiration/page.tsx', 'utf8')
  const route = readFileSync('src/app/api/reseller/daily-inspiration/route.ts', 'utf8')
  assert.match(layout, /Daily Inspiration/)
  assert.match(dashboard, /stats\.daily_inspiration\?\.enabled/)
  assert.match(page, /Show on my dashboard/)
  assert.match(page, /Hide from dashboard today/)
  assert.match(page, /Faith & Bible reflections/)
  assert.match(route, /daily_inspiration:/)
  assert.match(route, /systemSetting\.upsert/)
  assert.doesNotMatch(route, /fetch\(/)
})
