export const CITY_REPORT_PERIODS = [
  'today', 'yesterday', 'this_week', 'last_week',
  'this_month', 'this_year', 'all_time', 'custom',
] as const

export type CityReportPeriod = (typeof CITY_REPORT_PERIODS)[number]

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

function manilaBoundary(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month, day) - MANILA_OFFSET_MS)
}

function parseDate(value: string | null) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? manilaBoundary(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null
}

export function resolveCityReportPeriod(
  searchParams: URLSearchParams,
  fallback: CityReportPeriod,
  clock = new Date(),
) {
  const requested = searchParams.get('period')
  const period: CityReportPeriod = CITY_REPORT_PERIODS.includes(requested as CityReportPeriod)
    ? requested as CityReportPeriod
    : fallback
  const labels: Record<CityReportPeriod, string> = {
    today: 'Today',
    yesterday: 'Yesterday',
    this_week: 'This Week (Monday–Sunday)',
    last_week: 'Last Week (Monday–Sunday)',
    this_month: 'This Month',
    this_year: 'This Year',
    all_time: 'All Time',
    custom: 'Custom Range',
  }

  if (period === 'all_time') return { period, label: labels[period], start: null, end: null }

  const manilaNow = new Date(clock.getTime() + MANILA_OFFSET_MS)
  const year = manilaNow.getUTCFullYear()
  const month = manilaNow.getUTCMonth()
  const day = manilaNow.getUTCDate()

  if (period === 'custom') {
    const start = parseDate(searchParams.get('start'))
    const endDay = parseDate(searchParams.get('end'))
    if (!start || !endDay || endDay < start) {
      return { period: 'all_time' as const, label: labels.all_time, start: null, end: null }
    }
    return { period, label: labels[period], start, end: new Date(endDay.getTime() + DAY_MS) }
  }
  if (period === 'today') {
    return { period, label: labels[period], start: manilaBoundary(year, month, day), end: manilaBoundary(year, month, day + 1) }
  }
  if (period === 'yesterday') {
    return { period, label: labels[period], start: manilaBoundary(year, month, day - 1), end: manilaBoundary(year, month, day) }
  }
  if (period === 'this_week' || period === 'last_week') {
    const mondayOffset = (manilaNow.getUTCDay() + 6) % 7
    const currentMonday = manilaBoundary(year, month, day - mondayOffset)
    const start = period === 'last_week'
      ? new Date(currentMonday.getTime() - 7 * DAY_MS)
      : currentMonday
    const end = period === 'last_week'
      ? currentMonday
      : new Date(currentMonday.getTime() + 7 * DAY_MS)
    return { period, label: labels[period], start, end }
  }
  if (period === 'this_month') {
    return { period, label: labels[period], start: manilaBoundary(year, month, 1), end: manilaBoundary(year, month + 1, 1) }
  }
  return { period, label: labels[period], start: manilaBoundary(year, 0, 1), end: manilaBoundary(year + 1, 0, 1) }
}
