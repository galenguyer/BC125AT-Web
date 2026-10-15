import { bankOfChannel, delayFromNumber, emptyChannel, isEmptyChannel, isModulation, makeChannel, type Channel } from '../model/channel'
import { CHANNEL_COUNT, type ScannerConfig } from '../model/config'
import { mhz, parseFrequency } from '../model/frequency'
import { parseTone, toneFromCode, toneName } from '../model/tone'

/**
 * Channel import and export as CSV (SPEC.md §5).
 *
 * Export writes `Channel,Bank,Name,Frequency,Modulation,Tone,Delay,Lockout,Priority` for every
 * non-empty channel. Import matches columns by header name, so it also reads bc125py's
 * `Index,Name,Frequency (MHz),Modulation,CTCSS,Delay (sec),Lockout,Priority` exports.
 */
export const CSV_HEADER = ['Channel', 'Bank', 'Name', 'Frequency', 'Modulation', 'Tone', 'Delay', 'Lockout', 'Priority']

export function exportCSV(config: ScannerConfig): string {
  const rows = [CSV_HEADER]
  config.channels.forEach((channel, offset) => {
    if (channel.frequency === null) return
    const number = offset + 1
    rows.push([
      `${number}`,
      `${bankOfChannel(number)}`,
      channel.name,
      mhz(channel.frequency),
      channel.modulation,
      toneName(channel.tone),
      `${channel.delay}`,
      channel.lockedOut ? 'Yes' : 'No',
      channel.priority ? 'Yes' : 'No',
    ])
  })
  return `${rows.map((row) => row.map(quote).join(',')).join('\r\n')}\r\n`
}

export interface CSVImport {
  /** Channels to apply, by number. An entry with no frequency clears that channel. */
  channels: { number: number; channel: Channel }[]
  /** Rows that couldn't be used, with 1-based line numbers. */
  problems: { line: number; message: string }[]
}

export class CSVImportError extends Error {
  readonly missing: string[]

  constructor(missing: string[]) {
    super(`The CSV has no ${missing.join(' or ')} column.`)
    this.name = 'CSVImportError'
    this.missing = missing
  }
}

export function importCSV(text: string): CSVImport {
  const rows = parseDelimited(text)
  if (rows.length === 0) return { channels: [], problems: [] }
  const columns = columnsFromHeader(rows[0])
  const missing = (['channel', 'frequency'] as Column[]).filter((c) => columns.get(c) === undefined)
  if (missing.length > 0) throw new CSVImportError(missing.map(columnTitle))

  const result: CSVImport = { channels: [], problems: [] }
  rows.slice(1).forEach((row, offset) => {
    const line = offset + 2
    if (!row.some((field) => field.trim() !== '')) return
    const index = columns.get('channel')!
    const numberText = index < row.length ? row[index].trim() : ''
    const number = /^[+-]?[0-9]+$/.test(numberText) ? Number(numberText) : NaN
    if (!(number >= 1 && number <= CHANNEL_COUNT)) {
      result.problems.push({ line, message: `Channel number ${numberText === '' ? 'is missing' : JSON.stringify(numberText)} isn't 1–500` })
      return
    }
    const parsed = channelFromRow(row, columns)
    if (typeof parsed === 'string') result.problems.push({ line, message: parsed })
    else result.channels.push({ number, channel: parsed })
  })
  return result
}

// MARK: Columns

export type Column = 'channel' | 'name' | 'frequency' | 'modulation' | 'tone' | 'delay' | 'lockout' | 'priority'
const allColumns: Column[] = ['channel', 'name', 'frequency', 'modulation', 'tone', 'delay', 'lockout', 'priority']
const columnTitle = (column: Column) => column[0].toUpperCase() + column.slice(1)

const aliases: Record<Column, string[]> = {
  channel: ['channel', 'index', 'ch', 'number', 'no'],
  name: ['name', 'alphatag', 'tag', 'label'],
  frequency: ['frequency', 'frequencymhz', 'freq', 'freqmhz', 'mhz'],
  modulation: ['modulation', 'mod', 'mode'],
  tone: ['tone', 'ctcss', 'ctcssdcs', 'dcs', 'tonecode', 'squelchcode'],
  delay: ['delay', 'delaysec', 'dly'],
  lockout: ['lockout', 'lockedout', 'lo', 'lout'],
  priority: ['priority', 'pri'],
}

