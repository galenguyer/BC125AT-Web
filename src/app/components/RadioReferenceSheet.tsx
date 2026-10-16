import { useMemo, useState } from 'react'
import { create } from 'zustand'
import { bankOfChannel, modulationName, type Channel } from '../../kit/model/channel'
import { CHANNEL_COUNT, type ScannerConfig } from '../../kit/model/config'
import { mhz, type Frequency } from '../../kit/model/frequency'
import { toneName } from '../../kit/model/tone'
import { crossesBanks, emptyRun, firstEmptyRun, type RadioReferenceEntry } from '../../kit/formats/radioReference'
import { useDocument } from '../store/document'
import { CheckCircleIcon, ErrorIcon, WarningIcon } from './Icons'
import { Modal } from './Sheets'

/** A RadioReference export waiting to be imported. */
export interface RadioReferenceFile {
  name: string
  entries: RadioReferenceEntry[]
  /** Called with the selected channels in file order, and the channel to start at. */
  onImport(channels: Channel[], start: number): void
}

export const useRadioReference = create<{ file: RadioReferenceFile | null }>(() => ({ file: null }))
const close = () => useRadioReference.setState({ file: null })

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

export function RadioReferenceSheetHost() {
  const file = useRadioReference((s) => s.file)
  // The document doesn't change while the sheet is open, so read it once.
  return file ? <RadioReferenceSheet file={file} config={useDocument.getState().config} /> : null
}

/**
 * Choose which frequencies from a RadioReference export to import, and the empty channels to put
 * them in (SPEC.md §5.2). Only rows the scanner can receive are offered, all selected to start.
 */
