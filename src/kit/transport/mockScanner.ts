import { planContains, storedValue, type BandPlan } from '../model/bandPlan'
import { bankOfChannel, channelsInBank, delayFromNumber, emptyChannel, isEmptyChannel, isModulation, MAX_NAME_LENGTH, namePrefix } from '../model/channel'
import { CHANNEL_COUNT, channelAt, channelPlan, makeConfig, MAX_GLOBAL_LOCKOUTS, type ScannerConfig } from '../model/config'
import { frequencyFromWire, wireValue } from '../model/frequency'
import {
  backlights,
  bandPlanRegions,
  BATTERY_CHARGE_RANGE,
  closeCallModes,
  CONTRAST_RANGE,
  defaultCloseCallSettings,
  keyBeeps,
  LEVEL_RANGE,
  priorityModes,
  type Backlight,
} from '../model/settings'
import { toneFromCode } from '../model/tone'
import { enabledFlagsFromInvertedMask, invertedMask, wireBool, wireFlag, wireInt } from '../protocol/wire'
import type { ScanMode } from '../sync/scanMode'
import { TransportError, type LineTransport } from './lineTransport'

const PROGRAM_MODE_ONLY = new Set(['BLT', 'BSV', 'CLR', 'KBP', 'BPL', 'PRI', 'SCG', 'DCH', 'CIN', 'SCO', 'GLF', 'ULF', 'LOF', 'CLC', 'SSG', 'CSG', 'CSP', 'WXS', 'CNT'])

const oneOf = <T extends string | number>(values: readonly T[], value: string | number | null) => values.find((v) => v === value) ?? null

/**
 * A fake BC125AT that keeps state and reproduces the behaviour measured in Phase 0 (SPEC.md §3):
 * program-mode gating, `ERR`/`NG` forms, frequency snapping, one priority channel per bank, the
 * 100-entry lockout list that silently drops extras, `GLF,0` cursor reset, and `CNT` ignoring
 * out-of-range values. Used by the tests, and by the app's `?demo` mode.
 */
export class MockScanner implements LineTransport {
  config: ScannerConfig
  model = 'BC125AT'
  firmware = 'Version 1.06.06'
  inProgramMode = false
  /** Simulates the scanner being in a menu: `PRG` replies `PRG,NG`. */
  refusesProgramMode = false
  /** Commands (by name) that get no reply, to simulate timeouts. */
  unresponsiveCommands = new Set<string>()
  /**
   * Simulates scanning and Scan Hold for `GLG` and `KEY` (SPEC.md §3.8): while scanning, each `GLG`
   * reports the next used channel; Hold, Scan and the number keys act as on the scanner, including
   * number keys toggling banks while scanning; `EPG` leaves it held on channel 1. `null` (the
   * default) keeps `GLG` replying with `glgFields`.
   */
  scanMode: ScanMode | null = null
  /** The raw `GLG` reply fields (after the command name). */
  glgFields: string[] = Array<string>(12).fill('')
  /** Every line received, in order. */
  readonly received: string[] = []
  /** Milliseconds to wait before each reply, to make the demo feel like hardware. */
  latencyMs = 0
  /** Called for every `GLG` while scanning, to let the demo decide whether a signal is open. */
  receivingOn: ((channel: number) => boolean) | null = null

  private readonly bandPlanOverride: BandPlan | null
  private replies: string[] = []
  private lockoutCursor = 0
  private scanCursor = 0
  private typed = ''

  /** Snaps frequencies to `bandPlan`, or to the plan for its current band plan setting if omitted. */
  constructor(config: ScannerConfig = makeConfig(), bandPlan?: BandPlan) {
    this.config = config
    this.bandPlanOverride = bandPlan ?? null
  }

  private get bandPlan(): BandPlan {
    return this.bandPlanOverride ?? channelPlan(this.config)
  }

  async writeLine(line: string): Promise<void> {
    this.received.push(line)
    const fields = line.split(',')
    if (this.unresponsiveCommands.has(fields[0])) return
    this.replies.push(this.reply(fields[0], fields.slice(1)))
  }

