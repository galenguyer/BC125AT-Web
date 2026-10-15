import { useEffect, useState } from 'react'
import { mhz } from '../../kit/model/frequency'
import type { LiveStatus } from '../../kit/model/liveStatus'
import { modulationName } from '../../kit/model/channel'
import { TONE_NONE, toneName } from '../../kit/model/tone'
import { LEVEL_RANGE } from '../../kit/model/settings'
import { toggleLive } from '../actions'
import { relativeTime, useTicker } from '../hooks'
import { usePrefs } from '../store/prefs'
import { canControl, live, useScanner } from '../store/scanner'
import { PauseCircleIcon, PauseIcon, PlayCircleIcon, PlayIcon, SpeakerIcon, WaveIcon } from './Icons'

/** `CH 312  TALKAROUND  462.5625 MHz  NFM  CTCSS 123.0`. When space is short, only the name is cut. */
function ChannelText({ status }: { status: LiveStatus }) {
  return (
    <>
      {status.channel !== null && <span className="secondary num">CH {status.channel}</span>}
      {status.name !== '' && <span className="name">{status.name}</span>}
      {status.frequency !== null && <span className="num">{mhz(status.frequency)} MHz</span>}
      {status.modulation && <span className="secondary">{modulationName(status.modulation)}</span>}
      {status.tone !== null && status.tone !== TONE_NONE && <span className="secondary">{toneName(status.tone)}</span>}
    </>
  )
}

function Level({ label, icon, value, set, disabled }: { label: string; icon: React.ReactNode; value: number | null; set: (v: number) => void; disabled: boolean }) {
  // The slider moves freely while dragging; each change is sent between polls.
  const [local, setLocal] = useState(value ?? 0)
  useEffect(() => setLocal(value ?? 0), [value])
  return (
    <span className="live-level" title={label}>
      {icon}
      <input
        className="slider"
        type="range"
        min={LEVEL_RANGE[0]}
        max={LEVEL_RANGE[1]}
        step={1}
        value={local}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={value === null ? 'unknown' : String(value)}
        onChange={(e) => {
          const level = Number(e.target.value)
          setLocal(level)
          set(level)
        }}
      />
      <output className="num">{value ?? '–'}</output>
    </span>
  )
}

/**
 * The strip along the bottom: what the scanner is receiving, the last transmission heard, Scan and
 * Hold, and its volume and squelch (SPEC.md §8.6).
 */
export function LiveBar() {
  const state = useScanner((s) => s.live)
  const status = useScanner((s) => s.status)
  const settled = useScanner((s) => s.settled)
  const lastHeard = useScanner((s) => s.lastHeard)
  const volume = useScanner((s) => s.volume)
  const squelch = useScanner((s) => s.squelch)
  const control = useScanner((s) => canControl(s))
  const enabled = usePrefs((s) => s.liveEnabled)
  useTicker(1000)

  let now: React.ReactNode
  let dot = 'dot'
  switch (state.kind) {
    case 'live':
      if (status && settled) {
        now = <ChannelText status={status} />
        dot = status.receiving ? 'dot on' : 'dot accent'
      } else {
        now = <span className="secondary">Scanning…</span>
      }
      break
    case 'connecting':
      now = <span className="secondary">Connecting…</span>
      break
    case 'noScanner':
      now = <span className="secondary">No scanner connected</span>
      break
    case 'off':
      now = <span className="secondary">Live view off</span>
      break
    case 'paused':
      now = <span className="secondary">{state.reason}</span>
      break
    case 'unavailable':
      now = <span className="warn">{state.message}</span>
      break
    case 'elsewhere':
      now = <span className="secondary">The scanner is in use in another tab</span>
      break
  }

  // Shown when something was heard and the scanner has moved on from it.
  const showLast = lastHeard && state.kind === 'live' && !status?.receiving
  const lastLabel = lastHeard ? (lastHeard.status.name !== '' ? lastHeard.status.name : lastHeard.status.frequency !== null ? `${mhz(lastHeard.status.frequency)} MHz` : '') : ''

  return (
    <footer className="livebar" aria-label="Live view">
      <div className="live-now" aria-live="polite">
        <span className={dot} aria-hidden />
        {now}
      </div>
      {showLast && lastHeard && (
        <span className="live-last" title={lastHeard.status.frequency !== null ? `${mhz(lastHeard.status.frequency)} MHz` : undefined}>
          <span className="secondary">Last:</span>
          <span>{lastLabel}</span>
          <span className="secondary num">{relativeTime(lastHeard.at)}</span>
        </span>
      )}
      <span className="live-divider" />
      <span className="live-controls">
        <button type="button" className="icon-button" title="Resume scanning, as the scanner’s Scan key does" aria-label="Scan" disabled={!control} onClick={() => live.scan()}>
          <PlayIcon />
        </button>
        <button
          type="button"
          className="icon-button"
          title="Stop on the channel shown"
          aria-label="Hold"
          disabled={!control || status?.channel == null}
          onClick={() => status?.channel != null && live.hold(status.channel)}
        >
          <PauseIcon />
        </button>
      </span>
      <span className="live-divider" />
      <Level label="Volume" icon={<SpeakerIcon />} value={volume} set={(v) => live.setVolume(v)} disabled={state.kind !== 'live'} />
      <Level label="Squelch" icon={<WaveIcon />} value={squelch} set={(v) => live.setSquelch(v)} disabled={state.kind !== 'live'} />
      <button
        type="button"
        className="icon-button"
        aria-label={enabled ? 'Pause Live View' : 'Resume Live View'}
        title={enabled ? 'Stop watching the scanner (frees it for other programs)' : 'Watch what the scanner is receiving'}
        onClick={toggleLive}
      >
        {enabled ? <PauseCircleIcon /> : <PlayCircleIcon />}
      </button>
    </footer>
  )
}
