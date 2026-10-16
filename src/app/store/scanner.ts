import { create } from 'zustand'
import type { LiveStatus } from '../../kit/model/liveStatus'
import type { ScanMode } from '../../kit/sync/scanMode'
import { CancellationError, ScannerSession } from '../../kit/sync/session'
import { grantedDevices, requestDevice, watchDevices, type ScannerDevice } from '../devices'
import { liveErrorMessage } from '../messages'
import { debugMode, type TransportKind } from '../platform'
import { usePrefs } from './prefs'
import { useUI } from './ui'

export type LiveState =
  | { kind: 'noScanner' }
  | { kind: 'connecting' }
  | { kind: 'live' }
  /** Paused for a read or write; the text says which. */
  | { kind: 'paused'; reason: string }
  /** Turned off with the live bar's pause button. */
  | { kind: 'off' }
  /** Couldn't talk to the scanner (for example, another program has it open). Retries. */
  | { kind: 'unavailable'; message: string }
  /** Another tab has taken over. */
  | { kind: 'elsewhere' }

export interface ScannerState {
  devices: ScannerDevice[]
  selectedId: string | null
  live: LiveState
  /** The latest `GLG` reply. */
  status: LiveStatus | null
  /**
   * True when the channel shown is worth showing: a signal is open, or the scanner has stayed on
   * it (hold, or the delay after a transmission) rather than passing through while scanning.
   */
  settled: boolean
  /** The most recent transmission and when it was last heard, so a short one isn't lost. */
  lastHeard: { status: LiveStatus; at: number } | null
  volume: number | null
  squelch: number | null
  /** What the last read or write found the scanner doing, and whether it was put back. */
  lastRestore: { mode: ScanMode; succeeded: boolean } | null
  /** A read, write, compare or release is running. */
  busy: boolean
}

export const useScanner = create<ScannerState>(() => ({
  devices: [],
  selectedId: null,
  live: { kind: 'noScanner' },
  status: null,
  settled: false,
  lastHeard: null,
  volume: null,
  squelch: null,
  lastRestore: null,
  busy: false,
}))

const get = useScanner.getState
const set = useScanner.setState

export const selectedDevice = (state: ScannerState = get()): ScannerDevice | null =>
  state.devices.find((d) => d.id === state.selectedId) ?? state.devices[0] ?? null

/** How often to ask the scanner what it's doing. */
const POLL_MS = 200
/** How long the scanner must stay on a channel to count as settled. */
const SETTLE_MS = 600

type Action = { kind: 'scan' } | { kind: 'hold'; channel: number }

/**
 * Watches what the scanner is receiving and controls its volume and squelch while it scans
 * (SPEC.md §8.6), and gives reads and writes the scanner to themselves (`withScanner`). A port of
 * the macOS app's `LiveMonitor`.
 *
 * Unlike the macOS app, the page keeps the connection open between polls and operations: the
 * browser holds a USB device per page. Turning the live bar off closes it, freeing the scanner
 * for other programs.
 */
class LiveMonitor {
  private session: ScannerSession | null = null
  private sessionDevice: string | null = null
  private loop: { cancelled: boolean; done: Promise<void>; wake: () => void } | null = null
  private pauses = 0
  private pendingVolume: number | null = null
  private pendingSquelch: number | null = null
  private pendingAction: Action | null = null
  private lastLevelChange = 0
  private lastMove = 0
  /** A frequency ignored as a priority sample on the last poll (see `apply`). */
  private ignoredSample: number | null = null
  private yielded = false

  get enabled() {
    return usePrefs.getState().liveEnabled
  }

  async setEnabled(enabled: boolean) {
    usePrefs.getState().set({ liveEnabled: enabled })
    if (enabled) this.start()
    else await this.stop({ kind: 'off' }, true)
  }

  // MARK: Devices

  async refreshDevices() {
    const devices = await grantedDevices()
    const before = selectedDevice()
    set({ devices })
    const after = selectedDevice()
    if (before?.id !== after?.id) await this.deviceChanged()
    else if (!this.loop && this.pauses === 0) this.start()
  }

  async select(id: string) {
    set({ selectedId: id })
    await this.deviceChanged()
  }

  /** Shows the browser's chooser and switches to the scanner picked. Returns whether one was. */
  async connect(kind: TransportKind): Promise<boolean> {
    const device = await requestDevice(kind)
    if (!device) return false
    const devices = await grantedDevices()
    set({ devices, selectedId: devices.find((d) => d.id === device.id)?.id ?? device.id })
    await this.deviceChanged()
    return true
  }

  private async deviceChanged() {
    await this.stop(selectedDevice() ? { kind: 'connecting' } : { kind: 'noScanner' }, true)
    this.start()
  }

