import { useId } from 'react'
import { bankOfChannel, delayName, delays, isEmptyChannel, MAX_NAME_LENGTH, modulationName, modulations, nameLength, type Channel, type Delay, type Modulation } from '../../kit/model/channel'
import { channelAt, channelPlan } from '../../kit/model/config'
import { storedValue } from '../../kit/model/bandPlan'
import { mhz } from '../../kit/model/frequency'
import { editChannels, setChannelFrequency } from '../../kit/model/moves'
import { toneName } from '../../kit/model/tone'
import { useIssues } from '../hooks'
import { useDocument } from '../store/document'
import { CommitField, FrequencyField, SelectRow, SwitchRow, toneMenu } from './Fields'
import { ChevronIcon, ErrorIcon, WarningIcon } from './Icons'
import { openMenuBelow } from './Menu'

const edit = (numbers: number[], change: (c: Channel) => Channel) => useDocument.getState().edit((config) => editChannels(config, numbers, change))

/** Details for the selected channel or channels (SPEC.md §8.1). */
export function Inspector({ selection }: { selection: number[] }) {
  if (selection.length === 0) {
    return (
      <div className="empty-state" style={{ position: 'static', minHeight: 200 }}>
        <h2>No Selection</h2>
        <p>Select a channel to see and edit its details.</p>
      </div>
    )
  }
  if (selection.length === 1) return <Single number={selection[0]} />
  return <Several numbers={[...selection].sort((a, b) => a - b)} />
}

function ToneRow({ label, value, onSelect }: { label: string; value: string; onSelect: (element: HTMLElement) => void }) {
  return (
    <div className="form-row">
      <span className="label">{label}</span>
      <button type="button" className="button" aria-haspopup="menu" aria-label={`${label}: ${value}`} onClick={(e) => onSelect(e.currentTarget)}>
        {value}
        <ChevronIcon />
      </button>
    </div>
  )
}

