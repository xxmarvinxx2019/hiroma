export const PUBLIC_VERIFICATION_WINDOW_MINUTES = 5
export const PUBLIC_VERIFICATION_WINDOW_LIMIT = 30

export function maskVerificationName(name: string) {
  return name.trim().split(/\s+/).filter(Boolean).map((part) => {
    const characters = Array.from(part)
    return characters.length <= 1 ? `${characters[0] || ''}*` : `${characters[0]}${'*'.repeat(Math.min(characters.length - 1, 4))}`
  }).join(' ')
}
