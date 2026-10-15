import type { Frequency } from './frequency'

/**
 * Which frequencies the scanner accepts, and where it moves the ones that are off its channel plan.
 *
 * The tables are the owner's manual's; the rules were measured on a BC125AT running firmware 1.06.06
 * (SPEC.md §3.5):
 * 1. Valid points are `start + n × step` within a segment, truncated to 100 Hz.
 * 2. Any other in-range frequency is stored as the nearest valid point (compared after
 *    truncation), with exact ties rounding up.
 * 3. In 137–174 MHz, exact multiples of 5 kHz are kept as sent.
 */
export interface Segment {
  /** Hertz. */
  start: number
  /** Hertz, inclusive. */
  end: number
  /** Step in hertz as a fraction, so 8.33 kHz (25000/3) stays exact. `0` for a single channel. */
  stepNumerator: number
  stepDenominator: number
}

/** An inclusive range in 100 Hz units. */
export type Range = readonly [lower: number, upper: number]

export interface BandPlan {
  /** Frequency ranges the scanner accepts at all, in 100 Hz units (inclusive). */
  ranges: readonly Range[]
  segments: readonly Segment[]
  /** Ranges where an exact multiple of 5 kHz is stored as sent, in 100 Hz units. */
  keepsExact5kHz: readonly Range[]
}

const inRange = (range: Range, value: number) => value >= range[0] && value <= range[1]

/** The valid points nearest to `hundredHz` from below and above, within `segment`. */
function neighbours(segment: Segment, hundredHz: number): [number | null, number | null] {
  const { start, end, stepNumerator, stepDenominator } = segment
  const first = Math.trunc(start / 100)
  if (stepNumerator <= 0) return [first <= hundredHz ? first : null, first >= hundredHz ? first : null]
  const count = Math.trunc(((end - start) * stepDenominator) / stepNumerator)
  const point = (n: number) => Math.trunc((start * stepDenominator + n * stepNumerator) / (stepDenominator * 100))
  // Largest n whose truncated point is ≤ hundredHz.
  let n = Math.max(0, Math.min(count, Math.trunc(((hundredHz * 100 - start) * stepDenominator) / stepNumerator)))
  while (n > 0 && point(n) > hundredHz) n -= 1
  while (n < count && point(n + 1) <= hundredHz) n += 1
  const below = point(n) <= hundredHz ? point(n) : null
  const above = point(n) >= hundredHz ? point(n) : n < count ? point(n + 1) : null
  return [below, above]
}

export function planContains(plan: BandPlan, frequency: Frequency): boolean {
  return plan.ranges.some((range) => inRange(range, frequency))
}

/** What the scanner will store if sent `frequency`, or `null` if it would reject it (`CIN,ERR`). */
export function storedValue(plan: BandPlan, frequency: Frequency): Frequency | null {
  const range = plan.ranges.find((r) => inRange(r, frequency))
  if (!range) return null
  if (plan.segments.length === 0) return frequency
  if (frequency % 50 === 0 && plan.keepsExact5kHz.some((r) => inRange(r, frequency))) return frequency
  let best: number | null = null
  for (const segment of plan.segments) {
    if (Math.trunc(segment.end / 100) < range[0] || Math.trunc(segment.start / 100) > range[1]) continue
    for (const candidate of neighbours(segment, frequency)) {
      if (candidate === null) continue
      if (best === null) {
        best = candidate
        continue
      }
      const distance = Math.abs(candidate - frequency)
      const bestDistance = Math.abs(best - frequency)
      if (distance < bestDistance || (distance === bestDistance && candidate > best)) best = candidate
    }
  }
  return best
}

const ranges: Range[] = [
  [250_000, 540_000],
  [1_080_000, 1_740_000],
  [2_250_000, 3_800_000],
  [4_000_000, 5_120_000],
]

/**
 * One row of a band plan table in the owner's manual, in hertz. The manual prints frequencies
 * to 100 Hz, so a few are written out here in full: 136.99167 (printed 136.9916), 154.45625
 * (154.4562), 173.20375 (173.2037) and 173.39625 (173.3962).
 */
function row(lower: number, upper: number, step: number): Segment {
  return step === 8_333
    ? { start: lower, end: upper, stepNumerator: 25_000, stepDenominator: 3 }
    : { start: lower, end: upper, stepNumerator: step, stepDenominator: 1 }
}

/**
 * The USA band plan, from the table in the owner's manual ("USA Band Plan", p. 14).
 *
 * Checked against Phase 0's measurements (SPEC.md §3.5): both give the same 44,967 points. The
 * manual doesn't give the snapping rules or the 137–174 MHz exact-5 kHz exception; those were measured.
 */
export const usaPlan: BandPlan = {
  ranges,
  segments: [
    row(25_000_000, 27_995_000, 5_000),
    row(28_000_000, 54_000_000, 5_000),
    row(108_000_000, 136_991_667, 8_333),
    row(137_000_000, 150_770_000, 5_000),
    row(150_775_000, 150_812_500, 7_500),
    row(150_815_000, 154_452_500, 7_500),
    row(154_456_250, 154_478_750, 7_500),
    row(154_482_500, 154_512_500, 7_500),
    row(154_515_000, 154_525_000, 5_000),
    row(154_527_500, 154_535_000, 7_500),
    row(154_540_000, 154_607_500, 7_500),
    row(154_610_000, 154_647_500, 7_500),
    row(154_650_000, 157_447_500, 7_500),
    row(157_450_000, 157_465_000, 5_000),
    row(157_470_000, 163_245_000, 7_500),
    row(163_250_000, 173_200_000, 12_500),
    row(173_203_750, 173_210_000, 6_250),
    row(173_215_000, 173_220_000, 5_000),
    row(173_225_000, 173_387_500, 12_500),
    row(173_390_000, 173_396_250, 6_250),
    row(173_400_000, 174_000_000, 5_000),
    row(225_000_000, 380_000_000, 12_500),
    row(400_000_000, 512_000_000, 6_250),
  ],
  keepsExact5kHz: [[1_370_000, 1_740_000]],
}

/**
 * The Canada band plan, from the table in the owner's manual ("Canada Band Plan", p. 15): the
 * USA plan with a plain 5 kHz grid in 137–174 MHz. Spot-checked on hardware (SPEC.md §3.5).
 */
export const canadaPlan: BandPlan = {
  ranges,
  segments: [
    row(25_000_000, 27_995_000, 5_000),
    row(28_000_000, 54_000_000, 5_000),
    row(108_000_000, 136_991_667, 8_333),
    row(137_000_000, 174_000_000, 5_000),
    row(225_000_000, 380_000_000, 12_500),
    row(400_000_000, 512_000_000, 6_250),
  ],
  keepsExact5kHz: [],
}

/**
 * Only the scanner's frequency ranges, with every in-range frequency predicted to be stored
 * as sent. For comparing against values that are already as stored.
 */
export const rangesOnlyPlan: BandPlan = { ranges, segments: [], keepsExact5kHz: [] }
