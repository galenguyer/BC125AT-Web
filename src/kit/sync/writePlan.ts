import { storedValue, type BandPlan } from '../model/bandPlan'
import { channelsEqual, delayName, emptyChannel, isEmptyChannel, MAX_NAME_LENGTH, modulationName, namePrefix, type Channel } from '../model/channel'
import { CHANNEL_COUNT, channelAt, channelPlan, cloneConfig, deepEqual, type ScannerConfig } from '../model/config'
import { mhz, sortedUnique, wireValue } from '../model/frequency'
import { backlightName, bandPlanName, closeCallBands, closeCallModeName, keyBeepName, priorityModeName, serviceSearchGroupNames, type CloseCallSettings } from '../model/settings'
import { TONE_NONE, toneName } from '../model/tone'
import { commandWritingChannel, invertedMask, wireFlag } from '../protocol/wire'

/**
 * What the scanner will actually hold after this configuration is written (SPEC.md §3):
 * frequencies snapped to the band plan, names cut to 16 characters with trailing spaces removed,
 * and empty channels in the scanner's empty state. App-only fields are unchanged.
 */
export function storedOnScanner(config: ScannerConfig, bandPlan?: BandPlan): ScannerConfig {
  const plan = bandPlan ?? channelPlan(config)
  const result = cloneConfig(config)
  result.channels = result.channels.map((channel) => {
    if (channel.frequency === null) return emptyChannel()
    return {
      ...channel,
      frequency: storedValue(plan, channel.frequency) ?? channel.frequency,
      name: namePrefix(channel.name, MAX_NAME_LENGTH).replace(/ +$/, ''),
    }
  })
  result.globalLockouts = sortedUnique(config.globalLockouts)
  return result
}

export type WriteSection = 'Settings' | 'Banks' | 'Search & Close Call' | 'Channels' | 'Global Lockouts'
export const writeSections: readonly WriteSection[] = ['Settings', 'Banks', 'Search & Close Call', 'Channels', 'Global Lockouts']

export interface WriteStep {
  id: number
  section: WriteSection
  /** What is changing: `Channel 12`, `Backlight`. */
  title: string
  /** `Keypress → Always On`. */
  detail: string
  command: string
}

/**
 * Where the configuration as stored on the scanner differs from the document as written
 * (frequency snapping, name trimming), so the document can be updated to match.
 */
export interface Adjustment {
  title: string
  detail: string
}

/** The commands that turn the scanner's current configuration into a target one (SPEC.md §7). */
export interface WritePlan {
  steps: WriteStep[]
  /** The configuration the scanner should hold afterwards. */
  target: ScannerConfig
  adjustments: Adjustment[]
}

const onOff = (value: boolean) => (value ? 'On' : 'Off')
const quoted = (text: string) => JSON.stringify(text)

/**
 * Predicts stored frequencies with `bandPlan`, or the document's own `channelPlan` if omitted.
 *
 * Volume and squelch are never written: they're the listener's to change at any time, on the
 * scanner or in the live bar, so the target keeps the scanner's current levels (§7).
 */
