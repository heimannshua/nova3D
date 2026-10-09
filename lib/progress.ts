/** A progress value as a whole-number-safe percentage: NaN and infinities become 0, anything else is held to 0 to 100. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