function Single({ number }: { number: number }) {
  const channel = useDocument((s) => channelAt(s.config, number))
  const plan = useDocument((s) => channelPlan(s.config))
  const bankName = useDocument((s) => s.config.bankNames[bankOfChannel(number) - 1])
  const issues = useIssues().filter((i) => i.location.kind === 'channel' && i.location.number === number)
  const nameID = useId()
  const frequencyID = useId()
  const bank = bankOfChannel(number)
  const stored = channel.frequency === null ? null : storedValue(plan, channel.frequency)
  const empty = isEmptyChannel(channel)

  return (
    <div className="form">
      <section className="form-section">
        <h2>
          Channel {number} · Bank {bank}
          {bankName ? ` (${bankName})` : ''}
        </h2>
        <div className="form-group">
          <div className="form-row">
            <label htmlFor={frequencyID}>Frequency (MHz)</label>
            <FrequencyField
              id={frequencyID}
              label="Frequency in megahertz"
              allowsEmpty
              style={{ width: 110 }}
              frequency={channel.frequency}
              set={(frequency) => useDocument.getState().edit((config) => setChannelFrequency(config, number, frequency))}
            />
          </div>
          {channel.frequency !== null && stored !== null && stored !== channel.frequency && (
            <div className="form-row warn">
              <span className="label">Stored As</span>
              <span className="value num">{mhz(stored)} MHz</span>
            </div>
          )}
          <div className="form-row">
            <label htmlFor={nameID}>Name</label>
            <CommitField
              id={nameID}
              label="Name"
              style={{ width: 140 }}
              value={channel.name}
              commit={(text) => {
                edit([number], (c) => ({ ...c, name: text }))
                return true
              }}
            />
          </div>
          <div className="form-row">
            <span className="label">Characters</span>
            <span className="value" style={nameLength(channel.name) > MAX_NAME_LENGTH ? { color: 'var(--red)' } : undefined}>
              {nameLength(channel.name)} of {MAX_NAME_LENGTH}
            </span>
          </div>
        </div>
        {empty && (
          <p className="form-footer">
            {channel.name === '' ? 'This channel is empty. Type a name or frequency to start one.' : "Add a frequency to use this channel. Until then it isn't written to the scanner."}
          </p>
        )}
      </section>
      {!empty && (
        <>
          <section className="form-section">
            <h2>Reception</h2>
            <div className="form-group">
              <SelectRow<Modulation>
                label="Modulation"
                value={channel.modulation}
                options={modulations.map((m) => ({ value: m, label: modulationName(m) }))}
                onChange={(modulation) => edit([number], (c) => ({ ...c, modulation }))}
              />
              <ToneRow label="Tone" value={toneName(channel.tone)} onSelect={(el) => openMenuBelow(el, toneMenu(channel.tone, (tone) => edit([number], (c) => ({ ...c, tone }))))} />
              <SelectRow<Delay> label="Delay" value={channel.delay} options={delays.map((d) => ({ value: d, label: delayName(d) }))} onChange={(delay) => edit([number], (c) => ({ ...c, delay }))} />
            </div>
          </section>
          <section className="form-section">
            <h2>Scanning</h2>
            <div className="form-group">
              <SwitchRow label="Locked Out" checked={channel.lockedOut} onChange={(lockedOut) => edit([number], (c) => ({ ...c, lockedOut }))} />
              <SwitchRow label="Priority" checked={channel.priority} onChange={(priority) => edit([number], (c) => ({ ...c, priority }))} />
            </div>
            <p className="form-footer">Each bank has one priority channel; turning this on turns off the bank’s other one.</p>
          </section>
        </>
      )}
      {issues.length > 0 && (
        <section className="form-section">
          <h2>Issues</h2>
          <div className="form-group">
            {issues.map((issue, i) => (
              <div key={i} className="form-row issue-line">
                <span className={issue.severity === 'error' ? 'issue-badge error' : 'issue-badge'}>{issue.severity === 'error' ? <ErrorIcon title="Error" /> : <WarningIcon title="Warning" />}</span>
                <span>{issue.message}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function Several({ numbers }: { numbers: number[] }) {
  const channels = useDocument((s) => s.config.channels)
  const used = numbers.filter((n) => !isEmptyChannel(channels[n - 1]))
  const common = <T,>(value: (c: Channel) => T): T | null => {
    const values = used.map((n) => value(channels[n - 1]))
    return values.every((v) => v === values[0]) ? values[0] : null
  }
  const mod = common((c) => c.modulation)
  const tone = common((c) => c.tone)
  const dly = common((c) => c.delay)
  return (
    <div className="form">
      <section className="form-section">
        <h2>{numbers.length} Channels Selected</h2>
        <div className="form-group">
          <div className="form-row">
            <span className="label">In Use</span>
            <span className="value">{used.length}</span>
          </div>
          <div className="form-row">
            <span className="label">Locked Out</span>
            <span className="value">{used.filter((n) => channels[n - 1].lockedOut).length}</span>
          </div>
        </div>
      </section>
      {used.length > 0 && (
        <section className="form-section">
          <h2>Change All</h2>
          <div className="form-group">
            <ToneRow
              label="Modulation"
              value={mod === null ? 'Mixed' : modulationName(mod)}
              onSelect={(el) => openMenuBelow(el, modulations.map((m) => ({ label: modulationName(m), checked: mod === m, onSelect: () => edit(used, (c) => ({ ...c, modulation: m })) })))}
            />
            <ToneRow label="Tone" value={tone === null ? 'Mixed' : toneName(tone)} onSelect={(el) => openMenuBelow(el, toneMenu(tone, (t) => edit(used, (c) => ({ ...c, tone: t }))))} />
            <ToneRow
              label="Delay"
              value={dly === null ? 'Mixed' : delayName(dly)}
              onSelect={(el) => openMenuBelow(el, delays.map((d) => ({ label: delayName(d), checked: dly === d, onSelect: () => edit(used, (c) => ({ ...c, delay: d })) })))}
            />
            <div className="form-row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="button" onClick={() => edit(used, (c) => ({ ...c, lockedOut: true }))}>
                Lock Out All
              </button>
              <button type="button" className="button" onClick={() => edit(used, (c) => ({ ...c, lockedOut: false }))}>
                Unlock All
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
