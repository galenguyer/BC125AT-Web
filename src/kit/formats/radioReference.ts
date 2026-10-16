import { usaPlan, planContains, type BandPlan } from '../model/bandPlan'
import { bankOfChannel, isEmptyChannel, makeChannel, MAX_NAME_LENGTH, type Channel, type Modulation } from '../model/channel'
import { CHANNEL_COUNT, channelAt, type ScannerConfig } from '../model/config'
import { mhz, parseFrequency } from '../model/frequency'
import { parseTone, type ToneCode } from '../model/tone'
import { parseDelimited } from './csv'

/**
 * Frequencies from a RadioReference CSV export (SPEC.md §5.2).
 *
 * RadioReference's county, agency and category pages export
 * `Frequency Output,Frequency Input,FCC Callsign,Agency/Category,Description,Alpha Tag,PL Output Tone,PL Input Tone,Mode,Class Station Code,Tag`.
 * Every row is kept, so the person can see what was left out and why: a row is usable when its
 * mode is analog AM, FM or FMN and its output frequency is in the scanner's bands.
 */
export interface RadioReferenceEntry {
  /** The 1-based line number in the file. */
  line: number
  frequencyText: string
  mode: string
  alphaTag: string
  description: string
  /** The Agency/Category column (county exports only). */
  category: string
  /** RadioReference's service tag, such as `Fire Dispatch` or `Ham`. */
  tag: string
  toneText: string
  /** The channel to import, or `null` if the scanner can't use this row. */
  channel: Channel | null
  /** Why the row can't be used, when `channel` is `null`. */
  skipReason: string | null
  /** Something about a usable row that didn't carry over, such as an unsupported tone. */
  note: string | null
}

export class RadioReferenceImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RadioReferenceImportError'
  }
}

/**
 * The modulations RadioReference uses for analog voice, and the scanner's equivalents.
 * RadioReference's `FM` is wideband (25 kHz) and `FMN` narrowband (12.5 kHz).
 */
const modulations: Record<string, Modulation> = { AM: 'AM', FM: 'FM', FMN: 'NFM', NFM: 'NFM' }

type Column = 'frequency' | 'mode' | 'alphaTag' | 'description' | 'category' | 'tag' | 'tone'
const columnTitles: Record<Column, string> = {
  frequency: 'Frequency Output',
  mode: 'Mode',
  alphaTag: 'Alpha Tag',
  description: 'Description',
  category: 'Agency/Category',
  tag: 'Tag',
  tone: 'PL Output Tone',
}
const aliases: Record<Column, string[]> = {
  frequency: ['frequencyoutput', 'frequency', 'output', 'freq'],
  mode: ['mode', 'modulation'],
  alphaTag: ['alphatag'],
  description: ['description'],
  category: ['agencycategory', 'category', 'agency'],
  tag: ['tag'],
  tone: ['ploutputtone', 'tone', 'pltone', 'ctcssdcs'],
}

function columnNamed(title: string): Column | null {
  const key = [...title.toLowerCase()].filter((c) => /[\p{L}\p{N}]/u.test(c)).join('')
  return (Object.keys(aliases) as Column[]).find((column) => aliases[column].includes(key)) ?? null
}

/** Reads every row of an export. `plan` decides which frequencies are in range. */
export function radioReferenceEntries(text: string, plan: BandPlan = usaPlan): RadioReferenceEntry[] {
  const rows = parseDelimited(text)
  if (rows.length === 0) throw new RadioReferenceImportError('The file is empty.')
  const columns = new Map<Column, number>()
  rows[0].forEach((title, offset) => {
    const column = columnNamed(title)
    if (column && !columns.has(column)) columns.set(column, offset)
  })
  const missing = (['frequency', 'mode'] as Column[]).filter((c) => !columns.has(c))
  if (missing.length > 0) {
    throw new RadioReferenceImportError(`This doesn't look like a RadioReference export: it has no ${missing.map((c) => columnTitles[c]).join(' or ')} column.`)
  }

  const entries: RadioReferenceEntry[] = []
  rows.slice(1).forEach((row, offset) => {
    if (!row.some((field) => field.trim() !== '')) return
    const value = (column: Column) => {
      const index = columns.get(column)
      return index === undefined || index >= row.length ? '' : row[index].trim()
    }
    const entry: RadioReferenceEntry = {
      line: offset + 2,
      frequencyText: value('frequency'),
      mode: value('mode'),
      alphaTag: value('alphaTag'),
      description: value('description'),
      category: value('category'),
      tag: value('tag'),
      toneText: value('tone'),
      channel: null,
      skipReason: null,
      note: null,
    }
    build(entry, plan)
    entries.push(entry)
  })
  return entries
}

function build(entry: RadioReferenceEntry, plan: BandPlan) {
  const frequency = parseFrequency(entry.frequencyText)
  if (frequency === null) {
    entry.skipReason = entry.frequencyText === '' ? 'No frequency' : `Frequency ${JSON.stringify(entry.frequencyText)} isn't a number`
    return
  }
  const modulation = modulations[entry.mode.toUpperCase()]
  if (!modulation) {
    entry.skipReason = reasonForMode(entry.mode)
    return
  }
  if (!planContains(plan, frequency)) {
    entry.skipReason = `${mhz(frequency)} MHz is outside the scanner's bands`
    return
  }
  const channel = makeChannel({ name: radioReferenceName(entry.alphaTag, entry.description), frequency, modulation })
  if (entry.toneText !== '') {
    const tone = radioReferenceTone(entry.toneText)
    if (tone === null) entry.note = `Tone ${JSON.stringify(entry.toneText)} isn't one the scanner decodes, so the channel is open (CSQ)`
    else channel.tone = tone
  }
  entry.channel = channel
}