export function makeWritePlan(current: ScannerConfig, document: ScannerConfig, bandPlan?: BandPlan): WritePlan {
  const target = storedOnScanner(document, bandPlan)
  target.settings.volume = current.settings.volume
  target.settings.squelch = current.settings.squelch
  const steps: WriteStep[] = []
  const add = (section: WriteSection, title: string, detail: string, command: string) =>
    steps.push({ id: steps.length, section, title, detail, command })
  function change<T>(old: T, value: T, describe: (v: T) => string): string | null {
    return deepEqual(old, value) ? null : `${describe(old)} → ${describe(value)}`
  }

  // Settings. The band plan goes first: it changes how channel frequencies are stored (SPEC.md §3.5).
  const s0 = current.settings
  const s1 = target.settings
  let d: string | null
  if ((d = change(s0.bandPlan, s1.bandPlan, bandPlanName))) add('Settings', 'Band plan', d, `BPL,${s1.bandPlan}`)
  if ((d = change(s0.backlight, s1.backlight, (b) => backlightName[b]))) add('Settings', 'Backlight', d, `BLT,${s1.backlight}`)
  if ((d = change(s0.batteryChargeHours, s1.batteryChargeHours, (h) => `${h} h`))) add('Settings', 'Battery charge time', d, `BSV,${s1.batteryChargeHours}`)
  if (s0.keyBeep !== s1.keyBeep || s0.keyLock !== s1.keyLock) {
    add(
      'Settings',
      'Key beep and lock',
      `Beep ${keyBeepName(s0.keyBeep)}, Lock ${onOff(s0.keyLock)} → Beep ${keyBeepName(s1.keyBeep)}, Lock ${onOff(s1.keyLock)}`,
      `KBP,${s1.keyBeep},${wireFlag(s1.keyLock)}`,
    )
  }
  if ((d = change(s0.priorityMode, s1.priorityMode, (m) => priorityModeName[m]))) add('Settings', 'Priority mode', d, `PRI,${s1.priorityMode}`)
  if ((d = change(s0.contrast, s1.contrast, (c) => `${c}`))) add('Settings', 'Contrast', d, `CNT,${s1.contrast}`)
  if ((d = change(s0.weatherAlertPriority, s1.weatherAlertPriority, onOff))) add('Settings', 'Weather alert priority', d, `WXS,${wireFlag(s1.weatherAlertPriority)}`)

  // Banks
  if ((d = change(current.bankScanEnabled, target.bankScanEnabled, describeBanks))) {
    add('Banks', 'Banks scanned', d, `SCG,${invertedMask(target.bankScanEnabled)}`)
  }

  // Search and Close Call
  const r0 = current.search
  const r1 = target.search
  if (r0.delay !== r1.delay || r0.codeSearch !== r1.codeSearch) {
    add(
      'Search & Close Call',
      'Search delay and code search',
      `Delay ${delayName(r0.delay)}, Code Search ${onOff(r0.codeSearch)} → Delay ${delayName(r1.delay)}, Code Search ${onOff(r1.codeSearch)}`,
      `SCO,${r1.delay},${wireFlag(r1.codeSearch)}`,
    )
  }
  if ((d = change(r0.serviceGroupsEnabled, r1.serviceGroupsEnabled, (e) => describeEnabled(e, serviceSearchGroupNames)))) {
    add('Search & Close Call', 'Service search groups', d, `SSG,${invertedMask(r1.serviceGroupsEnabled)}`)
  }
  const rangeNames = Array.from({ length: 10 }, (_, i) => `${i + 1}`)
  const enabled0 = r0.customRanges.map((r) => r.enabled)
  const enabled1 = r1.customRanges.map((r) => r.enabled)
  if ((d = change(enabled0, enabled1, (e) => describeEnabled(e, rangeNames)))) {
    add('Search & Close Call', 'Custom search ranges enabled', d, `CSG,${invertedMask(enabled1)}`)
  }
  for (let index = 0; index < 10; index++) {
    const a = r0.customRanges[index]
    const b = r1.customRanges[index]
    if (a.lower !== b.lower || a.upper !== b.upper) {
      add(
        'Search & Close Call',
        `Custom search range ${index + 1}`,
        `${mhz(a.lower)}–${mhz(a.upper)} → ${mhz(b.lower)}–${mhz(b.upper)} MHz`,
        `CSP,${index + 1},${wireValue(b.lower)},${wireValue(b.upper)}`,
      )
    }
  }
  const c0 = current.closeCall
  const c1 = target.closeCall
  if (!deepEqual(c0, c1)) {
    const bands = c1.bandsEnabled.map((on) => (on ? '1' : '0')).join('')
    add(
      'Search & Close Call',
      'Close Call',
      `${describeCloseCall(c0)} → ${describeCloseCall(c1)}`,
      `CLC,${c1.mode},${wireFlag(c1.alertBeep)},${wireFlag(c1.alertLight)},${bands},${wireFlag(c1.scanHits)}`,
    )
  }

  // Channels. Setting a priority channel clears the bank's others, so priority channels go last.
  const changed: number[] = []
  for (let n = 1; n <= CHANNEL_COUNT; n++) {
    if (!channelsEqual(channelAt(current, n), channelAt(target, n))) changed.push(n)
  }
  const priorityKey = (n: number) => (channelAt(target, n).priority ? 1 : 0)
  changed.sort((a, b) => priorityKey(a) - priorityKey(b) || a - b)
  for (const number of changed) {
    add('Channels', `Channel ${number}`, describeChange(channelAt(current, number), channelAt(target, number)), commandWritingChannel(channelAt(target, number), number))
  }

  // Global lockouts: removals first, so there's room for additions.
  const l0 = new Set(current.globalLockouts)
  const l1 = new Set(target.globalLockouts)
  for (const f of sortedUnique([...l0].filter((x) => !l1.has(x)))) add('Global Lockouts', 'Remove lockout', `${mhz(f)} MHz`, `ULF,${wireValue(f)}`)
  for (const f of sortedUnique([...l1].filter((x) => !l0.has(x)))) add('Global Lockouts', 'Add lockout', `${mhz(f)} MHz`, `LOF,${wireValue(f)}`)

  const adjustments: Adjustment[] = []
  for (let number = 1; number <= CHANNEL_COUNT; number++) {
    const a = channelAt(document, number)
    const b = channelAt(target, number)
    if (a.frequency !== null && b.frequency !== null && a.frequency !== b.frequency) {
      adjustments.push({ title: `Channel ${number}`, detail: `${mhz(a.frequency)} MHz will be stored as ${mhz(b.frequency)} MHz` })
    }
    if (!isEmptyChannel(a) && a.name !== b.name) {
      adjustments.push({ title: `Channel ${number}`, detail: `Name ${quoted(a.name)} will be stored as ${quoted(b.name)}` })
    }
  }
  return { steps, target, adjustments }
}

