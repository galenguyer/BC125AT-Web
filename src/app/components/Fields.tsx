import { useEffect, useId, useRef, useState } from 'react'
import { mhz, parseFrequency, type Frequency } from '../../kit/model/frequency'
import { ctcssTenthsHz, ctcssTone, dcsCodes, dcsTone, TONE_NO_TONE, TONE_NONE, TONE_SEARCH, toneName, type ToneCode } from '../../kit/model/tone'
import type { MenuEntry } from './Menu'

/**
 * A text field that edits a local copy and commits it on Return or when focus leaves, so a change
 * is one undo step rather than one per keystroke. `commit` returns false to reject the text, which
 * shakes the field and restores the current value. Escape puts the value back.
 */
export function CommitField({
  value,
  commit,
  placeholder,
  label,
  className = '',
  ...rest
}: {
  value: string
  commit: (text: string) => boolean
  placeholder?: string
  label: string
  className?: string
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(value)
  const [invalid, setInvalid] = useState(false)
  const skipBlur = useRef(false)
  // Show the committed value as stored ("151.82" becomes "151.8200"), and pick up outside changes such as undo.
  useEffect(() => setText(value), [value])

  const apply = () => {
    if (text === value) return
    if (!commit(text)) {
      setInvalid(true)
      setTimeout(() => setInvalid(false), 400)
      setText(value)
    }
  }

  return (
    <input
      {...rest}
      className={`text-input ${invalid ? 'invalid' : ''} ${className}`}
      value={text}
      placeholder={placeholder}
      aria-label={label}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        if (skipBlur.current) skipBlur.current = false
        else apply()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          apply()
        } else if (event.key === 'Escape') {
          setText(value)
          skipBlur.current = true
          event.currentTarget.blur()
          event.stopPropagation()
        }
      }}
    />
  )
}

/** Edits a frequency in MHz. Clearing the field is allowed only when `allowsEmpty`. */
export function FrequencyField({
  frequency,
  set,
  allowsEmpty = false,
  label,
  placeholder = 'MHz',
  ...rest
}: {
  frequency: Frequency | null
  set: (frequency: Frequency | null) => void
  allowsEmpty?: boolean
  label: string
  placeholder?: string
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <CommitField
      {...rest}
      label={label}
      placeholder={placeholder}
      className="num"
      inputMode="decimal"
      value={frequency === null ? '' : mhz(frequency)}
      commit={(text) => {
        const trimmed = text.trim()
        if (trimmed === '') {
          if (!allowsEmpty) return false
          set(null)
          return true
        }
        const parsed = parseFrequency(trimmed)
        if (parsed === null) return false
        set(parsed)
        return true
      }}
    />
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <span className="switch">
      <input type="checkbox" role="switch" checked={checked} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </span>
  )
}

/** A labelled form row with a switch at its trailing edge. */
export function SwitchRow({ label, detail, checked, onChange }: { label: string; detail?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const id = useId()
  return (
    <div className="form-row">
      <label htmlFor={id}>
        {label}
        {detail && <span className="detail-text">{detail}</span>}
      </label>
      <span className="switch">
        <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span />
      </span>
    </div>
  )
}

export function SelectRow<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  const id = useId()
  return (
    <div className="form-row">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="select"
        value={String(value)}
        onChange={(e) => {
          const option = options.find((o) => String(o.value) === e.target.value)
          if (option) onChange(option.value)
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (value: number) => void; label: string }) {
  return (
    <span className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        −
      </button>
      <output className="num" aria-live="polite">
        {value}
      </output>
      <button type="button" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        +
      </button>
    </span>
  )
}

export function StepperRow({ label, detail, ...stepper }: { label: string; detail?: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <div className="form-row">
      <span className="label">
        {label}
        {detail && <span className="detail-text">{detail}</span>}
      </span>
      <Stepper label={label} {...stepper} />
    </div>
  )
}

/** CSQ / Search / No Tone, then CTCSS and DCS submenus. */
export function toneMenu(current: ToneCode | null, select: (tone: ToneCode) => void): MenuEntry[] {
  const item = (tone: ToneCode): MenuEntry => ({ label: toneName(tone), checked: current === tone, onSelect: () => select(tone) })
  return [
    item(TONE_NONE),
    item(TONE_SEARCH),
    item(TONE_NO_TONE),
    { kind: 'separator' },
    { label: 'CTCSS', submenu: ctcssTenthsHz.map((_, i) => item(ctcssTone(i))) },
    { label: 'DCS', submenu: dcsCodes.map((_, i) => item(dcsTone(i))) },
  ]
}
