import assert from 'node:assert/strict'
import test from 'node:test'
import { getDashboardPeriod } from '../src/app/lib/dashboardPeriod'

test('today uses Asia/Manila calendar boundaries', () => {
  const period = getDashboardPeriod(new URLSearchParams('period=today'), new Date('2026-08-19T18:30:00.000Z'))

  assert.equal(period.start.toISOString(), '2026-08-19T16:00:00.000Z')
  assert.equal(period.end.toISOString(), '2026-08-20T16:00:00.000Z')
  assert.equal(period.previousStart.toISOString(), '2026-08-18T16:00:00.000Z')
  assert.equal(period.label, 'Today')
})

test('last seven days includes today and compares an equal seven-day window', () => {
  const period = getDashboardPeriod(new URLSearchParams('period=last7'), new Date('2026-08-19T04:00:00.000Z'))

  assert.equal(period.start.toISOString(), '2026-08-12T16:00:00.000Z')
  assert.equal(period.end.toISOString(), '2026-08-19T16:00:00.000Z')
  assert.equal(period.previousStart.toISOString(), '2026-08-05T16:00:00.000Z')
  assert.equal(period.previousEnd.toISOString(), period.start.toISOString())
})

test('this month compares month-to-date with the same portion of last month', () => {
  const period = getDashboardPeriod(new URLSearchParams('period=thisMonth'), new Date('2026-08-19T04:00:00.000Z'))

  assert.equal(period.start.toISOString(), '2026-07-31T16:00:00.000Z')
  assert.equal(period.end.toISOString(), '2026-08-19T16:00:00.000Z')
  assert.equal(period.previousStart.toISOString(), '2026-06-30T16:00:00.000Z')
  assert.equal(period.previousEnd.toISOString(), '2026-07-19T16:00:00.000Z')
})

test('last month compares complete calendar months', () => {
  const period = getDashboardPeriod(new URLSearchParams('period=lastMonth'), new Date('2026-08-19T04:00:00.000Z'))

  assert.equal(period.start.toISOString(), '2026-06-30T16:00:00.000Z')
  assert.equal(period.end.toISOString(), '2026-07-31T16:00:00.000Z')
  assert.equal(period.previousStart.toISOString(), '2026-05-31T16:00:00.000Z')
  assert.equal(period.previousEnd.toISOString(), period.start.toISOString())
})

test('this year compares year-to-date with the same dates last year', () => {
  const period = getDashboardPeriod(new URLSearchParams('period=thisYear'), new Date('2026-08-19T04:00:00.000Z'))

  assert.equal(period.start.toISOString(), '2025-12-31T16:00:00.000Z')
  assert.equal(period.end.toISOString(), '2026-08-19T16:00:00.000Z')
  assert.equal(period.previousStart.toISOString(), '2024-12-31T16:00:00.000Z')
  assert.equal(period.previousEnd.toISOString(), '2025-08-19T16:00:00.000Z')
})

test('custom range treats the end date as inclusive in Manila', () => {
  const period = getDashboardPeriod(new URLSearchParams('period=custom&from=2026-08-01&to=2026-08-19'))

  assert.equal(period.start.toISOString(), '2026-07-31T16:00:00.000Z')
  assert.equal(period.end.toISOString(), '2026-08-19T16:00:00.000Z')
  assert.match(period.label, /Aug 1, 2026.*Aug 19, 2026/)
})

test('custom range rejects missing or reversed dates', () => {
  assert.throws(() => getDashboardPeriod(new URLSearchParams('period=custom&from=2026-08-19')))
  assert.throws(() => getDashboardPeriod(new URLSearchParams('period=custom&from=2026-08-20&to=2026-08-19')))
})