export const stepsInSection = (plan: WritePlan, section: WriteSection) => plan.steps.filter((s) => s.section === section)

// MARK: Descriptions

export function describeChange(old: Channel, value: Channel): string {
  if (isEmptyChannel(value)) return `Clear (was ${describeChannel(old)})`
  if (isEmptyChannel(old)) return describeChannel(value)
  const parts: string[] = []
  if (old.name !== value.name) parts.push(`Name ${quoted(old.name)} → ${quoted(value.name)}`)
  if (old.frequency !== value.frequency) {
    parts.push(`Frequency ${old.frequency === null ? '' : mhz(old.frequency)} → ${value.frequency === null ? '' : mhz(value.frequency)} MHz`)
  }
  if (old.modulation !== value.modulation) parts.push(`Modulation ${modulationName(old.modulation)} → ${modulationName(value.modulation)}`)
  if (old.tone !== value.tone) parts.push(`Tone ${toneName(old.tone)} → ${toneName(value.tone)}`)
  if (old.delay !== value.delay) parts.push(`Delay ${delayName(old.delay)} → ${delayName(value.delay)}`)
  if (old.lockedOut !== value.lockedOut) parts.push(value.lockedOut ? 'Locked Out' : 'Unlocked')
  if (old.priority !== value.priority) parts.push(value.priority ? 'Priority On' : 'Priority Off')
  return parts.join(', ')
}

export function describeChannel(channel: Channel): string {
  if (channel.frequency === null) return 'Empty'
  let text = channel.name === '' ? '' : `${channel.name} `
  text += `${mhz(channel.frequency)} MHz ${modulationName(channel.modulation)}`
  if (channel.tone !== TONE_NONE) text += `, ${toneName(channel.tone)}`
  if (channel.lockedOut) text += ', Locked Out'
  if (channel.priority) text += ', Priority'
  return text
}

function describeBanks(enabled: boolean[]): string {
  const banks = enabled.flatMap((on, i) => (on ? [`${i + 1}`] : []))
  return banks.length === 0 ? 'None' : banks.join(', ')
}

function describeEnabled(enabled: boolean[], names: readonly string[]): string {
  const on = enabled.flatMap((value, i) => (value ? [names[i]] : []))
  if (on.length === enabled.length) return 'All'
  return on.length === 0 ? 'None' : on.join(', ')
}

function describeCloseCall(cc: CloseCallSettings): string {
  const bands = describeEnabled(cc.bandsEnabled, closeCallBands.map((b) => b.name))
  return `${closeCallModeName[cc.mode]} (Beep ${onOff(cc.alertBeep)}, Light ${onOff(cc.alertLight)}, Bands ${bands}, Scan Hits ${onOff(cc.scanHits)})`
}
