import { emptyChannel, isEmptyChannel, type Channel } from '../model/channel'
import { mhz, parseFrequency } from '../model/frequency'
import { toneName } from '../model/tone'
import { channelFromRow, columnsFromHeader, parseDelimited, type Column } from './csv'

/**
 * Channels on the clipboard as tab-separated text (SPEC.md §8.2), which Numbers, Excel and Google
 * Sheets paste as cells and copy back the same way.
 */
export const CLIPBOARD_HEADER = ['Name', 'Frequency', 'Modulation', 'Tone', 'Delay', 'Lockout', 'Priority']

const clean = (field: string) => field.replaceAll('\t', ' ').replaceAll('\n', ' ')

/** A header row, then one row per channel. Empty channels become blank rows so their slots survive a round trip. */
export function clipboardText(channels: Channel[]): string {
  const rows = [
    CLIPBOARD_HEADER,
    ...channels.map((channel) =>
      channel.frequency === null
        ? Array<string>(CLIPBOARD_HEADER.length).fill('')
        : [channel.name, mhz(channel.frequency), channel.modulation, toneName(channel.tone), `${channel.delay}`, channel.lockedOut ? 'Yes' : 'No', channel.priority ? 'Yes' : 'No'],
    ),
  ]
  return `${rows.map((row) => row.map(clean).join('\t')).join('\n')}\n`
}

/**
 * Channels from pasted text, or `null` if any row can't be understood.
 *
 * With a header row, columns are matched by name, as for CSV import. Without one, rows are read
 * in `CLIPBOARD_HEADER` order, except that a single column of frequencies is read as frequencies.
 */
export function channelsFromClipboard(text: string): Channel[] | null {
  let rows = parseDelimited(text, '\t')
  if (rows.length === 0) return null
  let columns = columnsFromHeader(rows[0])
  if (columns.has('frequency')) {
    rows = rows.slice(1)
  } else if (rows.every((row) => row.length === 1) && rows.every((row) => row[0] === '' || parseFrequency(row[0]) !== null)) {
    columns = new Map([['frequency', 0]])
  } else {
    const order: Column[] = ['name', 'frequency', 'modulation', 'tone', 'delay', 'lockout', 'priority']
    columns = new Map(order.map((column, i) => [column, i]))
  }
  const channels: Channel[] = []
  for (const row of rows) {
    if (row.every((field) => field.trim() === '')) {
      channels.push(emptyChannel())
      continue
    }
    const channel = channelFromRow(row, columns)
    if (typeof channel === 'string') return null
    // A pasted row without a lockout column is a new, active channel.
    if (!columns.has('lockout') && !isEmptyChannel(channel)) channel.lockedOut = false
    channels.push(channel)
  }
  return channels.length === 0 ? null : channels
}
