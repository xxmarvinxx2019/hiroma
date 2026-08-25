export const PRODUCT_BINARY_PU_PER_LEG = 2

export function calculateProductBinaryBalance(leftValue: number, rightValue: number) {
  const leftPu = Math.max(0, Math.trunc(Number(leftValue) || 0))
  const rightPu = Math.max(0, Math.trunc(Number(rightValue) || 0))
  const readyPairs = Math.floor(Math.min(leftPu, rightPu) / PRODUCT_BINARY_PU_PER_LEG)
  const remainingLeft = leftPu - readyPairs * PRODUCT_BINARY_PU_PER_LEG
  const remainingRight = rightPu - readyPairs * PRODUCT_BINARY_PU_PER_LEG
  const leftNeeded = Math.max(0, PRODUCT_BINARY_PU_PER_LEG - remainingLeft)
  const rightNeeded = Math.max(0, PRODUCT_BINARY_PU_PER_LEG - remainingRight)
  const focusSide = leftNeeded === rightNeeded ? 'both' : leftNeeded > rightNeeded ? 'left' : 'right'

  return {
    leftPu,
    rightPu,
    readyPairs,
    leftNeeded,
    rightNeeded,
    focusSide,
  }
}
