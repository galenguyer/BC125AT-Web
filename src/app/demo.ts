import { makeChannel, type Channel, type Modulation } from '../kit/model/channel'
import { makeConfig } from '../kit/model/config'
import { parseFrequency } from '../kit/model/frequency'
import { parseTone, TONE_NONE } from '../kit/model/tone'
import { MockScanner } from '../kit/transport/mockScanner'

/** Made-up channels for the demo scanner, by bank. */
const banks: [number, [string, string, Modulation, string?][]][] = [
  [1, [['GUARD', '121.5', 'AM'], ['TOWER', '118.3', 'AM'], ['GROUND', '121.9', 'AM'], ['ATIS', '127.25', 'AM'], ['APPROACH', '124.6', 'AM'], ['UNICOM', '122.8', 'AM']]],
  [2, [['FIRE DISP', '154.43', 'NFM', '123.0'], ['FIRE TAC 1', '154.28', 'NFM'], ['EMS', '155.34', 'NFM', 'D265'], ['MED 8', '463.175', 'NFM']]],
  [3, [['PD MAIN', '460.025', 'NFM', '127.3'], ['PD TAC', '460.175', 'NFM', '127.3'], ['SHERIFF', '155.115', 'NFM']]],
  [4, [['WX1', '162.55', 'FM'], ['WX2', '162.4', 'FM'], ['WX3', '162.475', 'FM']]],
  [5, [['MARINE 16', '156.8', 'FM'], ['MARINE 9', '156.45', 'FM'], ['MARINE 22A', '157.1', 'FM']]],
  [6, [['FRS 1', '462.5625', 'NFM'], ['FRS 2', '462.5875', 'NFM'], ['GMRS 15', '462.55', 'NFM'], ['MURS 1', '151.82', 'NFM']]],
  [7, [['2M CALL', '146.52', 'FM'], ['70CM CALL', '446.0', 'NFM'], ['REPEATER', '147.06', 'FM', '100.0']]],
  [8, [['RAIL AAR 2', '160.23', 'NFM'], ['RAIL AAR 7', '160.32', 'NFM']]],
]

export function demoConfig() {
  const config = makeConfig()
  for (const [bank, channels] of banks) {
    channels.forEach(([name, frequency, modulation, tone], i) => {
      const channel: Channel = makeChannel({
        name,
        frequency: parseFrequency(frequency),
        modulation,
        tone: tone ? (parseTone(tone) ?? TONE_NONE) : TONE_NONE,
      })
      config.channels[(bank - 1) * 50 + i] = channel
    })
  }
  config.channels[1] = { ...config.channels[1], priority: true }
  config.bankScanEnabled[7] = false
  config.globalLockouts = [parseFrequency('155.115')!, parseFrequency('462.675')!]
  config.settings.volume = 6
  config.settings.squelch = 3
  config.settings.contrast = 9
  config.search.customRanges[0] = { ...config.search.customRanges[0], enabled: false }
  return config
}

/**
 * A simulated scanner that scans its channels, stops now and then on a "transmission" for a few
 * seconds, and answers every command as the real one does.
 */
export function makeDemoScanner(): MockScanner {
  const scanner = new MockScanner(demoConfig())
  scanner.scanMode = { kind: 'scanning' }
  scanner.latencyMs = 2
  let transmitting: { channel: number; until: number } | null = null
  let quietUntil = performance.now() + 4000
  scanner.receivingOn = (channel) => {
    const now = performance.now()
    if (transmitting && now < transmitting.until) return transmitting.channel === channel
    if (transmitting) {
      transmitting = null
      quietUntil = now + 3000 + Math.random() * 6000
    }
    if (now >= quietUntil && Math.random() < 0.15) {
      transmitting = { channel, until: now + 1500 + Math.random() * 4000 }
      return true
    }
    return false
  }
  return scanner
}
