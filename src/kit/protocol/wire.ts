import { delayFromNumber, isModulation, makeChannel, type Channel } from '../model/channel'
import { frequencyFromWire, wireValue } from '../model/frequency'
import { toneFromCode } from '../model/tone'

/** A reply the app can't understand. */
export class FormatError extends Error {
  readonly command: string
  readonly fields: string[]

  constructor(command: string, fields: string[]) {
    super(`Can't understand reply ${JSON.stringify([command, ...fields].join(','))}`)
    this.name = 'FormatError'
    this.command = command
    this.fields = fields
  }
}

// Conversions between model types and command fields (SPEC.md §3). Parsing takes the fields
// after the command name, as returned by `ScannerConnection.execute`.

export function wireBool(field: string): boolean | null {
  return field === '0' ? false : field === '1' ? true : null
}

export const wireFlag = (value: boolean) => (value ? '1' : '0')

export function wireInt(field: string, range?: readonly [number, number]): number | null {
  if (!/^[+-]?[0-9]+$/.test(field)) return null
  const value = Number(field)
  if (range && (value < range[0] || value > range[1])) return null
  return value
}

/**
 * Parses `CIN` reply fields: the index from the left, the six fixed fields from the right, and
 * whatever lies between is the name (so a comma in a name can't shift fields).
 */
export function channelFromCIN(fields: string[]): { number: number; channel: Channel } {
  const error = new FormatError('CIN', fields)
  const number = fields.length >= 8 ? wireInt(fields[0]) : null
  if (number === null) throw error
  const tail = fields.slice(-6)
  const frequency = frequencyFromWire(tail[0])
  const modulation = tail[1]
  const toneNumber = wireInt(tail[2])
  const tone = toneNumber === null ? null : toneFromCode(toneNumber)
  const delayNumber = wireInt(tail[3])
  const delay = delayNumber === null ? null : delayFromNumber(delayNumber)
  const lockedOut = wireBool(tail[4])
  const priority = wireBool(tail[5])
  if (frequency === null || !isModulation(modulation) || tone === null || delay === null || lockedOut === null || priority === null) throw error
  return {
    number,
    channel: makeChannel({
      name: fields.slice(1, fields.length - 6).join(','),
      frequency: frequency === 0 ? null : frequency,
      modulation,
      tone,
      delay,
      lockedOut,
      priority,
    }),
  }
}

/**
 * The command that writes `channel` to slot `number`: `DCH` for an empty channel, otherwise a
 * full `CIN` set. A blank name is sent as a single space, because an empty field means "leave
 * unchanged" (SPEC.md §3).
 */
export function commandWritingChannel(channel: Channel, number: number): string {
  if (channel.frequency === null) return `DCH,${number}`
  const name = channel.name === '' ? ' ' : channel.name
  return [
    'CIN',
    `${number}`,
    name,
    wireValue(channel.frequency),
    channel.modulation,
    `${channel.tone}`,
    `${channel.delay}`,
    wireFlag(channel.lockedOut),
    wireFlag(channel.priority),
  ].join(',')
}

/** `SCG`/`SSG`/`CSG` digits: `0` = enabled. */
export function enabledFlagsFromInvertedMask(mask: string, count: number, command: string): boolean[] {
  if (mask.length !== count || !/^[01]*$/.test(mask)) throw new FormatError(command, [mask])
  return [...mask].map((digit) => digit === '0')
}

export const invertedMask = (enabled: boolean[]) => enabled.map((on) => (on ? '0' : '1')).join('')
