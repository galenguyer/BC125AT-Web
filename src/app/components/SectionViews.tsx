import { useState } from 'react'
import type { Draft } from 'immer'
import { BANK_COUNT, MAX_GLOBAL_LOCKOUTS, type ScannerConfig } from '../../kit/model/config'
import { delayName, delays, type Delay } from '../../kit/model/channel'
import { mhz, sortedUnique, type Frequency } from '../../kit/model/frequency'
import {
  backlightName,
  backlights,
  bandPlanName,
  bandPlanRegions,
  BATTERY_CHARGE_RANGE,
  closeCallBands,
  closeCallModeName,
  closeCallModes,
  CONTRAST_RANGE,
  keyBeepName,
  keyBeeps,
  LEVEL_RANGE,
  priorityModeName,
  priorityModes,
  serviceSearchGroupNames,
} from '../../kit/model/settings'
import type { ValidationIssue } from '../../kit/model/validation'
import { useIssues } from '../hooks'
import { useDocument } from '../store/document'
import { CommitField, FrequencyField, SelectRow, StepperRow, Switch, SwitchRow } from './Fields'
import { ErrorIcon, MinusIcon, NoSignIcon, WarningIcon } from './Icons'

// Editors for everything except channels (SPEC.md §8.3–8.5). Each control writes straight into the
// document, so every change is one undo step.

const edit = (recipe: (config: Draft<ScannerConfig>) => void) => useDocument.getState().edit(recipe)

