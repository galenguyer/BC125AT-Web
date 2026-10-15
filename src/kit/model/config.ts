import { canadaPlan, usaPlan, type BandPlan } from './bandPlan'
import { channelsInBank, emptyChannel, isEmptyChannel, type Channel } from './channel'
import {
  defaultCloseCallSettings,
  defaultSearchSettings,
  defaultSystemSettings,
  type CloseCallSettings,
  type SearchSettings,
  type SystemSettings,
} from './settings'
import type { Frequency } from './frequency'

export const CHANNEL_COUNT = 500
export const BANK_COUNT = 10
export const MAX_GLOBAL_LOCKOUTS = 100

export interface Metadata {
  model: string | null
  firmware: string | null
  /** ISO 8601, to the second (`2026-10-15T14:03:22Z`). */
  readAt: string | null
  notes: string
}

/** Everything the app reads from, and writes to, a BC125AT (SPEC.md §4). */
export interface ScannerConfig {
  /** Always exactly 500; channel number = index + 1. */
  channels: Channel[]
  /** Indexed by bank − 1. */
  bankScanEnabled: boolean[]
  /** App-only labels for banks; never sent to the scanner. Indexed by bank − 1. */
  bankNames: string[]
  settings: SystemSettings
  search: SearchSettings
  closeCall: CloseCallSettings
  /** Sorted and unique. */
  globalLockouts: Frequency[]
  metadata: Metadata
}

export function makeConfig(): ScannerConfig {
  return {
    channels: Array.from({ length: CHANNEL_COUNT }, emptyChannel),
    bankScanEnabled: Array<boolean>(BANK_COUNT).fill(true),
    bankNames: Array<string>(BANK_COUNT).fill(''),
    settings: defaultSystemSettings(),
    search: defaultSearchSettings(),
    closeCall: defaultCloseCallSettings(),
    globalLockouts: [],
    metadata: { model: null, firmware: null, readAt: null, notes: '' },
  }
}

/** Channel by number, 1–500. */
export const channelAt = (config: ScannerConfig, number: number): Channel => config.channels[number - 1]

export const usedChannelCount = (config: ScannerConfig) => config.channels.filter((c) => !isEmptyChannel(c)).length

export const usedChannelCountInBank = (config: ScannerConfig, bank: number) =>
  channelsInBank(bank).filter((n) => !isEmptyChannel(channelAt(config, n))).length

/** The channel plan to predict stored frequencies with, for this configuration's band plan. */
export const channelPlan = (config: ScannerConfig): BandPlan => (config.settings.bandPlan === 1 ? canadaPlan : usaPlan)

/** A deep copy, safe to mutate. */
export const cloneConfig = (config: ScannerConfig): ScannerConfig => structuredClone(config)

/** Structural equality for plain JSON-like values (objects, arrays, primitives, null). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false
    return true
  }
  if (Array.isArray(b)) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (const key of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false
    if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false
  }
  return true
}

export const configsEqual = (a: ScannerConfig, b: ScannerConfig) => deepEqual(a, b)

/** The current time as the native format stores it: ISO 8601 without fractional seconds. */
export function isoNow(date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}
