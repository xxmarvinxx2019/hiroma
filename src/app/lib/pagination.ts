const DEFAULT_MAX_PAGE = 10_000

function positiveSafeInteger(value: string | null, fallback: number) {
  if (value == null || value.trim() === '') return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function boundedPage(value: string | null, fallback = 1, max = DEFAULT_MAX_PAGE) {
  return Math.min(max, positiveSafeInteger(value, fallback))
}

export function boundedPageSize(value: string | null, fallback = 15, max = 50) {
  return Math.min(max, positiveSafeInteger(value, fallback))
}
