export function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || fallback)
  }
  return fallback
}

export function parseLimit(value: string | null, fallback = 50, max = 200) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.min(max, Math.round(parsed)))
}
