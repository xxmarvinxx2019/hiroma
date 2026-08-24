export type DashboardPeriodKey =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisYear'
  | 'custom'

export interface DashboardPeriod {
  key: DashboardPeriodKey
  label: string
  comparisonLabel: string
  start: Date
  end: Date
  previousStart: Date
  previousEnd: Date
}

const MANILA_OFFSET = '+08:00'
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const manilaDate = (value: string) => new Date(`${value}T00:00:00${MANILA_OFFSET}`)
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000)
const formatInputDate = (date: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)

const formatLabelDate = (date: Date) =>
  new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)

const monthBoundary = (year: number, month: number) =>
  manilaDate(`${year}-${String(month).padStart(2, '0')}-01`)

export function getDashboardPeriod(searchParams: URLSearchParams, now = new Date()): DashboardPeriod {
  const requested = searchParams.get('period') || 'today'
  const allowed: DashboardPeriodKey[] = ['today', 'yesterday', 'last7', 'thisMonth', 'lastMonth', 'thisYear', 'custom']
  const key: DashboardPeriodKey = allowed.includes(requested as DashboardPeriodKey)
    ? requested as DashboardPeriodKey
    : 'today'

  const todayInput = formatInputDate(now)
  const today = manilaDate(todayInput)
  const [year, month] = todayInput.split('-').map(Number)
  let start: Date
  let end: Date
  let label: string
  let comparisonLabel: string
  let previousStart: Date | undefined
  let previousEnd: Date | undefined

  switch (key) {
    case 'yesterday':
      start = addDays(today, -1)
      end = today
      label = 'Yesterday'
      comparisonLabel = 'vs previous day'
      break
    case 'last7':
      start = addDays(today, -6)
      end = addDays(today, 1)
      label = 'Last 7 days'
      comparisonLabel = 'vs previous 7 days'
      break
    case 'thisMonth':
      start = monthBoundary(year, month)
      end = addDays(today, 1)
      {
        const previousMonth = month === 1 ? 12 : month - 1
        const previousYear = month === 1 ? year - 1 : year
        previousStart = monthBoundary(previousYear, previousMonth)
        previousEnd = new Date(Math.min(
          previousStart.getTime() + (end.getTime() - start.getTime()),
          start.getTime(),
        ))
      }
      label = 'This month'
      comparisonLabel = 'vs same period last month'
      break
    case 'lastMonth': {
      const previousMonth = month === 1 ? 12 : month - 1
      const previousYear = month === 1 ? year - 1 : year
      start = monthBoundary(previousYear, previousMonth)
      end = monthBoundary(year, month)
      const monthBefore = previousMonth === 1 ? 12 : previousMonth - 1
      const yearBefore = previousMonth === 1 ? previousYear - 1 : previousYear
      previousStart = monthBoundary(yearBefore, monthBefore)
      previousEnd = start
      label = 'Last month'
      comparisonLabel = 'vs month before'
      break
    }
    case 'thisYear':
      start = monthBoundary(year, 1)
      end = addDays(today, 1)
      previousStart = monthBoundary(year - 1, 1)
      previousEnd = manilaDate(`${year - 1}-${formatInputDate(end).slice(5)}`)
      label = 'This year'
      comparisonLabel = 'vs same period last year'
      break
    case 'custom': {
      const from = searchParams.get('from') || ''
      const to = searchParams.get('to') || ''
      if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) {
        throw new Error('Select a valid custom date range.')
      }
      start = manilaDate(from)
      end = addDays(manilaDate(to), 1)
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
        throw new Error('The custom date range is invalid.')
      }
      if (end.getTime() - start.getTime() > 5 * 366 * 86_400_000) {
        throw new Error('Custom date range cannot exceed five years.')
      }
      label = `${formatLabelDate(start)} – ${formatLabelDate(addDays(end, -1))}`
      comparisonLabel = 'vs previous equal period'
      break
    }
    case 'today':
    default:
      start = today
      end = addDays(today, 1)
      label = 'Today'
      comparisonLabel = 'vs yesterday'
      break
  }

  const duration = end.getTime() - start.getTime()
  return {
    key,
    label,
    comparisonLabel,
    start,
    end,
    previousStart: previousStart || new Date(start.getTime() - duration),
    previousEnd: previousEnd || start,
  }
}
