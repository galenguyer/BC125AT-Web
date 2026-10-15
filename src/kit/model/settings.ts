import type { Delay } from './channel'
import type { Frequency } from './frequency'

export type Backlight = 'AO' | 'AF' | 'KY' | 'SQ' | 'KS'
export const backlights: readonly Backlight[] = ['AO', 'AF', 'KY', 'SQ', 'KS']
export const backlightName: Record<Backlight, string> = {
  AO: 'Always On',
  AF: 'Always Off',
  KY: 'Keypress',
  SQ: 'Squelch',
  KS: 'Keypress + Squelch',
}

/** `0` auto, `99` off. */
export type KeyBeep = 0 | 99
export const keyBeeps: readonly KeyBeep[] = [0, 99]
export const keyBeepName = (beep: KeyBeep) => (beep === 0 ? 'Auto' : 'Off')

export type PriorityMode = 0 | 1 | 2 | 3
export const priorityModes: readonly PriorityMode[] = [0, 1, 2, 3]
export const priorityModeName: Record<PriorityMode, string> = { 0: 'Off', 1: 'On', 2: 'Plus On', 3: 'Do Not Disturb' }

/** The scanner's two band plans (`BPL`), which use different channel steps in some ranges. */
export type BandPlanRegion = 0 | 1
export const BAND_PLAN_USA: BandPlanRegion = 0
export const BAND_PLAN_CANADA: BandPlanRegion = 1
export const bandPlanRegions: readonly BandPlanRegion[] = [0, 1]
export const bandPlanName = (region: BandPlanRegion) => (region === 0 ? 'USA' : 'Canada')

/** `BLT`, `BSV`, `KBP`, `BPL`, `PRI`, `CNT`, `WXS`, `VOL`, `SQL`. */
export interface SystemSettings {
  backlight: Backlight
  keyBeep: KeyBeep
  keyLock: boolean
  /** 1–15. */
  contrast: number
  /** 1–16 hours. */
  batteryChargeHours: number
  priorityMode: PriorityMode
  weatherAlertPriority: boolean
  /** 0–15. */
  volume: number
  /** 0 (open) – 15 (closed). */
  squelch: number
  bandPlan: BandPlanRegion
}

export function defaultSystemSettings(): SystemSettings {
  return {
    backlight: 'KY',
    keyBeep: 0,
    keyLock: false,
    contrast: 8,
    batteryChargeHours: 9,
    priorityMode: 0,
    weatherAlertPriority: false,
    volume: 8,
    squelch: 2,
    bandPlan: 0,
  }
}

export const CONTRAST_RANGE = [1, 15] as const
export const BATTERY_CHARGE_RANGE = [1, 16] as const
export const LEVEL_RANGE = [0, 15] as const
export const inClosedRange = (range: readonly [number, number], value: number) =>
  Number.isInteger(value) && value >= range[0] && value <= range[1]

/** The ten service search groups, in `SSG` digit order. */
export const serviceSearchGroupNames: readonly string[] = [
  'Police',
  'Fire/Emergency',
  'Ham Radio',
  'Marine',
  'Railroad',
  'Civil Air',
  'Military Air',
  'CB Radio',
  'FRS/GMRS/MURS',
  'Racing',
]

export interface CustomSearchRange {
  lower: Frequency
  upper: Frequency
  enabled: boolean
}

/** The factory ranges (SPEC.md §3.6), confirmed against a real scanner. */
export function factoryCustomRanges(): CustomSearchRange[] {
  return (
    [
      [250_000, 279_950],
      [280_000, 296_950],
      [297_000, 499_950],
      [500_000, 540_000],
      [1_080_000, 1_369_916],
      [1_370_000, 1_439_950],
      [1_440_000, 1_479_950],
      [2_250_000, 3_800_000],
      [4_000_000, 4_499_937],
      [4_500_000, 4_699_937],
    ] as const
  ).map(([lower, upper]) => ({ lower, upper, enabled: true }))
}

/** `SCO`, `SSG`, `CSG`, `CSP`. */
export interface SearchSettings {
  delay: Delay
  /** Search for CTCSS/DCS tones during search and Close Call. */
  codeSearch: boolean
  /** Indexed in `serviceSearchGroupNames` order. */
  serviceGroupsEnabled: boolean[]
  customRanges: CustomSearchRange[]
}

export function defaultSearchSettings(): SearchSettings {
  return {
    delay: 2,
    codeSearch: false,
    serviceGroupsEnabled: Array<boolean>(10).fill(true),
    customRanges: factoryCustomRanges(),
  }
}

export type CloseCallMode = 0 | 1 | 2 | 3
export const closeCallModes: readonly CloseCallMode[] = [0, 1, 2, 3]
/** `3` searches the Close Call bands continuously instead of scanning, until Scan or Srch is pressed. */
export const closeCallModeName: Record<CloseCallMode, string> = {
  0: 'Off',
  1: 'Priority',
  2: 'Do Not Disturb',
  3: 'Close Call Only',
}

/** The five Close Call bands, in `CLC` digit order, named as in the scanner's menu. */
export const closeCallBands: readonly { name: string; range: string }[] = [
  { name: 'VHF Low', range: '25–54 MHz' },
  { name: 'Civil Air', range: '108–137 MHz' },
  { name: 'VHF High', range: '137–174 MHz' },
  { name: 'Military Air', range: '225–320 MHz' },
  { name: 'UHF', range: '320–512 MHz' },
]

/** `CLC`. */
export interface CloseCallSettings {
  mode: CloseCallMode
  alertBeep: boolean
  alertLight: boolean
  /** Indexed in `closeCallBands` order. */
  bandsEnabled: boolean[]
  /**
   * Scan the Close Call Hits bank (the last 10 hits) along with the channels. `CLC` calls this
   * "lockout for CC hits with scan", with `0` = locked out, so `1` means on.
   */
  scanHits: boolean
}

export function defaultCloseCallSettings(): CloseCallSettings {
  return { mode: 0, alertBeep: true, alertLight: true, bandsEnabled: Array<boolean>(5).fill(true), scanHits: false }
}
