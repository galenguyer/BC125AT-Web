import { channelsInBank, delayFromNumber, emptyChannel, isModulation, makeChannel, modulationName, type Channel, type Delay } from '../model/channel'
import { BANK_COUNT, CHANNEL_COUNT, makeConfig, type ScannerConfig } from '../model/config'
import { frequencyFromHertz, hertzOf, type Frequency } from '../model/frequency'
import { bandPlanName, closeCallBands, serviceSearchGroupNames, type Backlight, type CloseCallMode, type KeyBeep, type PriorityMode } from '../model/settings'
import { toneFromUnidenName, unidenToneName } from '../model/tone'

/**
 * Files from Uniden's BC125AT programming software, `.bc125at_ss` (SPEC.md §5.1).
 *
 * Tab-separated text with CRLF line endings, one record per line: `Misc`, `Priority`, `WxPri`,
 * 10 × `Service`, 10 × `Custom`, `CloseCall`, `CloseCallBands`, `GeneralSearch`, then for each bank
 * a `Conventional` line followed by its 50 `C-Freq` channel lines.
 *
 * Quirks:
 * - `Conventional`, `Service` and `Custom` On/Off are the scanner's raw mask digits, so **On means
 *   disabled**. `CloseCallBands` On/Off are the right way round.
 * - Frequencies are in hertz; the scanner works in 100 Hz.
 * - The files have no global lockouts.
 */
export const UNIDEN_EXTENSION = 'bc125at_ss'

export class UnidenImportError extends Error {
  readonly line: number | null

  constructor(line: number | null, message?: string) {
    super(line === null ? "This isn't a file from Uniden's BC125AT software." : `Line ${line} of the file can't be read: ${message}`)
    this.name = 'UnidenImportError'
    this.line = line
  }
}

const backlightNames: [string, Backlight][] = [
  ['On', 'AO'],
  ['Off', 'AF'],
  ['K+S', 'KS'],
  // Not yet seen in a file from Uniden's software; named like "K+S".
  ['Key', 'KY'],
  ['Squelch', 'SQ'],
]
const keyBeepNames: [string, KeyBeep][] = [
  ['Auto', 0],
  ['Off', 99],
]
const priorityNames: [string, PriorityMode][] = [
  ['Off', 0],
  ['On', 1],
  ['Plus', 2],
  ['DND', 3],
]
const closeCallModeNames: [string, CloseCallMode][] = [
  ['Off', 0],
  ['Pri', 1],
  ['DND', 2],
  // Not yet seen in a file from Uniden's software; named like the others.
  ['Only', 3],
]
const bandPlanNames: [string, 0 | 1][] = [
  ['USA', 0],
  ['Canada', 1],
]
const serviceNames = ['Police', 'Fire/Emergency', 'HAM Radio', 'Marine', 'Railroad', 'Civil Air', 'Military Air', 'CB Radio', 'FRS/GMRS/MURS', 'Racing']
const defaultBankName = (bank: number) => `Bank ${bank}`
const nameOf = <T>(value: T, names: [string, T][]) => names.find(([, v]) => v === value)![0]

class FieldReader {
  private position = 1
  private readonly fields: string[]
  private readonly line: number

  constructor(fields: string[], line: number) {
    this.fields = fields
    this.line = line
  }

  private fail(message: string): never {
    throw new UnidenImportError(this.line, message)
  }

  text(what: string): string {
    if (this.position >= this.fields.length) this.fail(`the ${what} is missing`)
    return this.fields[this.position++]
  }

  value<T>(names: [string, T][], what: string): T {
    const text = this.text(what)
    const found = names.find(([name]) => name === text)
    if (!found) this.fail(`“${text}” isn't a known ${what}`)
    return found[1]
  }

  onOff(what: string): boolean {
    return this.value<boolean>(
      [
        ['On', true],
        ['Off', false],
      ],
      what,
    )
  }

  integer(what: string): number {
    const text = this.text(what)
    if (!/^[+-]?[0-9]+$/.test(text)) this.fail(`“${text}” isn't a number (${what})`)
    return Number(text)
  }

  index(lower: number, upper: number, what: string): number {
    const value = this.integer(what)
    if (value < lower || value > upper) this.fail(`${what} ${value} is out of range`)
    return value
  }

  frequency(what: string): Frequency {
    const hertz = this.integer(what)
    if (hertz < 0 || hertz % 100 !== 0) this.fail(`${hertz} Hz isn't a whole number of 100 Hz steps (${what})`)
    return frequencyFromHertz(hertz)
  }

  delay(): Delay {
    const seconds = this.integer('delay')
    const delay = delayFromNumber(seconds)
    if (delay === null) this.fail(`${seconds} isn't a scanner delay`)
    return delay
  }

  channel(): Channel {
    const name = this.text('name')
    const frequency = this.frequency('frequency')
    const modulationText = this.text('modulation')
    const modulation = modulationText.toUpperCase()
    if (!isModulation(modulation)) this.fail(`“${modulationText}” isn't a known modulation`)
    const toneText = this.text('tone')
    const tone = toneFromUnidenName(toneText)
    if (tone === null) this.fail(`“${toneText}” isn't a known tone`)
    const lockedOut = this.onOff('lockout')
    const delay = this.delay()
    const priority = this.onOff('priority')
    // Frequency 0 is an empty channel, whatever else the line says.
    if (frequency <= 0) return emptyChannel()
    return makeChannel({ name, frequency, modulation, tone, delay, lockedOut, priority })
  }

