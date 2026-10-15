import { planContains, storedValue, type BandPlan, usaPlan } from './bandPlan'
import { channelsInBank, isEmptyChannel, MAX_NAME_LENGTH, nameLength, type Channel } from './channel'
import { BANK_COUNT, channelAt, channelPlan, MAX_GLOBAL_LOCKOUTS, type ScannerConfig } from './config'
import { mhz, type Frequency } from './frequency'
import { BATTERY_CHARGE_RANGE, CONTRAST_RANGE, inClosedRange, LEVEL_RANGE } from './settings'

/** `warning` is advisory; writing is still allowed. `error` blocks writing to the scanner. */
export type Severity = 'warning' | 'error'

export type IssueLocation =
  | { kind: 'channel'; number: number }
  | { kind: 'bank'; bank: number }
  | { kind: 'settings' }
  | { kind: 'search' }
  | { kind: 'closeCall' }
  | { kind: 'globalLockouts' }

export interface ValidationIssue {
  severity: Severity
  location: IssueLocation
  message: string
}

export function locationTitle(location: IssueLocation): string {
  switch (location.kind) {
    case 'channel':
      return `Channel ${location.number}`
    case 'bank':
      return `Bank ${location.bank}`
    case 'settings':
      return 'Settings'
    case 'search':
      return 'Search'
    case 'closeCall':
      return 'Close Call'
    case 'globalLockouts':
      return 'Global Lockouts'
  }
}

export interface ValidateOptions {
  /** Checks frequencies against this plan, or the configuration's own `channelPlan` if omitted. */
  bandPlan?: BandPlan
  /** Turns the duplicate-frequency warnings on or off. */
  duplicateFrequencies?: boolean
}

