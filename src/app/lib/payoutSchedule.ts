export const PAYOUT_TIME_ZONE = 'Asia/Manila'
export const DEFAULT_PAYOUT_CUTOFF_DAYS = [15, 31]
export const DEFAULT_PAYOUT_DATE_MAP: Record<string, string> = { '15': '18', '31': '3' }
export const DEFAULT_MINIMUM_PAYOUT = 500

type ManilaDate = { year: number; month: number; day: number }

function manilaDate(now: Date): ManilaDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PAYOUT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value)
  return { year: value('year'), month: value('month'), day: value('day') }
}

function lastDay(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function calendarDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day))
}

export function validatePayoutSchedule(cutoffDays: number[], payoutDateMap: Record<string, string>) {
  const uniqueDays = [...new Set(cutoffDays)].sort((a, b) => a - b)
  if (!uniqueDays.length || uniqueDays.length !== cutoffDays.length || uniqueDays.some((day) => !Number.isInteger(day) || day < 1 || day > 31)) {
    throw new Error('Cutoff days must be unique whole numbers from 1 to 31.')
  }
  const expectedKeys = uniqueDays.map(String)
  const actualKeys = Object.keys(payoutDateMap).sort((a, b) => Number(a) - Number(b))
  if (expectedKeys.join(',') !== actualKeys.join(',')) throw new Error('Every cutoff must have exactly one payout-day mapping.')
  for (const key of expectedKeys) {
    const value = Number(payoutDateMap[key])
    if (!Number.isInteger(value) || value < 1 || value > 31) throw new Error(`Payout day for cutoff ${key} must be from 1 to 31.`)
  }
  return { cutoffDays: uniqueDays, payoutDateMap: Object.fromEntries(expectedKeys.map((key) => [key, String(Number(payoutDateMap[key]))])) }
}

export function getNextPayoutSchedule(cutoffDays: number[], payoutDateMap: Record<string, string>, now = new Date()) {
  const valid = validatePayoutSchedule(cutoffDays, payoutDateMap)
  const today = manilaDate(now)
  let cutoffYear = today.year
  let cutoffMonth = today.month
  let cutoffKey = valid.cutoffDays.find((configuredDay) => {
    const actual = configuredDay === 31 ? lastDay(today.year, today.month) : configuredDay
    return today.day < actual // The cutoff date itself is closed and belongs to the next batch.
  })

  if (cutoffKey === undefined) {
    cutoffKey = valid.cutoffDays[0]
    cutoffMonth += 1
    if (cutoffMonth === 13) { cutoffMonth = 1; cutoffYear += 1 }
  }

  const cutoffDay = cutoffKey === 31 ? lastDay(cutoffYear, cutoffMonth) : cutoffKey
  const payoutDay = Number(valid.payoutDateMap[String(cutoffKey)])
  let payoutYear = cutoffYear
  let payoutMonth = cutoffMonth
  if (payoutDay <= cutoffDay) {
    payoutMonth += 1
    if (payoutMonth === 13) { payoutMonth = 1; payoutYear += 1 }
  }
  const actualPayoutDay = Math.min(payoutDay, lastDay(payoutYear, payoutMonth))
  const cutoffDate = calendarDate(cutoffYear, cutoffMonth, cutoffDay)
  const payoutDate = calendarDate(payoutYear, payoutMonth, actualPayoutDay)
  const batchId = `PAYOUT-${cutoffYear}${String(cutoffMonth).padStart(2, '0')}${String(cutoffDay).padStart(2, '0')}`
  return { cutoffDate, payoutDate, batchId }
}
