import { delayFromNumber, isEmptyChannel, isModulation, makeChannel, emptyChannel, type Channel, type Delay } from '../model/channel'
import { BANK_COUNT, CHANNEL_COUNT, makeConfig, type Metadata, type ScannerConfig } from '../model/config'
import { mhz, parseFrequency, sortedUnique, type Frequency } from '../model/frequency'
import {
  backlights,
  bandPlanRegions,
  closeCallModes,
  keyBeeps,
  priorityModes,
  type CloseCallSettings,
  type CustomSearchRange,
  type SearchSettings,
  type SystemSettings,
} from '../model/settings'
import { toneFromUnidenName, unidenToneName } from '../model/tone'

/**
 * The `.bc125at` document format (SPEC.md §5), shared with the macOS app: JSON with a format tag
 * and version. Only non-empty channels are stored, each with its channel number. The text is
 * written exactly as the macOS app's `JSONEncoder` writes it (sorted keys, `" : "`, two-space
 * indents), so files from either app are byte-for-byte alike.
 */
export const FORMAT_IDENTIFIER = 'net.k9fgt.bc125at.config'
export const CURRENT_VERSION = 1
export const NATIVE_EXTENSION = 'bc125at'

export type NativeReadErrorKind = 'notABC125ATFile' | 'newerVersion' | 'invalid'

export class NativeReadError extends Error {
  readonly kind: NativeReadErrorKind

  constructor(kind: NativeReadErrorKind, detail: string | number = '') {
    super(
      kind === 'notABC125ATFile'
        ? "This isn't a BC125AT CPS file."
        : kind === 'newerVersion'
          ? `This file was saved by a newer version of BC125AT CPS (format ${detail}).`
          : `The file is damaged: ${detail}`,
    )
    this.name = 'NativeReadError'
    this.kind = kind
  }
}

// MARK: Encoding

type JSONValue = string | number | boolean | JSONValue[] | { [key: string]: JSONValue }

/** Swift's `JSONEncoder` with `.prettyPrinted` and `.sortedKeys`. */
function swiftJSON(value: JSONValue, indent = ''): string {
  const inner = `${indent}  `
  if (Array.isArray(value)) {
    if (value.length === 0) return `[\n\n${indent}]`
    return `[\n${value.map((item) => inner + swiftJSON(item, inner)).join(',\n')}\n${indent}]`
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort()
    if (keys.length === 0) return `{\n\n${indent}}`
    return `{\n${keys.map((key) => `${inner}${JSON.stringify(key)} : ${swiftJSON(value[key], inner)}`).join(',\n')}\n${indent}}`
  }
  return JSON.stringify(value)
}

function channelJSON(channel: Channel): { [key: string]: JSONValue } {
  const result: { [key: string]: JSONValue } = {
    delay: channel.delay,
    lockedOut: channel.lockedOut,
    modulation: channel.modulation,
    name: channel.name,
    priority: channel.priority,
    tone: unidenToneName(channel.tone),
  }
  if (channel.frequency !== null) result.frequency = mhz(channel.frequency)
  return result
}

export function encodeNative(config: ScannerConfig): string {
  const metadata: { [key: string]: JSONValue } = { notes: config.metadata.notes }
  if (config.metadata.model !== null) metadata.model = config.metadata.model
  if (config.metadata.firmware !== null) metadata.firmware = config.metadata.firmware
  if (config.metadata.readAt !== null) metadata.readAt = config.metadata.readAt
  const s = config.settings
  const file: JSONValue = {
    format: FORMAT_IDENTIFIER,
    version: CURRENT_VERSION,
    metadata,
    settings: {
      backlight: s.backlight,
      keyBeep: s.keyBeep,
      keyLock: s.keyLock,
      contrast: s.contrast,
      batteryChargeHours: s.batteryChargeHours,
      priorityMode: s.priorityMode,
      weatherAlertPriority: s.weatherAlertPriority,
      volume: s.volume,
      squelch: s.squelch,
      bandPlan: s.bandPlan,
    },
    search: {
      delay: config.search.delay,
      codeSearch: config.search.codeSearch,
      serviceGroupsEnabled: config.search.serviceGroupsEnabled,
      customRanges: config.search.customRanges.map((r) => ({ lower: mhz(r.lower), upper: mhz(r.upper), enabled: r.enabled })),
    },
    closeCall: {
      mode: config.closeCall.mode,
      alertBeep: config.closeCall.alertBeep,
      alertLight: config.closeCall.alertLight,
      bandsEnabled: config.closeCall.bandsEnabled,
      // Saved under its old name, which had the meaning backwards; the stored value is unchanged.
      lockOutHits: config.closeCall.scanHits,
    },
    banks: Array.from({ length: BANK_COUNT }, (_, i) => ({ bank: i + 1, name: config.bankNames[i], scanEnabled: config.bankScanEnabled[i] })),
    globalLockouts: config.globalLockouts.map(mhz),
    channels: config.channels.flatMap((channel, offset) => (isEmptyChannel(channel) ? [] : [{ channel: offset + 1, ...channelJSON(channel) }])),
  }
  return swiftJSON(file)
}

