/**
 * What the scanner is doing when the app isn't using it, so a read or write can put it back
 * afterwards (SPEC.md §3.8). Program mode always ends in Scan Hold on channel 1, so without this
 * the user would have to press Scan, or find their channel again.
 */
export type ScanMode = { kind: 'scanning' } | { kind: 'hold'; channel: number }

export const scanning: ScanMode = { kind: 'scanning' }
export const holdOn = (channel: number): ScanMode => ({ kind: 'hold', channel })

/** Timings for telling scanning from hold, and for checking a hold took. Shortened in tests. */
export const scanTiming = {
  /** How long the scanner must stay on one channel to count as held. */
  holdWindowMs: 1000,
  /** The same while a signal is open, since scanning also stops on a transmission and for the delay after it. */
  holdWindowWhileReceivingMs: 3500,
  pollMs: 100,
  /** Between checks that `hold(on:)` reached its channel. */
  holdCheckMs: 150,
}

/**
 * Keys pressed remotely with `KEY,<key>,P` (SPEC.md §3.8). Not in Uniden's BC125AT command list,
 * but the scanner accepts it outside program mode, as Uniden's other scanners do.
 * Scan resumes scanning from hold and does nothing while scanning; Hold is a toggle.
 */
export const KEY_SCAN = 'S'
export const KEY_HOLD = 'H'