/** Every problem in the configuration, in channel order then section order (SPEC.md §3, §4). */
export function validateConfig(config: ScannerConfig, options: ValidateOptions = {}): ValidationIssue[] {
  const plan = options.bandPlan ?? channelPlan(config)
  const duplicateFrequencies = options.duplicateFrequencies ?? true
  const issues: ValidationIssue[] = []
  const add = (severity: Severity, location: IssueLocation, message: string) => issues.push({ severity, location, message })

  // Duplicate frequencies are allowed (the same channel in several banks is common), but
  // flagged on each copy, as Uniden's software does. Compared as stored, so two values that
  // snap to the same channel count as duplicates.
  const duplicates = new Map<number, string>()
  if (duplicateFrequencies) {
    const byFrequency = new Map<Frequency, number[]>()
    config.channels.forEach((channel, offset) => {
      if (channel.frequency === null) return
      const key = storedValue(plan, channel.frequency) ?? channel.frequency
      const list = byFrequency.get(key)
      if (list) list.push(offset + 1)
      else byFrequency.set(key, [offset + 1])
    })
    for (const [frequency, numbers] of byFrequency) {
      if (numbers.length < 2) continue
      for (const number of numbers) {
        const others = numbers.filter((n) => n !== number)
        const list = others.slice(0, 4).map((other) => {
          const name = channelAt(config, other).name
          return name === '' ? `channel ${other}` : `channel ${other} “${name}”`
        })
        if (others.length > 4) list.push(`${others.length - 4} more`)
        const joined = list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
        duplicates.set(number, `${mhz(frequency)} MHz is also on ${joined}`)
      }
    }
  }

  config.channels.forEach((channel, offset) => {
    if (isEmptyChannel(channel) && channel.name === '') return
    const location: IssueLocation = { kind: 'channel', number: offset + 1 }
    for (const issue of validateChannel(channel, plan)) add(issue.severity, location, issue.message)
    const duplicate = duplicates.get(offset + 1)
    if (duplicate) add('warning', location, duplicate)
  })

  // The scanner keeps only one priority channel per bank; setting another clears the first.
  for (let bank = 1; bank <= BANK_COUNT; bank++) {
    const priority = channelsInBank(bank).filter((n) => {
      const channel = channelAt(config, n)
      return !isEmptyChannel(channel) && channel.priority
    })
    if (priority.length > 1) {
      for (const number of priority) {
        add('error', { kind: 'channel', number }, `Bank ${bank} has ${priority.length} priority channels (${priority.join(', ')}); the scanner allows one`)
      }
    }
  }
  if (!config.bankScanEnabled.includes(true)) {
    add('warning', { kind: 'bank', bank: 1 }, 'Every bank is disabled, so Scan mode has nothing to scan')
  }

  const settings = config.settings
  if (!inClosedRange(CONTRAST_RANGE, settings.contrast)) add('error', { kind: 'settings' }, 'Contrast must be 1–15 (the scanner ignores other values)')
  if (!inClosedRange(BATTERY_CHARGE_RANGE, settings.batteryChargeHours)) add('error', { kind: 'settings' }, 'Battery charge time must be 1–16 hours')
  if (!inClosedRange(LEVEL_RANGE, settings.volume)) add('error', { kind: 'settings' }, 'Volume must be 0–15')
  if (!inClosedRange(LEVEL_RANGE, settings.squelch)) add('error', { kind: 'settings' }, 'Squelch must be 0–15')

  if (!config.search.serviceGroupsEnabled.includes(true)) add('warning', { kind: 'search' }, 'Every service search group is disabled')
  if (!config.search.customRanges.some((range) => range.enabled)) add('warning', { kind: 'search' }, 'Every custom search range is disabled')
  config.search.customRanges.forEach((range, offset) => {
    const label = `Custom search range ${offset + 1}`
    if (!planContains(plan, range.lower)) add('error', { kind: 'search' }, `${label}: lower limit ${mhz(range.lower)} MHz is outside the scanner's bands`)
    if (!planContains(plan, range.upper)) add('error', { kind: 'search' }, `${label}: upper limit ${mhz(range.upper)} MHz is outside the scanner's bands`)
    if (range.lower > range.upper) add('error', { kind: 'search' }, `${label}: lower limit is above the upper limit`)
  })

  if (config.globalLockouts.length > MAX_GLOBAL_LOCKOUTS) {
    add('error', { kind: 'globalLockouts' }, `${config.globalLockouts.length} global lockouts; the scanner holds ${MAX_GLOBAL_LOCKOUTS} and silently drops the rest`)
  }
  for (const frequency of config.globalLockouts) {
    if (!planContains(plan, frequency)) add('error', { kind: 'globalLockouts' }, `Lockout ${mhz(frequency)} MHz is outside the scanner's bands`)
  }
  return issues
}

/** Problems with this channel on its own (bank-level rules are in `validateConfig`). */
export function validateChannel(channel: Channel, plan: BandPlan = usaPlan): { severity: Severity; message: string }[] {
  const issues: { severity: Severity; message: string }[] = []
  const length = nameLength(channel.name)
  if (length > MAX_NAME_LENGTH) issues.push({ severity: 'error', message: `Name is ${length} characters; the scanner keeps ${MAX_NAME_LENGTH}` })
  if (channel.name.includes(',')) issues.push({ severity: 'error', message: "Names can't contain commas" })
  if ([...channel.name].some((c) => c.codePointAt(0)! < 0x20 || c.codePointAt(0)! > 0x7e)) {
    issues.push({ severity: 'error', message: 'Names can only use plain ASCII characters' })
  }
  if (channel.name.endsWith(' ')) issues.push({ severity: 'warning', message: 'Trailing spaces in the name will be removed by the scanner' })
  if (channel.frequency === null && channel.name !== '') {
    issues.push({ severity: 'warning', message: "Has a name but no frequency, so it won't be written to the scanner" })
  }
  if (channel.frequency !== null) {
    const stored = storedValue(plan, channel.frequency)
    if (stored === null) {
      issues.push({ severity: 'error', message: `${mhz(channel.frequency)} MHz is outside the scanner's bands (25–54, 108–174, 225–380, 400–512 MHz)` })
    } else if (stored !== channel.frequency) {
      issues.push({ severity: 'warning', message: `${mhz(channel.frequency)} MHz isn't on the scanner's channel plan; it will be stored as ${mhz(stored)} MHz` })
    }
  }
  return issues
}
