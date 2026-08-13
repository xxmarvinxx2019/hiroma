export function isBinaryTreeSlotConflict(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const code = Reflect.get(error, 'code')
  const meta = Reflect.get(error, 'meta')
  if (code !== 'P2002') return false
  const target = JSON.stringify(meta || {})
  return target.includes('parent_id') && target.includes('position')
}