  finish() {
    if (this.position < this.fields.length) this.fail(`it has ${this.fields.length - this.position} more fields than expected`)
  }
}

/**
 * Reads a whole configuration. Global lockouts come back empty, since the format has none. Any
 * value the format isn't known to use stops the import rather than being guessed.
 */
export function decodeUniden(text: string): ScannerConfig {
  const lines = text.split(/\r\n|\r|\n/)
  const config = makeConfig()
  let sawMisc = false
  lines.forEach((line, index) => {
    if (line === '') return
    const number = index + 1
    const fields = line.split('\t')
    const r = new FieldReader(fields, number)
    const s = config.settings
    switch (fields[0]) {
      case 'Misc':
        sawMisc = true
        s.backlight = r.value(backlightNames, 'backlight')
        s.keyBeep = r.value(keyBeepNames, 'key beep')
        s.keyLock = r.onOff('key lock')
        s.contrast = r.integer('contrast')
        s.batteryChargeHours = r.integer('battery charge time')
        s.volume = r.integer('volume')
        s.squelch = r.integer('squelch')
        s.bandPlan = r.value(bandPlanNames, 'band plan')
        break
      case 'Priority':
        s.priorityMode = r.value(priorityNames, 'priority mode')
        break
      case 'WxPri':
        s.weatherAlertPriority = r.onOff('weather priority')
        break
      case 'Service': {
        const group = r.index(1, serviceSearchGroupNames.length, 'service group')
        r.text('name')
        config.search.serviceGroupsEnabled[group - 1] = !r.onOff('service group')
        break
      }
      case 'Custom': {
        const range = r.index(1, config.search.customRanges.length, 'custom range')
        r.text('name')
        const lower = r.frequency('lower frequency')
        const upper = r.frequency('upper frequency')
        const disabled = r.onOff('custom range')
        config.search.customRanges[range - 1] = { lower, upper, enabled: !disabled }
        break
      }
      case 'CloseCall':
        config.closeCall.mode = r.value(closeCallModeNames, 'Close Call mode')
        config.closeCall.alertBeep = r.onOff('alert beep')
        config.closeCall.alertLight = r.onOff('alert light')
        config.closeCall.scanHits = r.onOff('Close Call scan hits')
        break
      case 'CloseCallBands':
        config.closeCall.bandsEnabled = closeCallBands.map((band) => r.onOff(band.name))
        break
      case 'GeneralSearch':
        config.search.delay = r.delay()
        config.search.codeSearch = r.onOff('code search')
        break
      case 'Conventional': {
        const bank = r.index(1, BANK_COUNT, 'bank')
        const name = r.text('bank name')
        config.bankNames[bank - 1] = name === defaultBankName(bank) ? '' : name
        config.bankScanEnabled[bank - 1] = !r.onOff('bank scan')
        break
      }
      case 'C-Freq': {
        const channel = r.index(1, CHANNEL_COUNT, 'channel')
        config.channels[channel - 1] = r.channel()
        break
      }
      default:
        throw new UnidenImportError(number, `unknown record “${fields[0]}”`)
    }
    r.finish()
  })
  if (!sawMisc) throw new UnidenImportError(null)
  return config
}

/**
 * Writes a file Uniden's software can open. Bank names that are empty become Uniden's defaults
 * ("Bank 1"); custom search ranges get Uniden's default names.
 */
export function encodeUniden(config: ScannerConfig): string {
  const lines: string[] = []
  // A tab or line break inside a name would split the record, so those become spaces.
  const add = (...fields: (string | number)[]) => lines.push(fields.map((f) => `${f}`.replace(/[\t\r\n]/g, ' ')).join('\t'))
  const onOff = (on: boolean) => (on ? 'On' : 'Off')
  const s = config.settings
  add('Misc', nameOf(s.backlight, backlightNames), nameOf(s.keyBeep, keyBeepNames), onOff(s.keyLock), s.contrast, s.batteryChargeHours, s.volume, s.squelch, bandPlanName(s.bandPlan))
  add('Priority', nameOf(s.priorityMode, priorityNames))
  add('WxPri', onOff(s.weatherAlertPriority))
  serviceNames.forEach((name, i) => add('Service', i + 1, name, onOff(!config.search.serviceGroupsEnabled[i])))
  config.search.customRanges.forEach((range, i) => add('Custom', i + 1, `Search Bnak${i + 1}`, hertzOf(range.lower), hertzOf(range.upper), onOff(!range.enabled)))
  const cc = config.closeCall
  add('CloseCall', nameOf(cc.mode, closeCallModeNames), onOff(cc.alertBeep), onOff(cc.alertLight), onOff(cc.scanHits))
  lines.push(['CloseCallBands', ...cc.bandsEnabled.map(onOff)].join('\t'))
  add('GeneralSearch', config.search.delay, onOff(config.search.codeSearch))
  for (let bank = 1; bank <= BANK_COUNT; bank++) {
    const name = config.bankNames[bank - 1]
    add('Conventional', bank, name === '' ? defaultBankName(bank) : name, onOff(!config.bankScanEnabled[bank - 1]))
    for (const number of channelsInBank(bank)) {
      const channel = config.channels[number - 1]
      if (channel.frequency === null) add('C-Freq', number, '', 0, 'Auto', 'Off', 'On', 2, 'Off')
      else add('C-Freq', number, channel.name, hertzOf(channel.frequency), modulationName(channel.modulation), unidenToneName(channel.tone), onOff(channel.lockedOut), channel.delay, onOff(channel.priority))
    }
  }
  return lines.map((line) => `${line}\r\n`).join('')
}
