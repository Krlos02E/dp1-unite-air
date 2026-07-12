export function hasSharedVersionChanged(
  currentVersion: number | null,
  nextVersion: number | null | undefined,
): boolean {
  if (typeof nextVersion !== 'number' || Number.isNaN(nextVersion)) return false
  if (currentVersion === null) return true
  return nextVersion !== currentVersion
}