function IssuesSection({ issues }: { issues: ValidationIssue[] }) {
  if (issues.length === 0) return null
  return (
    <section className="form-section">
      <div className="form-group">
        {issues.map((issue, i) => (
          <div key={i} className="form-row issue-line">
            <span className={issue.severity === 'error' ? 'issue-badge error' : 'issue-badge'}>{issue.severity === 'error' ? <ErrorIcon title="Error" /> : <WarningIcon title="Warning" />}</span>
            <span>{issue.message}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function Section({ title, footer, children }: { title?: string; footer?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="form-section">
      {title && <h2>{title}</h2>}
      <div className="form-group">{children}</div>
      {footer && <p className="form-footer">{footer}</p>}
    </section>
  )
}

function View({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="detail">
      <div className="view-header">
        <h1>{title}</h1>
      </div>
      <div className="form-scroll">
        <div className="form">{children}</div>
      </div>
    </div>
  )
}

export function SettingsView() {
  const config = useDocument((s) => s.config)
  const issues = useIssues().filter((i) => i.location.kind === 'settings' || i.location.kind === 'bank')
  const s = config.settings
  const squelchNote = s.squelch === 0 ? '(open)' : s.squelch === 15 ? '(closed)' : undefined
  return (
    <View title="Settings">
      <IssuesSection issues={issues} />
      <Section title="Display & Keypad">
        <SelectRow label="Backlight" value={s.backlight} options={backlights.map((b) => ({ value: b, label: backlightName[b] }))} onChange={(v) => edit((c) => void (c.settings.backlight = v))} />
        <StepperRow label="Contrast" value={s.contrast} min={CONTRAST_RANGE[0]} max={CONTRAST_RANGE[1]} onChange={(v) => edit((c) => void (c.settings.contrast = v))} />
        <SelectRow label="Key Beep" value={s.keyBeep} options={keyBeeps.map((b) => ({ value: b, label: keyBeepName(b) }))} onChange={(v) => edit((c) => void (c.settings.keyBeep = v))} />
        <SwitchRow label="Key Lock" checked={s.keyLock} onChange={(v) => edit((c) => void (c.settings.keyLock = v))} />
      </Section>
      <Section
        title="Audio"
        footer="Saved with the document, but never written to the scanner, so a write keeps whatever levels it’s set to. Change them on the scanner or with the live bar’s sliders."
      >
        <StepperRow label="Volume" value={s.volume} min={LEVEL_RANGE[0]} max={LEVEL_RANGE[1]} onChange={(v) => edit((c) => void (c.settings.volume = v))} />
        <StepperRow label="Squelch" detail={squelchNote} value={s.squelch} min={LEVEL_RANGE[0]} max={LEVEL_RANGE[1]} onChange={(v) => edit((c) => void (c.settings.squelch = v))} />
      </Section>
      <Section title="Scanning" footer="The band plan sets the channel steps the scanner rounds frequencies to. Canada uses 5 kHz steps in 137–174 MHz.">
        <SelectRow label="Priority Mode" value={s.priorityMode} options={priorityModes.map((m) => ({ value: m, label: priorityModeName[m] }))} onChange={(v) => edit((c) => void (c.settings.priorityMode = v))} />
        <SwitchRow label="Weather Alert Priority" checked={s.weatherAlertPriority} onChange={(v) => edit((c) => void (c.settings.weatherAlertPriority = v))} />
        <SelectRow label="Band Plan" value={s.bandPlan} options={bandPlanRegions.map((r) => ({ value: r, label: bandPlanName(r) }))} onChange={(v) => edit((c) => void (c.settings.bandPlan = v))} />
      </Section>
      <Section title="Battery" footer="For NiMH cells: 1500 mAh → 9 h, 1800 → 11, 2000 → 12, 2100–2200 → 13, 2300 → 14, 2500 → 15, 2700 → 16.">
        <StepperRow
          label="Charge Time"
          detail="hours"
          value={s.batteryChargeHours}
          min={BATTERY_CHARGE_RANGE[0]}
          max={BATTERY_CHARGE_RANGE[1]}
          onChange={(v) => edit((c) => void (c.settings.batteryChargeHours = v))}
        />
      </Section>
      <Section title="Banks" footer="Bank names are kept in this file; the scanner has no place to store them.">
        {Array.from({ length: BANK_COUNT }, (_, i) => (
          <div key={i} className="form-row">
            <span style={{ width: 56, flex: 'none' }}>Bank {i + 1}</span>
            <CommitField
              label={`Bank ${i + 1} name (saved in this file only)`}
              placeholder="Name (saved in this file only)"
              style={{ flex: 1 }}
              value={config.bankNames[i]}
              commit={(text) => {
                edit((c) => void (c.bankNames[i] = text))
                return true
              }}
            />
            <span className="secondary" style={{ fontSize: 12 }}>
              Scan
            </span>
            <Switch label={`Scan bank ${i + 1}`} checked={config.bankScanEnabled[i]} onChange={(v) => edit((c) => void (c.bankScanEnabled[i] = v))} />
          </div>
        ))}
      </Section>
      <Section title="Notes" footer="Kept in this file only.">
        <div className="form-row">
          <NotesField />
        </div>
      </Section>
      {config.metadata.readAt && (
        <Section title="Source">
          <div className="form-row">
            <span className="label">Read From</span>
            <span className="value">{[config.metadata.model, config.metadata.firmware].filter(Boolean).join(', ')}</span>
          </div>
          <div className="form-row">
            <span className="label">Read At</span>
            <span className="value">{new Date(config.metadata.readAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
          </div>
        </Section>
      )}
    </View>
  )
}

function NotesField() {
  const notes = useDocument((s) => s.config.metadata.notes)
  const [text, setText] = useState(notes)
  const [last, setLast] = useState(notes)
  if (notes !== last) {
    setLast(notes)
    setText(notes)
  }
  return (
    <textarea
      className="text-input"
      aria-label="Notes"
      rows={3}
      style={{ width: '100%', height: 'auto', padding: 6, resize: 'vertical' }}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== notes && edit((c) => void (c.metadata.notes = text))}
    />
  )
}

export function SearchView() {
  const search = useDocument((s) => s.config.search)
  const closeCall = useDocument((s) => s.config.closeCall)
  const issues = useIssues().filter((i) => i.location.kind === 'search' || i.location.kind === 'closeCall')
  return (
    <View title="Search & Close Call">
      <IssuesSection issues={issues} />
      <Section title="Search">
        <SelectRow<Delay> label="Delay" value={search.delay} options={delays.map((d) => ({ value: d, label: delayName(d) }))} onChange={(v) => edit((c) => void (c.search.delay = v))} />
        <SwitchRow label="CTCSS/DCS Code Search" checked={search.codeSearch} onChange={(v) => edit((c) => void (c.search.codeSearch = v))} />
      </Section>
      <Section title="Service Search Groups">
        {serviceSearchGroupNames.map((name, i) => (
          <SwitchRow key={name} label={name} checked={search.serviceGroupsEnabled[i]} onChange={(v) => edit((c) => void (c.search.serviceGroupsEnabled[i] = v))} />
        ))}
      </Section>
      <Section title="Custom Search Ranges">
        {search.customRanges.map((range, i) => (
          <div key={i} className="form-row range-row">
            <span className="label">Range {i + 1}</span>
            <FrequencyField label={`Range ${i + 1} lower frequency in megahertz`} frequency={range.lower} set={(f) => f !== null && edit((c) => void (c.search.customRanges[i].lower = f))} />
            <span className="secondary">–</span>
            <FrequencyField label={`Range ${i + 1} upper frequency in megahertz`} frequency={range.upper} set={(f) => f !== null && edit((c) => void (c.search.customRanges[i].upper = f))} />
            <span className="secondary" style={{ marginRight: 8 }}>
              MHz
            </span>
            <Switch label={`Search range ${i + 1}`} checked={range.enabled} onChange={(v) => edit((c) => void (c.search.customRanges[i].enabled = v))} />
          </div>
        ))}
      </Section>
      <Section title="Close Call">
        <SelectRow label="Mode" value={closeCall.mode} options={closeCallModes.map((m) => ({ value: m, label: closeCallModeName[m] }))} onChange={(v) => edit((c) => void (c.closeCall.mode = v))} />
        <SwitchRow label="Alert Beep" checked={closeCall.alertBeep} onChange={(v) => edit((c) => void (c.closeCall.alertBeep = v))} />
        <SwitchRow label="Alert Light" checked={closeCall.alertLight} onChange={(v) => edit((c) => void (c.closeCall.alertLight = v))} />
        <SwitchRow label="Scan Close Call Hits Bank" checked={closeCall.scanHits} onChange={(v) => edit((c) => void (c.closeCall.scanHits = v))} />
        {closeCallBands.map((band, i) => (
          <SwitchRow key={band.name} label={band.name} detail={band.range} checked={closeCall.bandsEnabled[i]} onChange={(v) => edit((c) => void (c.closeCall.bandsEnabled[i] = v))} />
        ))}
      </Section>
    </View>
  )
}

export function LockoutsView() {
  const lockouts = useDocument((s) => s.config.globalLockouts)
  const issues = useIssues().filter((i) => i.location.kind === 'globalLockouts')
  const [selection, setSelection] = useState<Set<Frequency>>(new Set())
  const [fieldKey, setFieldKey] = useState(0)
  const full = lockouts.length >= MAX_GLOBAL_LOCKOUTS
  const remove = () => {
    if (selection.size === 0) return
    edit((c) => void (c.globalLockouts = c.globalLockouts.filter((f) => !selection.has(f))))
    setSelection(new Set())
  }
  return (
    <div className="detail">
      <div className="view-header">
        <h1>Global Lockouts</h1>
      </div>
      <div className="form-scroll">
        <div className="form">
          <IssuesSection issues={issues} />
          <section className="form-section">
            <div className="form-group">
              <div className="form-row">
                <FrequencyField
                  key={fieldKey}
                  label="Add a lockout frequency in megahertz"
                  placeholder="Add frequency (MHz)"
                  disabled={full}
                  style={{ width: 200 }}
                  frequency={null}
                  set={(f) => {
                    if (f === null) return
                    edit((c) => void (c.globalLockouts = sortedUnique([...c.globalLockouts, f])))
                    setFieldKey((k) => k + 1)
                    setTimeout(() => document.querySelector<HTMLInputElement>('[aria-label="Add a lockout frequency in megahertz"]')?.focus(), 0)
                  }}
                />
                <span className="label" />
                <button type="button" className="button" disabled={selection.size === 0} onClick={remove}>
                  <MinusIcon size={13} />
                  Remove
                </button>
              </div>
            </div>
            <p className="form-footer">
              {lockouts.length} of {MAX_GLOBAL_LOCKOUTS}. Frequencies skipped during search and Close Call.
            </p>
          </section>
          {lockouts.length === 0 ? (
            <div className="empty-state" style={{ position: 'static', minHeight: 200 }}>
              <NoSignIcon size={28} />
              <h2>No Global Lockouts</h2>
              <p>Frequencies skipped during search and Close Call appear here.</p>
            </div>
          ) : (
            <section className="form-section">
              <div
                className="form-group lockout-list"
                role="listbox"
                aria-label="Global lockouts"
                aria-multiselectable
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Delete' || e.key === 'Backspace') {
                    e.preventDefault()
                    remove()
                  }
                }}
              >
                {lockouts.map((f) => (
                  <div
                    key={f}
                    role="option"
                    aria-selected={selection.has(f)}
                    className={`lockout-row${selection.has(f) ? ' selected' : ''}`}
                    onClick={(e) => {
                      const next = new Set(e.metaKey || e.ctrlKey || e.shiftKey ? selection : [])
                      if (selection.has(f) && (e.metaKey || e.ctrlKey)) next.delete(f)
                      else next.add(f)
                      setSelection(next)
                    }}
                  >
                    <span className="num">{mhz(f)} MHz</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