  async readLine(): Promise<string> {
    if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs))
    const reply = this.replies.shift()
    if (reply === undefined) throw new TransportError('timedOut')
    return reply
  }

  async drainInput(): Promise<void> {
    this.replies = []
  }

  async close(): Promise<void> {}

  private usedChannels(): number[] {
    const used: number[] = []
    for (let n = 1; n <= CHANNEL_COUNT; n++) if (!isEmptyChannel(channelAt(this.config, n))) used.push(n)
    return used
  }

  /** The channels Scan visits: in use, not locked out, in a bank that's scanned. */
  private scanList(): number[] {
    return this.usedChannels().filter((n) => this.config.bankScanEnabled[bankOfChannel(n) - 1] && !channelAt(this.config, n).lockedOut)
  }

  reply(command: string, args: string[]): string {
    if (PROGRAM_MODE_ONLY.has(command) && !this.inProgramMode) return `${command},NG`
    const isGet = args.length === 0
    const ok = () => `${command},OK`
    const err = () => `${command},ERR`
    const config = this.config
    const settings = config.settings

    switch (command) {
      case 'MDL':
        return `MDL,${this.model}`
      case 'VER':
        return `VER,${this.firmware}`
      case 'PRG':
        if (this.refusesProgramMode) return 'PRG,NG'
        this.inProgramMode = true
        this.lockoutCursor = 0
        return ok()
      case 'EPG':
        this.inProgramMode = false
        if (this.scanMode) this.scanMode = { kind: 'hold', channel: 1 }
        return ok()
      case 'BLT': {
        if (isGet) return `BLT,${settings.backlight}`
        const value = oneOf<Backlight>(backlights, args[0])
        if (value === null) return err()
        settings.backlight = value
        return ok()
      }
      case 'BSV': {
        if (isGet) return `BSV,${settings.batteryChargeHours}`
        const value = wireInt(args[0], BATTERY_CHARGE_RANGE)
        if (value === null) return err()
        settings.batteryChargeHours = value
        return ok()
      }
      case 'KBP': {
        if (isGet) return `KBP,${settings.keyBeep},${wireFlag(settings.keyLock)}`
        const beep = args.length === 2 ? oneOf(keyBeeps, wireInt(args[0])) : null
        const lock = args.length === 2 ? wireBool(args[1]) : null
        if (beep === null || lock === null) return err()
        settings.keyBeep = beep
        settings.keyLock = lock
        return ok()
      }
      case 'BPL': {
        if (isGet) return `BPL,${settings.bandPlan}`
        const value = oneOf(bandPlanRegions, wireInt(args[0]))
        if (value === null) return err()
        settings.bandPlan = value
        return ok()
      }
      case 'PRI': {
        if (isGet) return `PRI,${settings.priorityMode}`
        const value = oneOf(priorityModes, wireInt(args[0]))
        if (value === null) return err()
        settings.priorityMode = value
        return ok()
      }
      case 'SCG':
      case 'SSG':
      case 'CSG':
        return this.mask(command, args)
      case 'SCO': {
        if (isGet) return `SCO,${config.search.delay},${wireFlag(config.search.codeSearch)}`
        const delayNumber = args.length === 2 ? wireInt(args[0]) : null
        const delay = delayNumber === null ? null : delayFromNumber(delayNumber)
        const code = args.length === 2 ? wireBool(args[1]) : null
        if (delay === null || code === null) return err()
        config.search.delay = delay
        config.search.codeSearch = code
        return ok()
      }
      case 'CLC': {
        const cc = config.closeCall
        if (isGet) {
          const bands = cc.bandsEnabled.map((on) => (on ? '1' : '0')).join('')
          return `CLC,${cc.mode},${wireFlag(cc.alertBeep)},${wireFlag(cc.alertLight)},${bands},${wireFlag(cc.scanHits)}`
        }
        if (args.length !== 5) return err()
        const mode = oneOf(closeCallModes, wireInt(args[0]))
        const beep = wireBool(args[1])
        const light = wireBool(args[2])
        const scanHits = wireBool(args[4])
        if (mode === null || beep === null || light === null || scanHits === null || !/^[01]{5}$/.test(args[3])) return err()
        config.closeCall = { ...defaultCloseCallSettings(), mode, alertBeep: beep, alertLight: light, bandsEnabled: [...args[3]].map((d) => d === '1'), scanHits }
        return ok()
      }
      case 'CSP': {
        const number = args.length > 0 ? wireInt(args[0], [1, 10]) : null
        if (number === null) return err()
        if (args.length === 1) {
          const range = config.search.customRanges[number - 1]
          return `CSP,${number},${wireValue(range.lower)},${wireValue(range.upper)}`
        }
        const lower = args.length === 3 ? frequencyFromWire(args[1]) : null
        const upper = args.length === 3 ? frequencyFromWire(args[2]) : null
        if (lower === null || upper === null || !planContains(this.bandPlan, lower) || !planContains(this.bandPlan, upper)) return err()
        config.search.customRanges[number - 1].lower = lower
        config.search.customRanges[number - 1].upper = upper
        return ok()
      }
      case 'WXS': {
        if (isGet) return `WXS,${wireFlag(settings.weatherAlertPriority)}`
        const value = wireBool(args[0])
        if (value === null) return err()
        settings.weatherAlertPriority = value
        return ok()
      }
      case 'CNT': {
        if (isGet) return `CNT,${settings.contrast}`
        const value = wireInt(args[0])
        if (value === null) return err()
        // Measured: out-of-range values are acknowledged but ignored.
        if (value >= CONTRAST_RANGE[0] && value <= CONTRAST_RANGE[1]) settings.contrast = value
        return ok()
      }
      case 'GLG': {
        const mode = this.scanMode
        if (!mode) return ['GLG', ...this.glgFields].join(',')
        if (mode.kind === 'hold') return this.glg(mode.channel, this.receivingOn?.(mode.channel) ?? false)
        const used = this.scanList()
        if (used.length === 0) return 'GLG,,,,,,,,0,1,,,'
        // A signal holds the scanner on its channel, as a transmission would.
        const current = used[this.scanCursor % used.length]
        if (this.receivingOn?.(current)) return this.glg(current, true)
        this.scanCursor = (this.scanCursor + 1) % used.length
        return this.glg(used[this.scanCursor], false)
      }
      case 'KEY': {
        if (this.inProgramMode) return 'KEY,NG'
        const mode = this.scanMode
        if (args.length !== 2 || args[1] !== 'P' || !mode) return err()
        const key = args[0]
        if (key === 'S') {
          this.scanMode = { kind: 'scanning' }
          this.typed = ''
        } else if (key === 'H') {
          if (mode.kind === 'scanning') {
            const used = this.scanList()
            this.scanMode = { kind: 'hold', channel: used.length === 0 ? 1 : used[this.scanCursor % used.length] }
          } else {
            const channel = /^[0-9]+$/.test(this.typed) ? Number(this.typed) : null
            if (channel !== null && channel >= 1 && channel <= CHANNEL_COUNT && !isEmptyChannel(channelAt(config, channel))) {
              this.scanMode = { kind: 'hold', channel }
            } else if (this.typed === '') {
              this.scanMode = { kind: 'scanning' }
            }
            this.typed = ''
          }
        } else if (/^[0-9]$/.test(key)) {
          if (mode.kind === 'scanning') {
            // While scanning, a number key turns its bank (0 = 10) on or off.
            const bank = Number(key) === 0 ? 10 : Number(key)
            config.bankScanEnabled[bank - 1] = !config.bankScanEnabled[bank - 1]
          } else {
            this.typed += key
          }
        } else {
          return err()
        }
        return ok()
      }
      case 'VOL':
      case 'SQL': {
        const current = command === 'VOL' ? settings.volume : settings.squelch
        if (isGet) return `${command},${current}`
        const value = wireInt(args[0], LEVEL_RANGE)
        if (value === null) return err()
        if (command === 'VOL') settings.volume = value
        else settings.squelch = value
        return ok()
      }
      case 'DCH': {
        const number = args.length > 0 ? wireInt(args[0], [1, 500]) : null
        if (number === null) return err()
        config.channels[number - 1] = emptyChannel()
        return ok()
      }
      case 'CIN':
        return this.channel(args)
      case 'GLF': {
        if (!isGet) {
          this.lockoutCursor = 0
          return ok()
        }
        if (this.lockoutCursor >= config.globalLockouts.length) return 'GLF,-1'
        return `GLF,${wireValue(config.globalLockouts[this.lockoutCursor++])}`
      }
      case 'LOF':
      case 'ULF': {
        const frequency = args.length > 0 ? frequencyFromWire(args[0]) : null
        if (frequency === null || !planContains(this.bandPlan, frequency)) return err()
        if (command === 'ULF') config.globalLockouts = config.globalLockouts.filter((f) => f !== frequency)
        else if (!config.globalLockouts.includes(frequency) && config.globalLockouts.length < MAX_GLOBAL_LOCKOUTS) {
          // Measured: a full list still replies OK but drops the new entry.
          config.globalLockouts.push(frequency)
        }
        return ok()
      }
      case 'CLR':
        this.config = makeConfig()
        return ok()
      default:
        return 'ERR'
    }
  }

  /** A `GLG` reply for sitting on `channel`. */
  private glg(channel: number, receiving: boolean): string {
    const c = channelAt(this.config, channel)
    // The scanner never stores commas in names; test data sometimes has them.
    const name = c.name.replaceAll(',', ' ')
    return `GLG,${c.frequency === null ? '' : wireValue(c.frequency)},${c.modulation},,${c.tone},,,${name},${receiving ? 1 : 0},${receiving ? 0 : 1},,${channel},`
  }

  private mask(command: string, args: string[]): string {
    const config = this.config
    const current = command === 'SCG' ? config.bankScanEnabled : command === 'SSG' ? config.search.serviceGroupsEnabled : config.search.customRanges.map((r) => r.enabled)
    if (args.length === 0) return `${command},${invertedMask(current)}`
    // Measured: all-disabled masks are accepted, despite Uniden's spec.
    let flags: boolean[]
    try {
      flags = enabledFlagsFromInvertedMask(args[0], 10, command)
    } catch {
      return `${command},ERR`
    }
    if (command === 'SCG') config.bankScanEnabled = flags
    else if (command === 'SSG') config.search.serviceGroupsEnabled = flags
    else flags.forEach((enabled, i) => (config.search.customRanges[i].enabled = enabled))
    return `${command},OK`
  }

  private channel(args: string[]): string {
    const number = args.length > 0 ? wireInt(args[0], [1, 500]) : null
    if (number === null) return 'CIN,ERR'
    const config = this.config
    if (args.length === 1) {
      const c = channelAt(config, number)
      return ['CIN', `${number}`, c.name, c.frequency === null ? '00000000' : wireValue(c.frequency), c.modulation, `${c.tone}`, `${c.delay}`, wireFlag(c.lockedOut), wireFlag(c.priority)].join(',')
    }
    if (args.length < 8) return 'CIN,ERR'
    const channel = { ...channelAt(config, number) }
    const tail = args.slice(-6)
    const name = args.slice(1, args.length - 6).join(',')
    // Empty fields leave the value unchanged; every non-empty field must be valid or nothing changes.
    if (name !== '') channel.name = namePrefix(name, MAX_NAME_LENGTH).replace(/ +$/, '')
    if (tail[0] !== '') {
      const frequency = frequencyFromWire(tail[0])
      const stored = frequency === null ? null : storedValue(this.bandPlan, frequency)
      if (stored === null) return 'CIN,ERR'
      channel.frequency = stored
    }
    if (tail[1] !== '') {
      if (!isModulation(tail[1])) return 'CIN,ERR'
      channel.modulation = tail[1]
    }
    if (tail[2] !== '') {
      const code = wireInt(tail[2])
      const tone = code === null ? null : toneFromCode(code)
      if (tone === null) return 'CIN,ERR'
      channel.tone = tone
    }
    if (tail[3] !== '') {
      const value = wireInt(tail[3])
      const delay = value === null ? null : delayFromNumber(value)
      if (delay === null) return 'CIN,ERR'
      channel.delay = delay
    }
    if (tail[4] !== '') {
      const value = wireBool(tail[4])
      if (value === null) return 'CIN,ERR'
      channel.lockedOut = value
    }
    if (tail[5] !== '') {
      const value = wireBool(tail[5])
      if (value === null) return 'CIN,ERR'
      channel.priority = value
    }
    // Measured: only one priority channel per bank; setting one clears the others.
    if (channel.priority) {
      for (const other of channelsInBank(bankOfChannel(number))) {
        if (other !== number) config.channels[other - 1] = { ...channelAt(config, other), priority: false }
      }
    }
    config.channels[number - 1] = channel
    return 'CIN,OK'
  }
}

/** A fake scanner for tests. `respond` maps each command line to the line sent back, or none. */
export class MockTransport implements LineTransport {
  readonly sent: string[] = []
  private replies: string[] = []
  private readonly respond: (line: string) => string | null

  constructor(respond: (line: string) => string | null) {
    this.respond = respond
  }

  async writeLine(line: string) {
    this.sent.push(line)
    const reply = this.respond(line)
    if (reply !== null) this.replies.push(reply)
  }

  async readLine(): Promise<string> {
    const reply = this.replies.shift()
    if (reply === undefined) throw new TransportError('timedOut')
    return reply
  }

  async drainInput() {
    this.replies = []
  }

  async close() {}
}
