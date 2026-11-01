// The caller supplies a locked allowance for the current Manila session.
// Existing carryover is preserved; only volume from this source can be rejected.
export function planPackageBinarySession(input: {
  left: number; right: number; sourcePoints: number; leg: 'left' | 'right';
  pointsPerPair: number; remainingPairs: number | null;
}) {
  const { left, right, sourcePoints, leg, pointsPerPair, remainingPairs } = input
  for (const value of [left, right, sourcePoints, pointsPerPair]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid binary session points.')
  }
  if (pointsPerPair === 0 || (remainingPairs !== null && (!Number.isSafeInteger(remainingPairs) || remainingPairs < 0))) {
    throw new Error('Invalid binary session allowance.')
  }
  const availableLeft = left + (leg === 'left' ? sourcePoints : 0)
  const availableRight = right + (leg === 'right' ? sourcePoints : 0)
  const potential = Math.floor(Math.min(availableLeft, availableRight) / pointsPerPair)
  const completedPairs = remainingPairs === null ? potential : Math.min(potential, remainingPairs)
  let acceptedPoints = sourcePoints
  if (remainingPairs !== null && potential >= remainingPairs) {
    acceptedPoints = Math.min(sourcePoints, Math.max(0, remainingPairs * pointsPerPair - (leg === 'left' ? left : right)))
  }
  const consumedPoints = completedPairs * pointsPerPair
  return {
    acceptedPoints, flushedPoints: sourcePoints - acceptedPoints, completedPairs, consumedPoints,
    leftPoints: left + (leg === 'left' ? acceptedPoints : 0) - consumedPoints,
    rightPoints: right + (leg === 'right' ? acceptedPoints : 0) - consumedPoints,
  }
}