// MARK: Decoding

/** Reads typed values out of parsed JSON, naming the path of anything wrong as Swift's decoder does. */
class Reader {
  readonly value: unknown
  readonly path: string

  constructor(value: unknown, path = '') {
    this.value = value
    this.path = path
  }

  fail(message: string): never {
    throw new NativeReadError('invalid', `${message} at ${this.path === '' ? 'top level' : this.path}`)
  }

  private object(): Record<string, unknown> {
    if (typeof this.value !== 'object' || this.value === null || Array.isArray(this.value)) this.fail('Expected an object')
    return this.value as Record<string, unknown>
  }

  has(key: string): boolean {
    const value = this.object()[key]
    return value !== undefined && value !== null
  }

  key(key: string): Reader {
    const object = this.object()
    const path = `${this.path}.${key}`
    if (!(key in object) || object[key] === null) new Reader(undefined, path).fail(`No value for key "${key}"`)
    return new Reader(object[key], path)
  }

  optional(key: string): Reader | null {
    return this.has(key) ? this.key(key) : null
  }

  items(): Reader[] {
    if (!Array.isArray(this.value)) this.fail('Expected an array')
    return (this.value as unknown[]).map((item, i) => new Reader(item, `${this.path}[${i}]`))
  }

  string(): string {
    if (typeof this.value !== 'string') this.fail('Expected a string')
    return this.value as string
  }

  bool(): boolean {
    if (typeof this.value !== 'boolean') this.fail('Expected a boolean')
    return this.value as boolean
  }

  int(): number {
    if (typeof this.value !== 'number' || !Number.isInteger(this.value)) this.fail('Expected an integer')
    return this.value as number
  }

  oneOf<T extends string | number>(values: readonly T[], what: string): T {
    const found = values.find((v) => v === this.value)
    if (found === undefined) this.fail(`Cannot initialize ${what} from invalid value ${JSON.stringify(this.value)}`)
    return found
  }

  frequency(): Frequency {
    const text = this.string()
    const value = parseFrequency(text.endsWith('MHz') ? text : `${text} MHz`)
    if (value === null) this.fail(`Invalid frequency ${JSON.stringify(text)}`)
    return value
  }

  delay(): Delay {
    const delay = delayFromNumber(this.int())
    if (delay === null) this.fail(`Cannot initialize Delay from invalid value ${JSON.stringify(this.value)}`)
    return delay
  }
}

function readChannel(r: Reader): Channel {
  const defaults = makeChannel()
  const modulationText = r.optional('modulation')?.string() ?? defaults.modulation
  const modulation = isModulation(modulationText)
    ? modulationText
    : r.key('modulation').fail(`Cannot initialize Modulation from invalid value ${JSON.stringify(modulationText)}`)
  let tone = defaults.tone
  const toneReader = r.optional('tone')
  if (toneReader) {
    const text = toneReader.string()
    tone = toneFromUnidenName(text) ?? toneReader.fail(`Invalid tone ${JSON.stringify(text)}`)
  }
  return {
    name: r.optional('name')?.string() ?? defaults.name,
    frequency: r.optional('frequency')?.frequency() ?? null,
    modulation,
    tone,
    delay: r.optional('delay')?.delay() ?? defaults.delay,
    lockedOut: r.optional('lockedOut')?.bool() ?? defaults.lockedOut,
    priority: r.optional('priority')?.bool() ?? defaults.priority,
  }
}

