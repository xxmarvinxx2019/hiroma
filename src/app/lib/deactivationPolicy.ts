/**
 * Unmatched binary carryover is not an earned commission or cash liability.
 * Preserve the point count for audit, but expire it at zero monetary value.
 */
export function expiredBinaryCarryoverValue(leftPoints: number, rightPoints: number) {
  void leftPoints
  void rightPoints
  return 0
}
