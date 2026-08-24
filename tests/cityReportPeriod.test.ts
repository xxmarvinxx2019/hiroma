import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveCityReportPeriod } from '../src/app/lib/city-report-period'

const mondayInManila = new Date('2026-08-23T16:30:00.000Z') // Monday, Aug 24 at 12:30 AM PHT

test('last week is the complete previous Monday through Sunday in Manila', () => {
  const result = resolveCityReportPeriod(new URLSearchParams({ period: 'last_week' }), 'today', mondayInManila)
  assert.equal(result.period, 'last_week')
  assert.equal(result.label, 'Last Week (Monday–Sunday)')
  assert.equal(result.start?.toISOString(), '2026-08-16T16:00:00.000Z')
  assert.equal(result.end?.toISOString(), '2026-08-23T16:00:00.000Z')
})

test('this week starts Monday and ends at the following Monday', () => {
  const result = resolveCityReportPeriod(new URLSearchParams({ period: 'this_week' }), 'today', mondayInManila)
  assert.equal(result.start?.toISOString(), '2026-08-23T16:00:00.000Z')
  assert.equal(result.end?.toISOString(), '2026-08-30T16:00:00.000Z')
})

test('last week remains stable when selected midweek', () => {
  const wednesdayInManila = new Date('2026-08-26T04:00:00.000Z')
  const result = resolveCityReportPeriod(new URLSearchParams({ period: 'last_week' }), 'today', wednesdayInManila)
  assert.equal(result.start?.toISOString(), '2026-08-16T16:00:00.000Z')
  assert.equal(result.end?.toISOString(), '2026-08-23T16:00:00.000Z')
})