  // MARK: Control

  setVolume(level: number) {
    set({ volume: level })
    this.pendingVolume = level
    this.lastLevelChange = performance.now()
    this.loop?.wake()
  }

  setSquelch(level: number) {
    set({ squelch: level })
    this.pendingSquelch = level
    this.lastLevelChange = performance.now()
    this.loop?.wake()
  }

  /** Resumes scanning, as the scanner's Scan key does. */
  scan() {
    this.pendingAction = { kind: 'scan' }
    this.loop?.wake()
  }

  /** Holds the scanner on `channel`, to listen to it. */
  hold(channel: number) {
    this.pendingAction = { kind: 'hold', channel }
    this.loop?.wake()
  }

  /**
   * Runs `work` with the scanner to itself: pauses polling, makes sure a session is open, and
   * resumes polling afterwards. Every read, write and release goes through here. With
   * `keepingMode`, it first notes whether the scanner is scanning or held, and afterwards puts it
   * back, since program mode leaves it held on channel 1 (SPEC.md §3.8). `signal` cancels that
   * first check too, not just `work`.
   */
  async withScanner<T>(reason: string, keepingMode: boolean, work: (session: ScannerSession) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const device = selectedDevice()
    if (!device) throw new Error('No scanner is connected.')
    set({ busy: true })
    this.pauses += 1
    await this.stop({ kind: 'paused', reason }, false)
    try {
      const session = await this.openSession(device)
      const mode = keepingMode
        ? await session.scanMode(signal).catch((error) => {
            if (error instanceof CancellationError) throw error
            return null
          })
        : null
      const finish = async () => {
        if (mode) set({ lastRestore: { mode, succeeded: await session.restore(mode).catch(() => false) } })
        else if (keepingMode) set({ lastRestore: null })
      }
      try {
        const result = await work(session)
        await finish()
        return result
      } catch (error) {
        await finish().catch(() => {})
        // The connection may be in a bad state; start afresh next time.
        await this.closeSession()
        throw error
      }
    } finally {
      this.pauses = Math.max(0, this.pauses - 1)
      set({ busy: false })
      if (!this.enabled) await this.stop({ kind: 'off' }, true)
      this.start()
    }
  }

  /** Lets go of the scanner for good, because another tab has taken over. */
  async yieldToOtherTab() {
    this.yielded = true
    await this.stop({ kind: 'elsewhere' }, true)
  }

  // MARK: Polling

