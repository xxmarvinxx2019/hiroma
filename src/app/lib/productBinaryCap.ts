export interface ProductBinaryCapResult {
  payablePairs: number
  capFlashPairs: number
  inactivePairs: number
}

const wholeNonnegative = (value: number) => Math.max(0, Math.floor(Number(value) || 0))

export function calculateProductBinaryDailyCap(
  completedPairs: number,
  usedToday: number,
  capEnabled: boolean,
  capLimit: number,
  isActive: boolean,
): ProductBinaryCapResult {
  const completed = wholeNonnegative(completedPairs)
  if (!isActive) {
    return { payablePairs: 0, capFlashPairs: 0, inactivePairs: completed }
  }

  if (!capEnabled) {
    return { payablePairs: completed, capFlashPairs: 0, inactivePairs: 0 }
  }

  const remaining = Math.max(0, wholeNonnegative(capLimit) - wholeNonnegative(usedToday))
  const payablePairs = Math.min(completed, remaining)
  return {
    payablePairs,
    capFlashPairs: completed - payablePairs,
    inactivePairs: 0,
  }
}
