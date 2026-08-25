export const PERFORMANCE_PERIODS = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'this_quarter',
  'this_year',
  'all_time',
  'custom',
] as const

export type PerformancePeriod = (typeof PERFORMANCE_PERIODS)[number]

export const PERFORMANCE_PERIOD_LABELS: Record<PerformancePeriod, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  this_week: 'This Week',
  last_week: 'Last Week',
  this_month: 'This Month',
  last_month: 'Last Month',
  this_quarter: 'This Quarter',
  this_year: 'This Year',
  all_time: 'All Time',
  custom: 'Custom Range',
}

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000

function manilaBoundary(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month, day) - MANILA_OFFSET_MS)
}

export function resolvePerformancePeriod(
  requestedPeriod: string | null,
  now = new Date(),
  customFrom?: string | null,
  customTo?: string | null,
) {
  const period: PerformancePeriod = PERFORMANCE_PERIODS.includes(requestedPeriod as PerformancePeriod)
    ? requestedPeriod as PerformancePeriod
    : 'this_week'

  if (period === 'all_time') {
    return { period, label: PERFORMANCE_PERIOD_LABELS[period], start: null, end: null }
  }

  const manilaNow = new Date(now.getTime() + MANILA_OFFSET_MS)
  const year = manilaNow.getUTCFullYear()
  const month = manilaNow.getUTCMonth()
  const day = manilaNow.getUTCDate()
  let start: Date
  let end: Date

  if (period === 'custom') {
    const validDate = /^\d{4}-\d{2}-\d{2}$/
    if (!customFrom || !customTo || !validDate.test(customFrom) || !validDate.test(customTo) || customFrom > customTo) {
      const todayStart = manilaBoundary(year, month, day)
      return { period: 'today' as const, label: 'Today', start: todayStart, end: new Date(todayStart.getTime() + 86_400_000) }
    }
    const [fromYear, fromMonth, fromDay] = customFrom.split('-').map(Number)
    const [toYear, toMonth, toDay] = customTo.split('-').map(Number)
    start = manilaBoundary(fromYear, fromMonth - 1, fromDay)
    end = manilaBoundary(toYear, toMonth - 1, toDay + 1)
    return { period, label: `${customFrom} to ${customTo}`, start, end }
  } else if (period === 'today' || period === 'yesterday') {
    const todayStart = manilaBoundary(year, month, day)
    start = period === 'today' ? todayStart : new Date(todayStart.getTime() - 86_400_000)
    end = new Date(start.getTime() + 86_400_000)
  } else if (period === 'this_week' || period === 'last_week') {
    const mondayOffset = (manilaNow.getUTCDay() + 6) % 7
    const thisMonday = manilaBoundary(year, month, day - mondayOffset)
    if (period === 'this_week') {
      start = thisMonday
      end = new Date(thisMonday.getTime() + 7 * 24 * 60 * 60 * 1000)
    } else {
      end = thisMonday
      start = new Date(thisMonday.getTime() - 7 * 24 * 60 * 60 * 1000)
    }
  } else if (period === 'this_month') {
    start = manilaBoundary(year, month, 1)
    end = manilaBoundary(year, month + 1, 1)
  } else if (period === 'last_month') {
    start = manilaBoundary(year, month - 1, 1)
    end = manilaBoundary(year, month, 1)
  } else if (period === 'this_quarter') {
    const quarterStartMonth = Math.floor(month / 3) * 3
    start = manilaBoundary(year, quarterStartMonth, 1)
    end = manilaBoundary(year, quarterStartMonth + 3, 1)
  } else {
    start = manilaBoundary(year, 0, 1)
    end = manilaBoundary(year + 1, 0, 1)
  }

  return { period, label: PERFORMANCE_PERIOD_LABELS[period], start, end }
}
