import type { Frequency } from './frequency'
import { TONE_NONE, type ToneCode } from './tone'

export type Modulation = 'AUTO' | 'AM' | 'FM' | 'NFM'
export const modulations: readonly Modulation[] = ['AUTO', 'AM', 'FM', 'NFM']
export const modulationName = (m: Modulation) => (m === 'AUTO' ? 'Auto' : m)
export function isModulation(text: string): text is Modulation {
  return (modulations as readonly string[]).includes(text)
}

/**
 * How long the scanner stays on a channel after a transmission ends, in seconds. Negative values
 * are Uniden's "minus delay" modes.
 */
export type Delay = -10 | -5 | 0 | 1 | 2 | 3 | 4 | 5
export const delays: readonly Delay[] = [-10, -5, 0, 1, 2, 3, 4, 5]
export const delayName = (d: Delay) => (d < 0 ? `−${-d} s` : `${d} s`)
export function delayFromNumber(value: number): Delay | null {
  return (delays as readonly number[]).includes(value) ? (value as Delay) : null
}

/**
 * One of the scanner's 500 memory channels (SPEC.md §3.1). Its position comes from the array
 * it lives in (`ScannerConfig.channels`), not from a stored index.
 */
export interface Channel {
  name: string
  /** `null` for an empty channel. */
  frequency: Frequency | null
  modulation: Modulation
  tone: ToneCode
  delay: Delay
  lockedOut: boolean
  priority: boolean
}

export const MAX_NAME_LENGTH = 16

export function makeChannel(fields: Partial<Channel> = {}): Channel {
  return {
    name: '',
    frequency: null,
    modulation: 'AUTO',
    tone: TONE_NONE,
    delay: 2,
    lockedOut: false,
    priority: false,
    ...fields,
  }
}

/**
 * An empty channel exactly as the scanner reports it: `CIN,n,,00000000,AUTO,0,2,1,0`.
 * Note that it is locked out.
 */
export function emptyChannel(): Channel {
  return makeChannel({ lockedOut: true })
}

export const isEmptyChannel = (channel: Channel) => channel.frequency === null

export function channelsEqual(a: Channel, b: Channel): boolean {
  return (
    a.name === b.name &&
    a.frequency === b.frequency &&
    a.modulation === b.modulation &&
    a.tone === b.tone &&
    a.delay === b.delay &&
    a.lockedOut === b.lockedOut &&
    a.priority === b.priority
  )
}

/** Bank 1–10 for a channel number 1–500. */
export const bankOfChannel = (number: number) => Math.trunc((number - 1) / 50) + 1

/** Channel numbers 1–500 in a bank 1–10. */
export function channelsInBank(bank: number): number[] {
  return Array.from({ length: 50 }, (_, i) => (bank - 1) * 50 + 1 + i)
}

/** The number of characters, as the scanner counts them (one per code point). */
export const nameLength = (name: string) => [...name].length

/** The first `count` characters (code points) of `name`. */
export const namePrefix = (name: string, count: number) => [...name].slice(0, count).join('')