function RadioReferenceSheet({ file, config }: { file: RadioReferenceFile; config: ScannerConfig }) {
  const usable = useMemo(() => file.entries.filter((e) => e.channel !== null), [file])
  const skipped = useMemo(() => file.entries.filter((e) => e.channel === null), [file])
  /** Channel numbers already holding each frequency, to point out duplicates. */
  const existing = useMemo(() => {
    const map = new Map<Frequency, number[]>()
    config.channels.forEach((channel, offset) => {
      if (channel.frequency !== null) map.set(channel.frequency, [...(map.get(channel.frequency) ?? []), offset + 1])
    })
    return map
  }, [config])

  const [selected, setSelected] = useState(() => new Set(usable.map((e) => e.line)))
  const [start, setStart] = useState(() => firstEmptyRun(config, usable.length) ?? firstEmptyRun(config, 1) ?? 1)
  const [startText, setStartText] = useState(String(start))
  const [filter, setFilter] = useState('')

  const query = filter.trim().toLowerCase()
  const visible = query
    ? usable.filter((e) => [e.frequencyText, e.alphaTag, e.description, e.category, e.tag, e.mode].some((text) => text.toLowerCase().includes(query)))
    : usable
  const chosen = usable.filter((e) => selected.has(e.line)).map((e) => e.channel!)
  const count = chosen.length
  const run = emptyRun(config, start)
  const fits = count > 0 && run >= count
  const found = firstEmptyRun(config, count)

  const moveStart = (value: number) => {
    const clamped = Math.min(Math.max(Math.trunc(value) || 1, 1), CHANNEL_COUNT)
    setStart(clamped)
    setStartText(String(clamped))
  }
  const toggle = (line: number, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      if (on) next.add(line)
      else next.delete(line)
      return next
    })
  const setVisible = (on: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      for (const entry of visible) {
        if (on) next.add(entry.line)
        else next.delete(entry.line)
      }
      return next
    })
  const bankTitle = (bank: number) => (config.bankNames[bank - 1] ? `Bank ${bank} (${config.bankNames[bank - 1]})` : `Bank ${bank}`)
  const notes = (entry: RadioReferenceEntry) => {
    const list: string[] = []
    if (entry.note) list.push(entry.note)
    const numbers = entry.channel?.frequency != null ? existing.get(entry.channel.frequency) : undefined
    if (numbers) list.push(`Already on channel ${numbers.join(', ')}`)
    return list.join('\n')
  }
  const confirmImport = () => {
    if (!fits) return
    file.onImport(chosen, start)
    close()
  }

  let status: React.ReactNode
  if (count === 0) {
    status = <p className="note">Select at least one frequency to import.</p>
  } else if (fits) {
    const end = start + count - 1
    status = (
      <>
        <p className="rr-status success">
          <CheckCircleIcon /> {count === 1 ? `Channel ${start} is empty.` : `Channels ${start}–${end} are empty.`}
        </p>
        {crossesBanks(start, count) && (
          <p className="rr-status warning">
            <WarningIcon /> These channels run from {bankTitle(bankOfChannel(start))} into {bankTitle(bankOfChannel(end))}.
          </p>
        )}
      </>
    )
  } else {
    const limit = start + run > CHANNEL_COUNT ? 'the last channel is 500' : `channel ${start + run} is in use`
    status = (
      <p className="rr-status error">
        <ErrorIcon />{' '}
        {run === 0
          ? `Channel ${start} is in use. Choose an empty channel to start at.`
          : `Only ${plural(run, 'empty channel', 'empty channels')} from ${start} (${limit}), but ${count} are selected. Choose another start or select fewer.`}
      </p>
    )
  }

  return (
    <Modal wide label="Import from RadioReference" onEscape={close}>
      <div className="rr-sheet">
        <div>
          <h2>Import from RadioReference</h2>
          <p className="note">
            {file.name}: {usable.length} of {file.entries.length} frequencies can be used on the BC125AT.
          </p>
        </div>
        <div className="rr-toolbar">
          <input
            type="search"
            className="text-input"
            placeholder="Filter by name, description, tag or frequency"
            aria-label="Filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
          />
          <button type="button" className="button" onClick={() => setVisible(true)}>
            Select All
          </button>
          <button type="button" className="button" onClick={() => setVisible(false)}>
            Select None
          </button>
        </div>
        <div className="rr-table" tabIndex={0} aria-label="Frequencies">
          <table>
            <thead>
              <tr>
                <th aria-label="Import" />
                <th>Frequency</th>
                <th>Name</th>
                <th>Mod</th>
                <th>Tone</th>
                <th>Tag</th>
                <th>Description</th>
                <th aria-label="Notes" />
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => {
                const channel = entry.channel!
                const note = notes(entry)
                const id = `rr-${entry.line}`
                return (
                  <tr key={entry.line} className={selected.has(entry.line) ? undefined : 'off'}>
                    <td>
                      <input id={id} type="checkbox" className="checkbox" checked={selected.has(entry.line)} onChange={(e) => toggle(entry.line, e.target.checked)} />
                    </td>
                    <td className="num">
                      <label htmlFor={id}>{mhz(channel.frequency!)}</label>
                    </td>
                    <td>{channel.name}</td>
                    <td title={`RadioReference mode: ${entry.mode}`}>{modulationName(channel.modulation)}</td>
                    <td>{toneName(channel.tone)}</td>
                    <td>{entry.tag}</td>
                    <td className="secondary" title={entry.description}>
                      {[entry.category, entry.description].filter(Boolean).join(' · ')}
                    </td>
                    <td>
                      {note && (
                        <span className="rr-note" title={note} aria-label={note}>
                          <WarningIcon />
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={8} className="secondary" style={{ textAlign: 'center', padding: 16 }}>
                    No frequencies match “{filter}”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {skipped.length > 0 && (
          <details className="rr-skipped">
            <summary>{plural(skipped.length, 'frequency', 'frequencies')} can’t be used</summary>
            <ul>
              {skipped.map((entry) => (
                <li key={entry.line}>
                  <span className="num">{entry.frequencyText}</span>
                  <span>{entry.alphaTag || entry.description}</span>
                  <span className="secondary">{entry.skipReason}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="rr-placement">
          <label htmlFor="rr-start">Start at channel</label>
          <input
            id="rr-start"
            type="number"
            className="text-input num"
            min={1}
            max={CHANNEL_COUNT}
            value={startText}
            onChange={(e) => {
              setStartText(e.target.value)
              const value = Number(e.target.value)
              if (Number.isInteger(value) && value >= 1 && value <= CHANNEL_COUNT) setStart(value)
            }}
            onBlur={() => moveStart(Number(startText))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                moveStart(Number(startText))
              }
            }}
          />
          <span className="secondary">{bankTitle(bankOfChannel(start))}</span>
          <span className="spacer" />
          <button
            type="button"
            className="button"
            disabled={count === 0 || found === null}
            title={`Move the start to the first place with ${count} empty channels in a row, keeping them in one bank if possible`}
            onClick={() => found !== null && moveStart(found)}
          >
            Find Empty Channels
          </button>
        </div>
        <div aria-live="polite">{status}</div>
        <div className="sheet-buttons">
          <button type="button" className="button" onClick={close}>
            Cancel
          </button>
          <button type="button" className="button primary" data-primary="true" disabled={!fits} onClick={confirmImport}>
            Import {plural(count, 'Channel', 'Channels')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
