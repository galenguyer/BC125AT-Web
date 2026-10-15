import { makeChannel } from '../src/kit/model/channel'
import { makeConfig, type ScannerConfig } from '../src/kit/model/config'
import { parseFrequency } from '../src/kit/model/frequency'
import { ctcssTone, dcsTone, TONE_NO_TONE } from '../src/kit/model/tone'

export function f(text: string): number {
  const value = parseFrequency(text)
  if (value === null) throw new Error(`bad frequency ${text}`)
  return value
}

/** A configuration with something non-default in every section (as in the Swift tests). */
export function sampleConfig(): ScannerConfig {
  const config = makeConfig()
  config.channels[0] = makeChannel({ name: 'Air Guard', frequency: f('121.5'), modulation: 'AM' })
  config.channels[1] = makeChannel({ name: 'NOAA "1", main', frequency: f('162.55'), modulation: 'FM', tone: TONE_NO_TONE, priority: true })
  config.channels[74] = makeChannel({ name: '', frequency: f('462.5625'), modulation: 'NFM', tone: dcsTone(5), delay: -5, lockedOut: true })
  config.channels[499] = makeChannel({ name: 'Last', frequency: f('406.0125'), tone: ctcssTone(12), delay: 0 })
  config.bankScanEnabled[2] = false
  config.bankNames[0] = 'Aviation'
  config.settings.backlight = 'KS'
  config.settings.keyBeep = 99
  config.settings.contrast = 11
  config.settings.priorityMode = 3
  config.settings.volume = 3
  config.search.delay = -10
  config.search.codeSearch = true
  config.search.serviceGroupsEnabled[4] = false
  config.search.customRanges[9].enabled = false
  config.search.customRanges[0].upper = f('26')
  config.closeCall.mode = 1
  config.closeCall.bandsEnabled = [false, true, false, true, false]
  config.globalLockouts = [f('155.1'), f('460.025')]
  return config
}