export function columnNamed(title: string): Column | null {
  const key = [...title.toLowerCase()].filter((c) => /[\p{L}\p{N}]/u.test(c)).join('')
  return allColumns.find((column) => aliases[column].includes(key)) ?? null
}

export function columnsFromHeader(row: string[]): Map<Column, number> {
  const columns = new Map<Column, number>()
  row.forEach((title, offset) => {
    const column = columnNamed(title)
    if (column && !columns.has(column)) columns.set(column, offset)
  })
  return columns
}

function flag(text: string, trueWords: string[], falseWords: string[]): boolean | null {
  const letters = [...text.toLowerCase()].filter((c) => /\p{L}/u.test(c)).join('')
  const key = letters === '' ? text.toLowerCase() : letters
  if (['yes', 'y', 'true', 'on', '1'].includes(key) || trueWords.includes(key)) return true
  if (['no', 'n', 'false', 'off', '0'].includes(key) || falseWords.includes(key)) return false
  return null
}

/**
 * Builds a channel from one row, using whichever columns are present, or returns the problem.
 * Shared with the clipboard so pasted rows and imported files understand the same values.
 */
export function channelFromRow(row: string[], columns: Map<Column, number>): Channel | string {
  const value = (column: Column) => {
    const index = columns.get(column)
    if (index === undefined || index >= row.length) return null
    const text = row[index].trim()
    return text === '' ? null : text
  }
  const nameIndex = columns.get('name')
  const channel = makeChannel({ name: nameIndex !== undefined && nameIndex < row.length ? row[nameIndex] : '' })
  const frequencyText = value('frequency')
  // bc125py writes empty channels as 000.0000.
  if (frequencyText !== null && !/^[0.]+$/.test(frequencyText)) {
    const frequency = parseFrequency(frequencyText)
    if (frequency === null) return `Frequency ${JSON.stringify(frequencyText)} isn't a number`
    channel.frequency = frequency
  }
  const modulationText = value('modulation')
  if (modulationText !== null) {
    const normalized = modulationText.toUpperCase() === 'FMN' ? 'NFM' : modulationText.toUpperCase()
    if (!isModulation(normalized)) return `Modulation ${JSON.stringify(modulationText)} isn't AUTO, AM, FM, or NFM`
    channel.modulation = normalized
  }
  const toneText = value('tone')
  if (toneText !== null) {
    // Human-readable first ("100" is 100.0 Hz), then bc125py's older raw codes.
    const tone = parseTone(toneText) ?? (/^[0-9]+$/.test(toneText) ? toneFromCode(Number(toneText)) : null)
    if (tone === null) return `Tone ${JSON.stringify(toneText)} isn't a CTCSS tone or DCS code`
    channel.tone = tone
  }
  const delayText = value('delay')
  if (delayText !== null) {
    const cleaned = delayText.replaceAll('−', '-').replaceAll(' s', '')
    const delay = /^[+-]?[0-9]+$/.test(cleaned) ? delayFromNumber(Number(cleaned)) : null
    if (delay === null) return `Delay ${JSON.stringify(delayText)} isn't one of −10, −5, 0, 1, 2, 3, 4, 5`
    channel.delay = delay
  }
  const lockoutText = value('lockout')
  if (lockoutText !== null) {
    const locked = flag(lockoutText, ['locked', 'lockedout', 'lockout'], ['unlocked'])
    if (locked === null) return `Lockout ${JSON.stringify(lockoutText)} isn't yes or no`
    channel.lockedOut = locked
  }
  const priorityText = value('priority')
  if (priorityText !== null) {
    const priority = flag(priorityText, [], [])
    if (priority === null) return `Priority ${JSON.stringify(priorityText)} isn't yes or no`
    channel.priority = priority
  }
  return isEmptyChannel(channel) ? emptyChannel() : channel
}

// MARK: RFC 4180

export function quote(field: string): string {
  if (!/[,"\n\r]/.test(field) && !field.startsWith(' ') && !field.endsWith(' ')) return field
  return `"${field.replaceAll('"', '""')}"`
}

export function parseDelimited(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const chars = [...text]
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    if (inQuotes) {
      if (c === '"') {
        if (chars[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
      continue
    }
    if (c === '"' && field === '') inQuotes = true
    else if (c === delimiter) {
      row.push(field)
      field = ''
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && chars[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  // Drop a byte-order mark on the first header cell.
  if (rows.length > 0 && rows[0].length > 0 && rows[0][0].startsWith('﻿')) rows[0][0] = rows[0][0].slice(1)
  return rows
}