function readSettings(r: Reader): SystemSettings {
  return {
    backlight: r.key('backlight').oneOf(backlights, 'Backlight'),
    keyBeep: r.key('keyBeep').oneOf(keyBeeps, 'KeyBeep'),
    keyLock: r.key('keyLock').bool(),
    contrast: r.key('contrast').int(),
    batteryChargeHours: r.key('batteryChargeHours').int(),
    priorityMode: r.key('priorityMode').oneOf(priorityModes, 'PriorityMode'),
    weatherAlertPriority: r.key('weatherAlertPriority').bool(),
    volume: r.key('volume').int(),
    squelch: r.key('squelch').int(),
    // The app's backups from before `BPL` was read don't have it; the scanner was on USA then.
    bandPlan: r.optional('bandPlan')?.oneOf(bandPlanRegions, 'BandPlanRegion') ?? 0,
  }
}

function readSearch(r: Reader): SearchSettings {
  return {
    delay: r.key('delay').delay(),
    codeSearch: r.key('codeSearch').bool(),
    serviceGroupsEnabled: r.key('serviceGroupsEnabled').items().map((item) => item.bool()),
    customRanges: r.key('customRanges').items().map((item): CustomSearchRange => ({
      lower: item.key('lower').frequency(),
      upper: item.key('upper').frequency(),
      enabled: item.key('enabled').bool(),
    })),
  }
}

function readCloseCall(r: Reader): CloseCallSettings {
  return {
    mode: r.key('mode').oneOf(closeCallModes, 'CloseCallMode'),
    alertBeep: r.key('alertBeep').bool(),
    alertLight: r.key('alertLight').bool(),
    bandsEnabled: r.key('bandsEnabled').items().map((item) => item.bool()),
    scanHits: r.key('lockOutHits').bool(),
  }
}

function readMetadata(r: Reader): Metadata {
  return {
    model: r.optional('model')?.string() ?? null,
    firmware: r.optional('firmware')?.string() ?? null,
    readAt: r.optional('readAt')?.string() ?? null,
    notes: r.key('notes').string(),
  }
}

export function decodeNative(text: string): ScannerConfig {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new NativeReadError('notABC125ATFile')
  }
  if (typeof json !== 'object' || json === null) throw new NativeReadError('notABC125ATFile')
  const header = json as Record<string, unknown>
  if (header.format !== FORMAT_IDENTIFIER || typeof header.version !== 'number') throw new NativeReadError('notABC125ATFile')
  if (header.version > CURRENT_VERSION) throw new NativeReadError('newerVersion', header.version)

  const r = new Reader(json)
  const metadata = readMetadata(r.key('metadata'))
  const settings = readSettings(r.key('settings'))
  const search = readSearch(r.key('search'))
  const closeCall = readCloseCall(r.key('closeCall'))
  const banks = r.key('banks').items().map((b) => ({ bank: b.key('bank').int(), name: b.key('name').string(), scanEnabled: b.key('scanEnabled').bool() }))
  const globalLockouts = r.key('globalLockouts').items().map((item) => item.frequency())
  const channels = r.key('channels').items().map((item) => ({ number: item.key('channel').int(), channel: readChannel(item) }))

  if (search.serviceGroupsEnabled.length !== 10 || search.customRanges.length !== 10 || closeCall.bandsEnabled.length !== 5) {
    throw new NativeReadError('invalid', 'search or Close Call settings have the wrong number of entries')
  }
  const config = makeConfig()
  config.settings = settings
  config.search = search
  config.closeCall = closeCall
  config.globalLockouts = sortedUnique(globalLockouts)
  config.metadata = metadata
  for (const bank of banks) {
    if (bank.bank < 1 || bank.bank > BANK_COUNT) throw new NativeReadError('invalid', `bank ${bank.bank} doesn't exist`)
    config.bankNames[bank.bank - 1] = bank.name
    config.bankScanEnabled[bank.bank - 1] = bank.scanEnabled
  }
  for (const { number, channel } of channels) {
    if (number < 1 || number > CHANNEL_COUNT) throw new NativeReadError('invalid', `channel ${number} doesn't exist`)
    config.channels[number - 1] = isEmptyChannel(channel) ? emptyChannel() : channel
  }
  return config
}
