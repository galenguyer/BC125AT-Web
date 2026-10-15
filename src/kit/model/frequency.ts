/**
 * A radio frequency in the scanner's native unit of 100 Hz (SPEC.md §3.1), as a plain integer.
 * Integer arithmetic keeps comparisons exact; nothing here uses floating point for values.
 */
export type Frequency = number

/** Truncates to 100 Hz, as the scanner does (406.00625 MHz → 406.0062). */
export function frequencyFromHertz(hertz: number): Frequency {
  return Math.trunc(Math.max(0, hertz) / 100)
}

export function hertzOf(frequency: Frequency): number {
  return frequency * 100
}

const digitsOnly = /^[0-9]+$/

/**
 * Parses a wire value such as `01625500`. Returns `null` for malformed text; `0` is a valid
 * value that callers treat as "no frequency".
 */
export function frequencyFromWire(wire: string): Frequency | null {
  if (!digitsOnly.test(wire)) return null
  const value = Number(wire)
  return value <= 0xffff_ffff ? value : null
}

/** The 8-digit, zero-padded form the scanner uses in replies (and accepts in commands). */
export function wireValue(frequency: Frequency): string {
  return String(frequency).padStart(8, '0')
}

/** `162.5500`: MHz with four decimal places, the scanner's own resolution. */
export function mhz(frequency: Frequency): string {
  const whole = Math.trunc(frequency / 10_000)
  return `${whole}.${String(frequency % 10_000).padStart(4, '0')}`
}

/**
 * Parses what a person types: `162.55`, `162.55 MHz`, `162550k`, `162550 kHz`, `162550000 Hz`.
 *
 * Without a unit, values below 1,000 are MHz, below 1,000,000 kHz, otherwise Hz.
 * Precision beyond 100 Hz is truncated (`154.00625` → 154.0062), matching the scanner.
 */
export function parseFrequency(input: string): Frequency | null {
  let text = input.trim().toLowerCase()
  let unitHz: number | null = null
  for (const [suffix, hz] of [['mhz', 1_000_000], ['khz', 1_000], ['hz', 1], ['m', 1_000_000], ['k', 1_000]] as const) {
    if (text.endsWith(suffix)) {
      unitHz = hz
      text = text.slice(0, -suffix.length).trim()
      break
    }
  }
  const parts = text.split('.')
  if (parts.length < 1 || parts.length > 2) return null
  if (!parts.every((part) => /^[0-9]*$/.test(part))) return null
  if (parts[0] === '' && (parts.length === 1 || parts[1] === '')) return null
  if (parts[0].length > 12) return null
  const whole = parts[0] === '' ? 0 : Number(parts[0])
  const fraction = parts.length === 2 ? parts[1].slice(0, 9) : ''
  const unit = unitHz ?? (whole < 1_000 ? 1_000_000 : whole < 1_000_000 ? 1_000 : 1)
  // Hertz = (whole + fraction) × unit, computed in integers (BigInt keeps 12 digits × 10^6 exact).
  let hertz = BigInt(whole) * BigInt(unit)
  if (fraction !== '') {
    hertz += (BigInt(fraction) * BigInt(unit)) / 10n ** BigInt(fraction.length)
  }
  if (hertz <= 0n || hertz > 10_000_000_000n) return null
  return frequencyFromHertz(Number(hertz))
}

export function compareFrequencies(a: Frequency, b: Frequency): number {
  return a - b
}

/** Sorted, unique. */
export function sortedUnique(frequencies: Frequency[]): Frequency[] {
  return [...new Set(frequencies)].sort(compareFrequencies)
}
