import { isModulation, type Modulation } from './channel'
import { CHANNEL_COUNT } from './config'
import { frequencyFromWire, type Frequency } from './frequency'
import { toneFromCode, type ToneCode } from './tone'

/**
 * What the scanner is tuned to right now, from `GLG` (SPEC.md §3.7). `GLG` isn't in Uniden's
 * BC125AT command list, but the scanner answers it outside program mode, using the same layout as
 * Uniden's other scanners:
 *
 * `GLG,[FRQ],[MOD],[ATT],[CTCSS/DCS],[NAME1],[NAME2],[NAME3],[SQL],[MUT],[SYS_TAG],[CHAN_TAG],[NAC]`
 *
 * On the BC125AT, NAME3 is the channel name, CHAN_TAG the channel number, SQL is 1 while a signal
 * holds squelch open, and the other name and tag fields are empty.
 */
export interface LiveStatus {
  /** `null` when the scanner reports no frequency (in a menu, or between modes). */
  frequency: Frequency | null
  modulation: Modulation | null
  tone: ToneCode | null
  name: string
  /** The memory channel, when the scanner is on one (not while searching or on Close Call). */
  channel: number | null
  /** A signal is holding squelch open. */
  receiving: boolean
  muted: boolean
}

const integer = (text: string) => (/^[+-]?[0-9]+$/.test(text) ? Number(text) : null)

/** Parses `GLG`'s fields (without the command name). Missing or empty fields become `null`. */
export function parseGLG(fields: string[]): LiveStatus {
  const field = (index: number) => (index < fields.length ? fields[index].trim() : '')
  const frequency = frequencyFromWire(field(0))
  const modulation = field(1).toUpperCase()
  const tone = integer(field(3))
  const channel = integer(field(10))
  return {
    frequency: frequency !== null && frequency > 0 ? frequency : null,
    modulation: isModulation(modulation) ? modulation : null,
    tone: tone === null ? null : toneFromCode(tone),
    name: [field(6), field(5), field(4)].find((name) => name !== '') ?? '',
    receiving: field(7) === '1',
    muted: field(8) === '1',
    channel: channel !== null && channel >= 1 && channel <= CHANNEL_COUNT ? channel : null,
  }
}
