import { rangesOnlyPlan } from '../model/bandPlan'
import { channelsEqual, delayFromNumber } from '../model/channel'
import { CHANNEL_COUNT, channelAt, cloneConfig, isoNow, makeConfig, MAX_GLOBAL_LOCKOUTS, type ScannerConfig } from '../model/config'
import { frequencyFromWire, mhz, sortedUnique, type Frequency } from '../model/frequency'
import { parseGLG, type LiveStatus } from '../model/liveStatus'
import { backlights, bandPlanRegions, closeCallModes, keyBeeps, LEVEL_RANGE, priorityModes, type Backlight } from '../model/settings'
import { ScannerConnection, ScannerError } from '../protocol/connection'
import { channelFromCIN, enabledFlagsFromInvertedMask, FormatError, wireBool, wireInt } from '../protocol/wire'
import type { LineTransport } from '../transport/lineTransport'
import { KEY_HOLD, KEY_SCAN, scanTiming, type ScanMode } from './scanMode'
import { makeWritePlan, type Adjustment, type WritePlan, type WriteStep } from './writePlan'

export interface ScannerIdentity {
  model: string
  firmware: string
}

export interface Progress {
  completed: number
  total: number
}

export const progressFraction = (p: Progress) => (p.total === 0 ? 0 : p.completed / p.total)

export interface WriteFailure {
  step: WriteStep
  reason: string
}

export interface WriteReport {
  /** Steps the scanner acknowledged with `OK`. */
  written: number
  /** Steps the scanner rejected (`ERR`/`NG`). */
  failures: WriteFailure[]
  /**
   * Differences still present when the scanner was read back after writing, described as the
   * steps that would fix them. Empty when the scanner holds exactly the plan's target.
   */
  mismatches: WriteStep[]
  /** The scanner's configuration as read back after writing. */
  scannerConfig: ScannerConfig
  /**
   * Channels whose frequency the scanner stored differently than predicted (possible where the
   * plan was only sampled or spot-checked, SPEC.md §3.5). These aren't failures: the scanner
   * snapped the value to its own plan, and `acceptedConfig` has what it stored.
   */
  storedDifferently: Adjustment[]
  /** The plan's target with the scanner's stored frequencies, for updating the document. */
  acceptedConfig: ScannerConfig
}

export const writeSucceeded = (report: WriteReport) => report.failures.length === 0 && report.mismatches.length === 0

export type SessionErrorKind = 'unsupportedModel' | 'programModeRefused'

export class SessionError extends Error {
  readonly kind: SessionErrorKind

  constructor(kind: SessionErrorKind, model = '') {
    super(
      kind === 'unsupportedModel'
        ? `This scanner reports itself as ${JSON.stringify(model)}, not a BC125AT`
        : 'The scanner refused program mode. Exit any menu on the scanner, then try again.',
    )
    this.name = 'SessionError'
    this.kind = kind
  }
}

/** Thrown when an operation's `AbortSignal` fires. */
export class CancellationError extends Error {
  constructor() {
    super('Cancelled')
    this.name = 'CancellationError'
  }
}