/**
 * The usable rows to select at first, by line: all of them, except ones whose name and frequency
 * are already on a channel in `config` or on an earlier row, so importing an overlapping file
 * doesn't add the same channel twice.
 */
export function defaultSelection(entries: RadioReferenceEntry[], config: ScannerConfig): Set<number> {
  const key = (name: string, frequency: number) => `${frequency}\u0000${name}`
  const seen = new Set(config.channels.filter((c) => c.frequency !== null).map((c) => key(c.name, c.frequency!)))
  const selected = new Set<number>()
  for (const entry of entries) {
    if (entry.channel?.frequency == null) continue
    const k = key(entry.channel.name, entry.channel.frequency)
    if (seen.has(k)) continue
    seen.add(k)
    selected.add(entry.line)
  }
  return selected
}

export function reasonForMode(mode: string): string {
  const key = [...mode.toUpperCase()].filter((c) => /[A-Z0-9]/.test(c)).join('')
  if (key === '') return 'No mode'
  if (['LTR', 'MOTOROLA', 'EDACS', 'MPT1327', 'MPT'].includes(key)) return `${mode} is a trunked system`
  if (['TELM', 'DATA', 'TELEMETRY'].includes(key)) return `${mode} is data, not voice`
  if (
    ['DMR', 'DMRE', 'P25', 'PROJECT25', 'NXDN', 'NXDN48', 'NXDN96', 'DSTAR', 'YSF', 'DPMR', 'TETRA', 'PROVOICE', 'P25E'].includes(key) ||
    key.startsWith('NXDN') ||
    key.startsWith('DMR') ||
    key.startsWith('P25')
  ) {
    return `${mode} is digital`
  }
  return `The scanner doesn't receive ${mode}`
}

/**
 * The alpha tag, or the description if there's no tag, made into a name the scanner accepts:
 * plain ASCII, no commas, at most 16 characters.
 */
export function radioReferenceName(alphaTag: string, description: string): string {
  const source = alphaTag === '' ? description : alphaTag
  const ascii = [...source]
    .map((c) => (c === ',' ? ' ' : c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) <= 0x7e && c.length === 1 ? c : ''))
    .join('')
  return ascii.trim().slice(0, MAX_NAME_LENGTH).trimEnd()
}

/**
 * `110.9 PL` → CTCSS 110.9, `023 DPL` → DCS 023, `CSQ` → none. RadioReference's digital codes
 * (`NAC`, `RAN`, `CC`) return `null`.
 */
export function radioReferenceTone(text: string): ToneCode | null {
  const parts = text.split(' ').filter((p) => p !== '')
  if (parts.length === 0) return parseTone('')
  const value = parts[0]
  const kind = parts.length > 1 ? parts[parts.length - 1].toUpperCase() : ''
  if (kind === 'PL') return parseTone(`ctcss${value}`)
  if (kind === 'DPL' || kind === 'DCS') return parseTone(`dcs${value}`)
  if (kind === '') return parseTone(value)
  return null
}

// MARK: Placement

/** How many empty channels there are in a row starting at `start` (0 if `start` is in use). */
export function emptyRun(config: ScannerConfig, start: number): number {
  if (!(start >= 1 && start <= CHANNEL_COUNT)) return 0
  let number = start
  while (number <= CHANNEL_COUNT && isEmptyChannel(channelAt(config, number))) number++
  return number - start
}

/**
 * Where an import of `count` channels starts at first: the lowest selected channel if it's empty,
 * otherwise the first run of empty channels that fits (or the first empty channel).
 */
export function importStart(config: ScannerConfig, selection: Iterable<number>, count: number): number {
  const first = Math.min(...selection)
  if (first >= 1 && first <= CHANNEL_COUNT && isEmptyChannel(channelAt(config, first))) return first
  return firstEmptyRun(config, Math.max(count, 1)) ?? firstEmptyRun(config, 1) ?? 1
}

/** Whether `count` channels from `start` run past the end of `start`'s bank. */
export const crossesBanks = (start: number, count: number) => count > 0 && bankOfChannel(start) !== bankOfChannel(start + count - 1)

/**
 * The first channel that starts `count` empty channels in a row, or `null` if there isn't room.
 * Prefers a run that stays in one bank.
 */
export function firstEmptyRun(config: ScannerConfig, count: number): number | null {
  if (count <= 0) return null
  const starts: number[] = []
  for (let start = 1; start <= CHANNEL_COUNT; start++) if (emptyRun(config, start) >= count) starts.push(start)
  return starts.find((start) => !crossesBanks(start, count)) ?? starts[0] ?? null
}

/**
 * Writes `channels` into consecutive slots from `start` (mutating `config`; pass a draft).
 * Returns `false`, and changes nothing, unless every one of those slots is empty.
 */
export function insertChannels(config: ScannerConfig, channels: Channel[], start: number): boolean {
  if (channels.length === 0 || emptyRun(config, start) < channels.length) return false
  channels.forEach((channel, offset) => {
    config.channels[start + offset - 1] = channel
  })
  return true
}