  start() {
    if (this.loop || this.pauses > 0 || this.yielded) return
    if (!this.enabled) {
      set({ live: { kind: 'off' } })
      return
    }
    const device = selectedDevice()
    if (!device) {
      set({ live: { kind: 'noScanner' } })
      return
    }
    set({ live: { kind: 'connecting' } })
    let wakeSleep: () => void = () => {}
    const token = {
      cancelled: false,
      done: Promise.resolve(),
      wake: () => wakeSleep(),
    }
    const pause = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms)
        wakeSleep = () => {
          clearTimeout(timer)
          resolve()
        }
      })
    token.done = this.run(device, token, pause)
    this.loop = token
  }

  /** Stops polling and, with `close`, releases the scanner. */
  private async stop(state: LiveState, close: boolean) {
    const loop = this.loop
    this.loop = null
    if (loop) {
      loop.cancelled = true
      loop.wake()
      await loop.done
    }
    if (close) await this.closeSession()
    set({ live: state, status: null, settled: false })
  }

  private async openSession(device: ScannerDevice): Promise<ScannerSession> {
    if (this.session && this.sessionDevice === device.id) return this.session
    await this.closeSession()
    const session = await ScannerSession.open(await device.open())
    if (debugMode) logExchanges(session)
    this.session = session
    this.sessionDevice = device.id
    return session
  }

  private async closeSession() {
    const session = this.session
    this.session = null
    this.sessionDevice = null
    await session?.close().catch(() => {})
  }

  private async run(device: ScannerDevice, token: { cancelled: boolean }, pause: (ms: number) => Promise<void>) {
    let polls = 0
    while (!token.cancelled) {
      try {
        const session = await this.openSession(device)
        if (this.pendingVolume !== null) {
          const level = this.pendingVolume
          this.pendingVolume = null
          await session.setVolume(level)
        }
        if (this.pendingSquelch !== null) {
          const level = this.pendingSquelch
          this.pendingSquelch = null
          await session.setSquelch(level)
        }
        if (this.pendingAction) {
          const action = this.pendingAction
          this.pendingAction = null
          if (action.kind === 'scan') await session.scan()
          else if (!(await session.hold(action.channel))) useUI.getState().toast(`The scanner couldn't hold on channel ${action.channel}.`)
          this.lastMove = performance.now()
        }
        if (token.cancelled) break
        this.apply(await session.liveStatus())
        // Pick up changes made on the scanner itself, but not while a slider is moving.
        if (polls % 10 === 0 && performance.now() - this.lastLevelChange > 2000) {
          const { volume, squelch } = await session.levels()
          if (performance.now() - this.lastLevelChange > 2000) set({ volume, squelch })
        }
        polls += 1
        if (get().live.kind !== 'live') set({ live: { kind: 'live' } })
        await pause(POLL_MS)
      } catch (error) {
        if (token.cancelled) break
        await this.closeSession()
        set({ status: null, settled: false, live: { kind: 'unavailable', message: liveErrorMessage(error, device.kind) } })
        await pause(2000)
      }
    }
  }

  private apply(status: LiveStatus) {
    const previous = get().status
    const now = performance.now()
    // With priority on, the scanner samples the bank's priority channel every 2 seconds, even in
    // hold. `GLG` then reports the priority channel's frequency under the held channel's number
    // and name, with no signal, for one poll. That isn't the scanner moving: keep showing the held
    // channel. A frequency that's still there on the next poll is real, and is shown.
    const sample = previous && status.channel !== null && status.channel === previous.channel && status.frequency !== previous.frequency && !status.receiving
    if (sample && this.ignoredSample !== status.frequency) {
      this.ignoredSample = status.frequency
      if (debugMode) console.info(`[bc125at] ${clock()} priority check on CH ${status.channel}: ignored ${status.frequency}`)
      return
    }
    this.ignoredSample = null
    if (status.channel !== previous?.channel || status.frequency !== previous?.frequency) this.lastMove = now
    const settled = status.frequency !== null && (status.receiving || now - this.lastMove > SETTLE_MS)
    const change: Partial<ScannerState> = { status, settled }
    if (status.receiving && status.frequency !== null) change.lastHeard = { status, at: Date.now() }
    if (debugMode) {
      const shown = (s: LiveStatus | null, isSettled: boolean) => (s && isSettled ? `CH ${s.channel}` : 'Scanning…')
      const before = shown(previous, get().settled)
      const after = shown(status, settled)
      if (before !== after) console.info(`[bc125at] ${clock()} live bar: ${before} → ${after}`)
    }
    set(change)
  }
}

const debugStart = performance.now()
const clock = () => `${((performance.now() - debugStart) / 1000).toFixed(3)} s`

/**
 * `?debug`: logs each command with the reply it got and how long it took, and warns when a reply
 * doesn't belong to the command sent (its first field names another command).
 */
function logExchanges(session: ScannerSession) {
  let sentAt = performance.now()
  const transport = session.connection.transport
  const write = transport.writeLine.bind(transport)
  transport.writeLine = (line, timeoutMs) => {
    sentAt = performance.now()
    return write(line, timeoutMs)
  }
  session.connection.onExchange = (sent, reply) => {
    const ms = (performance.now() - sentAt).toFixed(1)
    const command = sent.split(',')[0]
    const replyCommand = reply?.split(',')[0]
    if (reply !== null && reply !== 'ERR' && reply !== 'NG' && replyCommand !== command) {
      console.warn(`[bc125at] ${clock()} MISMATCH: sent ${sent} → got ${reply} (${ms} ms)`)
    } else {
      console.debug(`[bc125at] ${clock()} ${sent} → ${reply ?? '(no reply)'} (${ms} ms)`)
    }
  }
  console.info(`[bc125at] ${clock()} opened a session`)
}

export const live = new LiveMonitor()

/** Starts watching for scanners: the ones granted before, and any plugged in later. */
export function startScannerWatch() {
  void live.refreshDevices()
  watchDevices(() => void live.refreshDevices())
}

/** Scan, Hold and Listen work only while the live bar is talking to the scanner. */
export const canControl = (state: ScannerState) => state.live.kind === 'live'

/** What to tell the person after a read or write about the mode the scanner was left in. */
export function modeAfterUse(state: ScannerState): string {
  const restore = state.lastRestore
  if (restore?.mode.kind === 'scanning' && restore.succeeded) return 'The scanner is scanning again.'
  if (restore?.mode.kind === 'hold' && restore.succeeded) return `The scanner is back on hold on channel ${restore.mode.channel}.`
  if (restore?.mode.kind === 'hold') return `The scanner is in Scan Hold. It couldn't go back to channel ${restore.mode.channel}, where it was held.`
  return 'The scanner is now in Scan Hold. Press Scan on the scanner to start scanning again.'
}