export function checkCancellation(signal?: AbortSignal) {
  if (signal?.aborted) throw new CancellationError()
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export interface OperationOptions {
  progress?: (progress: Progress) => void
  signal?: AbortSignal
}

const SETTINGS_COMMANDS = 14
const READ_STEPS = SETTINGS_COMMANDS + 10 + CHANNEL_COUNT + 1

/** Owns the connection to one scanner (SPEC.md §6.1). Commands run one at a time. */
export class ScannerSession {
  readonly connection: ScannerConnection

  constructor(transport: LineTransport) {
    this.connection = new ScannerConnection(transport)
  }

  /** A session on `transport`, with anything left over from an earlier exchange discarded. */
  static async open(transport: LineTransport): Promise<ScannerSession> {
    await transport.drainInput()
    return new ScannerSession(transport)
  }

  close() {
    return this.connection.transport.close()
  }

  async identify(): Promise<ScannerIdentity> {
    return {
      model: (await this.connection.execute('MDL')).join(','),
      firmware: (await this.connection.execute('VER')).join(','),
    }
  }

  // MARK: Live (outside program mode, while the scanner keeps scanning)

  /** `GLG`: what the scanner is tuned to right now (SPEC.md §3.7). */
  async liveStatus(): Promise<LiveStatus> {
    return parseGLG(await this.connection.execute('GLG'))
  }

  /** `VOL` and `SQL`, read together. */
  async levels(): Promise<{ volume: number; squelch: number }> {
    const level = async (command: string) => {
      const fields = await this.connection.execute(command)
      const value = fields.length > 0 ? wireInt(fields[0], LEVEL_RANGE) : null
      if (value === null) throw new FormatError(command, fields)
      return value
    }
    const volume = await level('VOL')
    const squelch = await level('SQL')
    return { volume, squelch }
  }

  /** Sets the volume (0–15) immediately, as the scanner's own control would. */
  async setVolume(level: number) {
    await this.connection.execute(`VOL,${Math.min(Math.max(Math.round(level), 0), 15)}`)
  }

  /** Sets the squelch (0 = open – 15) immediately. */
  async setSquelch(level: number) {
    await this.connection.execute(`SQL,${Math.min(Math.max(Math.round(level), 0), 15)}`)
  }

  /** Sends `EPG` to recover a scanner left in program mode (SPEC.md §7). */
  releaseProgramMode() {
    return this.connection.exitProgramMode()
  }

  // MARK: Reading and writing

  /**
   * Reads the scanner's whole configuration. Always leaves program mode, including on error or
   * cancellation. The scanner is left in Scan Hold afterwards.
   */
  async readConfiguration(options: OperationOptions = {}): Promise<ScannerConfig> {
    const identity = await this.enterProgramMode()
    try {
      let completed = 0
      return await this.readAll(identity, options.signal, () => {
        checkCancellation(options.signal)
        completed += 1
        options.progress?.({ completed, total: READ_STEPS })
      })
    } finally {
      await this.connection.exitProgramMode().catch(() => {})
    }
  }

  /**
   * Writes `plan`, then reads the whole scanner back to check it (SPEC.md §7). Commands the
   * scanner rejects are reported and skipped; transport errors and cancellation stop the write.
   * Always leaves program mode.
   */
  async write(plan: WritePlan, options: OperationOptions = {}): Promise<WriteReport> {
    const identity = await this.enterProgramMode()
    try {
      const total = plan.steps.length + READ_STEPS
      let completed = 0
      const step = () => {
        checkCancellation(options.signal)
        completed += 1
        options.progress?.({ completed, total })
      }

      let written = 0
      const failures: WriteFailure[] = []
      for (const planned of plan.steps) {
        try {
          const reply = await this.connection.execute(planned.command)
          if (reply.length === 1 && reply[0] === 'OK') written += 1
          else failures.push({ step: planned, reason: `Unexpected reply ${reply.join(',')}` })
        } catch (error) {
          if (!(error instanceof ScannerError)) throw error
          if (error.kind === 'rejected') failures.push({ step: planned, reason: 'The scanner rejected the value (ERR)' })
          else if (error.kind === 'notAllowed') failures.push({ step: planned, reason: 'The scanner refused the command (NG)' })
          else throw error
        }
        step()
      }

      const actual = await this.readAll(identity, options.signal, step)
      // A channel that matches except for its frequency was snapped by the scanner to its own
      // channel plan: accept what it stored and report it, rather than calling it a failure.
      const accepted = cloneConfig(plan.target)
      const storedDifferently: Adjustment[] = []
      for (let number = 1; number <= CHANNEL_COUNT; number++) {
        const expected = channelAt(accepted, number)
        const stored = channelAt(actual, number)
        const sent = expected.frequency
        const kept = stored.frequency
        if (sent === null || kept === null || sent === kept) continue
        const adjusted = { ...expected, frequency: kept }
        if (!channelsEqual(adjusted, stored)) continue
        accepted.channels[number - 1] = adjusted
        storedDifferently.push({ title: `Channel ${number}`, detail: `${mhz(sent)} MHz was stored as ${mhz(kept)} MHz` })
      }
      // Volume and squelch aren't written, and may have been changed on the scanner meanwhile.
      accepted.settings.volume = actual.settings.volume
      accepted.settings.squelch = actual.settings.squelch
      // The target is already as stored, so compare without snapping it again.
      const remaining = makeWritePlan(actual, accepted, rangesOnlyPlan)
      return { written, failures, mismatches: remaining.steps, scannerConfig: actual, storedDifferently, acceptedConfig: accepted }
    } finally {
      await this.connection.exitProgramMode().catch(() => {})
    }
  }

  private async enterProgramMode(): Promise<ScannerIdentity> {
    const identity = await this.identify()
    if (identity.model !== 'BC125AT') throw new SessionError('unsupportedModel', identity.model)
    try {
      await this.connection.enterProgramMode()
    } catch (error) {
      if (error instanceof ScannerError && error.kind === 'notAllowed') throw new SessionError('programModeRefused')
      throw error
    }
    return identity
  }

  /** Reads every section; the caller handles program mode. */
  private async readAll(identity: ScannerIdentity, signal: AbortSignal | undefined, step: () => void): Promise<ScannerConfig> {
    const config = makeConfig()
    config.metadata = { model: identity.model, firmware: identity.firmware, readAt: isoNow(), notes: '' }
    await this.readSettings(config, step)
    for (let index = 0; index < 10; index++) {
      const f = await this.connection.execute(`CSP,${index + 1}`)
      const lower = f.length >= 3 ? frequencyFromWire(f[1]) : null
      const upper = f.length >= 3 ? frequencyFromWire(f[2]) : null
      if (f.length < 3 || wireInt(f[0]) !== index + 1 || lower === null || upper === null) throw new FormatError('CSP', f)
      config.search.customRanges[index] = { lower, upper, enabled: config.search.customRanges[index].enabled }
      step()
    }
    for (let number = 1; number <= CHANNEL_COUNT; number++) {
      const { number: reported, channel } = channelFromCIN(await this.connection.execute(`CIN,${number}`))
      if (reported !== number) throw new FormatError('CIN', [`${reported}`, `expected ${number}`])
      config.channels[number - 1] = channel
      step()
    }
    config.globalLockouts = await this.readGlobalLockouts(signal)
    step()
    return config
  }

  private async readSettings(config: ScannerConfig, step: () => void) {
    const fields = async (command: string, count: number) => {
      const f = await this.connection.execute(command)
      if (f.length < count) throw new FormatError(command, f)
      step()
      return f
    }
    function parse<T>(command: string, f: string[], value: T | null | undefined): T {
      if (value === null || value === undefined) throw new FormatError(command, f)
      return value
    }
    const oneOf = <T extends string | number>(values: readonly T[], value: string | number | null) =>
      values.find((v) => v === value) ?? null

    let f = await fields('BLT', 1)
    config.settings.backlight = parse('BLT', f, oneOf<Backlight>(backlights, f[0]))
    f = await fields('BSV', 1)
    config.settings.batteryChargeHours = parse('BSV', f, wireInt(f[0]))
    f = await fields('KBP', 2)
    config.settings.keyBeep = parse('KBP', f, oneOf(keyBeeps, wireInt(f[0])))
    config.settings.keyLock = parse('KBP', f, wireBool(f[1]))
    f = await fields('BPL', 1)
    config.settings.bandPlan = parse('BPL', f, oneOf(bandPlanRegions, wireInt(f[0])))
    f = await fields('PRI', 1)
    config.settings.priorityMode = parse('PRI', f, oneOf(priorityModes, wireInt(f[0])))
    f = await fields('SCG', 1)
    config.bankScanEnabled = enabledFlagsFromInvertedMask(f[0], 10, 'SCG')
    f = await fields('SCO', 2)
    const delay = wireInt(f[0])
    config.search.delay = parse('SCO', f, delay === null ? null : delayFromNumber(delay))
    config.search.codeSearch = parse('SCO', f, wireBool(f[1]))
    f = await fields('CLC', 5)
    config.closeCall.mode = parse('CLC', f, oneOf(closeCallModes, wireInt(f[0])))
    config.closeCall.alertBeep = parse('CLC', f, wireBool(f[1]))
    config.closeCall.alertLight = parse('CLC', f, wireBool(f[2]))
    // Unlike the other masks, Close Call bands use 1 = on.
    if (!/^[01]{5}$/.test(f[3])) throw new FormatError('CLC', f)
    config.closeCall.bandsEnabled = [...f[3]].map((digit) => digit === '1')
    config.closeCall.scanHits = parse('CLC', f, wireBool(f[4]))
    f = await fields('SSG', 1)
    config.search.serviceGroupsEnabled = enabledFlagsFromInvertedMask(f[0], 10, 'SSG')
    f = await fields('CSG', 1)
    enabledFlagsFromInvertedMask(f[0], 10, 'CSG').forEach((enabled, index) => {
      config.search.customRanges[index].enabled = enabled
    })
    f = await fields('WXS', 1)
    config.settings.weatherAlertPriority = parse('WXS', f, wireBool(f[0]))
    f = await fields('CNT', 1)
    config.settings.contrast = parse('CNT', f, wireInt(f[0]))
    f = await fields('VOL', 1)
    config.settings.volume = parse('VOL', f, wireInt(f[0]))
    f = await fields('SQL', 1)
    config.settings.squelch = parse('SQL', f, wireInt(f[0]))
  }

  /** `GLF,0` resets the cursor (SPEC.md §3.3); then `GLF` repeats until `-1`. */
  private async readGlobalLockouts(signal: AbortSignal | undefined): Promise<Frequency[]> {
    await this.connection.execute('GLF,0')
    const lockouts: Frequency[] = []
    while (lockouts.length <= MAX_GLOBAL_LOCKOUTS) {
      checkCancellation(signal)
      const f = await this.connection.execute('GLF')
      if (f.length === 0) throw new FormatError('GLF', f)
      if (f[0] === '-1') break
      const frequency = frequencyFromWire(f[0])
      if (frequency === null) throw new FormatError('GLF', f)
      lockouts.push(frequency)
    }
    return sortedUnique(lockouts)
  }

  // MARK: Scan and hold (SPEC.md §3.8)

  /**
   * Watches `GLG` to tell scanning from hold: the channel changes several times a second while
   * scanning, and stays put in hold. `null` when the scanner isn't on a memory channel (a menu,
   * search, Close Call Only, weather) or doesn't answer; those modes aren't restored.
   */
  async scanMode(signal?: AbortSignal): Promise<ScanMode | null> {
    const start = performance.now()
    let first: number | null = null
    let window = scanTiming.holdWindowMs
    for (;;) {
      checkCancellation(signal)
      let status: LiveStatus
      try {
        status = await this.liveStatus()
      } catch {
        return null
      }
      if (status.channel === null) return null
      if (first !== null && status.channel !== first) return { kind: 'scanning' }
      first ??= status.channel
      if (status.receiving) window = scanTiming.holdWindowWhileReceivingMs
      if (performance.now() - start >= window) return { kind: 'hold', channel: status.channel }
      await sleep(scanTiming.pollMs)
    }
  }

  /** Resumes scanning, as pressing Scan does. */
  scan() {
    return this.press(KEY_SCAN)
  }

  /**
   * Puts the scanner in hold on `channel`, from scanning or from hold on any channel, and checks
   * it got there. Number keys while scanning turn banks on and off, so this first presses Scan
   * (which only ever leads to scanning), then Hold, and only then the digits and Hold again.
   * Returns false if the scanner ends up elsewhere, for example on an empty channel.
   */
  async hold(channel: number): Promise<boolean> {
    if (!Number.isInteger(channel) || channel < 1 || channel > CHANNEL_COUNT) throw new RangeError(`No channel ${channel}`)
    await this.press(KEY_SCAN)
    await this.press(KEY_HOLD)
    for (const digit of String(channel)) await this.press(digit)
    await this.press(KEY_HOLD)
    for (let attempt = 0; attempt < 5; attempt++) {
      await sleep(scanTiming.holdCheckMs)
      try {
        if ((await this.liveStatus()).channel === channel) return true
      } catch {
        // Try again.
      }
    }
    return false
  }

  /** Puts the scanner back in `mode` after program mode. Returns false if it couldn't. */
  async restore(mode: ScanMode): Promise<boolean> {
    if (mode.kind === 'scanning') {
      await this.scan()
      return true
    }
    return this.hold(mode.channel)
  }

  private async press(key: string) {
    const reply = await this.connection.execute(`KEY,${key},P`)
    if (reply.length !== 1 || reply[0] !== 'OK') throw new ScannerError('unexpectedResponse', 'KEY', reply.join(','))
  }
}
