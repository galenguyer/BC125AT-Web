import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { canadaPlan, storedValue, usaPlan } from '../src/kit/model/bandPlan'
import { makeChannel } from '../src/kit/model/channel'
import { channelAt, makeConfig, type ScannerConfig } from '../src/kit/model/config'
import { frequencyFromWire, mhz, parseFrequency, wireValue } from '../src/kit/model/frequency'
import { parseGLG } from '../src/kit/model/liveStatus'
import { allTones, ctcssTone, parseTone, toneFromCode, toneFromUnidenName, toneName, unidenToneName } from '../src/kit/model/tone'
import { validateConfig, type ValidationIssue } from '../src/kit/model/validation'

const f = (text: string) => {
  const value = parseFrequency(text)
  if (value === null) throw new Error(`bad frequency ${text}`)
  return value
}

describe('Frequency', () => {
  it.each([
    ['162.55', 1_625_500], ['162.5500', 1_625_500], ['162.55 MHz', 1_625_500], ['162.55mhz', 1_625_500],
    ['162550k', 1_625_500], ['162550 kHz', 1_625_500], ['162550000 Hz', 1_625_500], ['162550', 1_625_500],
    ['154.00625', 1_540_062], ['406.00625', 4_060_062], [' 25 ', 250_000], ['.5', 5_000], ['118.0083', 1_180_083],
  ])('parses %j', (text, hundredHz) => {
    expect(parseFrequency(text)).toBe(hundredHz)
  })

  it.each(['', 'abc', '1.2.3', '-5', '.', '162,55', '0'])('rejects %j', (text) => {
    expect(parseFrequency(text)).toBeNull()
  })

  it('wire and display', () => {
    expect(wireValue(1_625_500)).toBe('01625500')
    expect(mhz(1_625_500)).toBe('162.5500')
    expect(mhz(250_050)).toBe('25.0050')
    expect(frequencyFromWire('01625500')).toBe(1_625_500)
    expect(frequencyFromWire('1625500')).toBe(1_625_500)
    expect(frequencyFromWire('016255OO')).toBeNull()
  })
})

describe('ToneCode', () => {
  it('every code round-trips', () => {
    expect(allTones.length).toBe(3 + 50 + 104)
    for (const tone of allTones) {
      expect(toneFromCode(tone)).toBe(tone)
      expect(parseTone(toneName(tone))).toBe(tone)
      expect(toneFromUnidenName(unidenToneName(tone))).toBe(tone)
    }
  })

  it('code table matches the spec', () => {
    expect(toneName(64)).toBe('CTCSS 67.0')
    expect(toneName(76)).toBe('CTCSS 100.0')
    expect(toneName(113)).toBe('CTCSS 254.1')
    expect(toneName(128)).toBe('DCS 023')
    expect(toneName(231)).toBe('DCS 754')
    for (const invalid of [1, 63, 114, 126, 232, 239, 241]) expect(toneFromCode(invalid)).toBeNull()
  })

  it.each([
    ['100.0', 76], ['100', 76], ['ctcss_100.0', 76], ['CTCSS 100.0 Hz', 76], ['D023', 128], ['dcs_23', 128],
    ['023N', 128], ['none', 0], ['CSQ', 0], ['No Tone', 240], ['search', 127],
  ])('parses shorthand %j', (text, code) => {
    expect(parseTone(text)).toBe(code)
  })
})

describe('BandPlan', () => {
  it('predicts every value measured on the scanner', () => {
    const text = readFileSync(new URL('./fixtures/step-measurements.csv', import.meta.url), 'utf8')
    const lines = text.split('\n').filter((line) => line !== '' && !line.startsWith('#')).slice(1)
    const failures: string[] = []
    for (const line of lines) {
      const [sentText, storedText] = line.split(',')
      const sent = Number(sentText)
      const expected = storedText.trim() === 'ERR' ? null : Number(storedText)
      const predicted = storedValue(usaPlan, sent)
      if (predicted !== expected) failures.push(`${mhz(sent)} → expected ${expected === null ? 'ERR' : mhz(expected)}, predicted ${predicted === null ? 'ERR' : mhz(predicted)}`)
    }
    expect(lines.length).toBeGreaterThan(19_000)
    expect(failures.slice(0, 10)).toEqual([])
  })

  it('ranges and examples', () => {
    const stored = (text: string) => {
      const value = storedValue(usaPlan, f(text))
      return value === null ? null : mhz(value)
    }
    expect(stored('162.5510')).toBe('162.5475')
    expect(stored('162.5050')).toBe('162.5050')
    expect(stored('118.0050')).toBe('118.0083')
    expect(stored('406.0050')).toBe('406.0062')
    expect(stored('173.2037')).toBe('173.2037')
    expect(stored('512')).toBe('512.0000')
    expect(stored('512.01')).toBeNull()
    expect(stored('60')).toBeNull()
    expect(stored('24.9995')).toBeNull()
  })

  it('canada', () => {
    const stored = (text: string) => {
      const value = storedValue(canadaPlan, f(text))
      return value === null ? null : mhz(value)
    }
    expect(stored('154.0062')).toBe('154.0050')
    expect(stored('155.0012')).toBe('155.0000')
    expect(stored('165.0030')).toBe('165.0050')
    expect(stored('162.5475')).toBe('162.5500')
    expect(stored('173.2037')).toBe('173.2050')
    expect(stored('118.0050')).toBe('118.0083')
    expect(stored('406.0050')).toBe('406.0062')
    expect(stored('60')).toBeNull()
  })
})

function config(edit: (config: ScannerConfig) => void): ScannerConfig {
  const result = makeConfig()
  edit(result)
  return result
}

const at = (issue: ValidationIssue, number: number) => issue.location.kind === 'channel' && issue.location.number === number

describe('Validation', () => {
  it('a fresh document is clean', () => {
    expect(validateConfig(makeConfig())).toEqual([])
  })

  it('channel problems', () => {
    const issues = validateConfig(
      config((c) => {
        c.channels[0] = makeChannel({ name: 'TWELVE34567890123', frequency: f('162.55') })
        c.channels[1] = makeChannel({ name: 'A,B', frequency: f('60') })
        c.channels[2] = makeChannel({ name: 'Café ', frequency: f('162.551') })
      }),
    )
    expect(issues.some((i) => at(i, 1) && i.severity === 'error' && i.message.includes('17 characters'))).toBe(true)
    expect(issues.some((i) => at(i, 2) && i.message.includes('commas'))).toBe(true)
    expect(issues.some((i) => at(i, 2) && i.message.includes('outside'))).toBe(true)
    expect(issues.some((i) => at(i, 3) && i.message.includes('ASCII'))).toBe(true)
    expect(issues.some((i) => at(i, 3) && i.severity === 'warning' && i.message.includes('162.5475'))).toBe(true)
    expect(issues.some((i) => at(i, 3) && i.message.includes('Trailing'))).toBe(true)
  })

  it('one priority channel per bank', () => {
    const issues = validateConfig(
      config((c) => {
        c.channels[50] = makeChannel({ frequency: f('150'), priority: true })
        c.channels[59] = makeChannel({ frequency: f('151'), priority: true })
        c.channels[0] = makeChannel({ frequency: f('152'), priority: true })
      }),
    )
    expect(issues.filter((i) => i.severity === 'error').map((i) => i.location)).toEqual([
      { kind: 'channel', number: 51 },
      { kind: 'channel', number: 60 },
    ])
  })

  it('settings and limits', () => {
    const issues = validateConfig(
      config((c) => {
        c.settings.contrast = 20
        c.settings.batteryChargeHours = 0
        c.bankScanEnabled = Array(10).fill(false)
        c.search.customRanges[0].lower = f('60')
        c.globalLockouts = Array.from({ length: 101 }, (_, i) => 4_500_000 + i * 125)
      }),
    )
    expect(issues.some((i) => i.location.kind === 'settings' && i.message.includes('Contrast'))).toBe(true)
    expect(issues.some((i) => i.location.kind === 'settings' && i.message.includes('Battery'))).toBe(true)
    expect(issues.some((i) => i.location.kind === 'bank' && i.severity === 'warning')).toBe(true)
    expect(issues.some((i) => i.location.kind === 'search' && i.message.includes('range 1'))).toBe(true)
    expect(issues.some((i) => i.location.kind === 'globalLockouts' && i.message.includes('101'))).toBe(true)
  })
})

describe('Duplicate frequencies', () => {
  it('warns on every copy, naming the others', () => {
    const c = config((c) => {
      c.channels[0] = makeChannel({ name: 'GUARD', frequency: f('121.5'), modulation: 'AM' })
      c.channels[50] = makeChannel({ name: 'GUARD', frequency: f('121.5'), modulation: 'AM' })
      c.channels[100] = makeChannel({ frequency: f('121.5'), modulation: 'AM' })
      c.channels[1] = makeChannel({ name: 'Other', frequency: f('118.3'), modulation: 'AM' })
    })
    const issues = validateConfig(c)
    const messages = (number: number) => issues.filter((i) => at(i, number)).map((i) => i.message)
    expect(messages(1)).toEqual(['121.5000 MHz is also on channel 51 “GUARD” and channel 101'])
    expect(messages(51)).toEqual(['121.5000 MHz is also on channel 1 “GUARD” and channel 101'])
    expect(messages(101)).toEqual(['121.5000 MHz is also on channel 1 “GUARD” and channel 51 “GUARD”'])
    expect(messages(2)).toEqual([])
    expect(issues.some((i) => i.severity === 'error')).toBe(false)
    expect(validateConfig(c, { duplicateFrequencies: false }).some((i) => i.message.includes('is also on'))).toBe(false)
  })

  it('compares as stored on the scanner', () => {
    const c = config((c) => {
      c.channels[0] = makeChannel({ frequency: f('154.0062') })
      c.channels[1] = makeChannel({ frequency: f('154.0025') })
    })
    expect(validateConfig(c).some((i) => at(i, 1) && i.message === '154.0025 MHz is also on channel 2')).toBe(true)
  })

  it('lists at most four others', () => {
    const c = config((c) => {
      for (let n = 0; n < 7; n++) c.channels[n] = makeChannel({ frequency: f('162.55') })
    })
    expect(validateConfig(c).some((i) => at(i, 1) && i.message === '162.5500 MHz is also on channel 2, channel 3, channel 4, channel 5 and 2 more')).toBe(true)
  })

  it('name-only channel is warned about', () => {
    const c = config((c) => {
      c.channels[4] = makeChannel({ name: 'LATER', lockedOut: true })
    })
    expect(validateConfig(c).map((i) => i.message)).toEqual(["Has a name but no frequency, so it won't be written to the scanner"])
    expect(channelAt(c, 5).name).toBe('LATER')
  })
})

describe('LiveStatus', () => {
  it('parses a receiving channel', () => {
    const status = parseGLG('04625625,NFM,,82,,,TALKAROUND,1,0,,312,'.split(','))
    expect(status).toEqual({ frequency: 4_625_625, modulation: 'NFM', tone: 82, name: 'TALKAROUND', channel: 312, receiving: true, muted: false })
  })

  it('parses scanning and empty replies', () => {
    const hold = parseGLG('01215000,AM,,0,,,GUARD,0,1,,1,'.split(','))
    expect(hold.channel).toBe(1)
    expect(hold.receiving).toBe(false)
    expect(hold.muted).toBe(true)
    const empty = parseGLG(',,,,,,,,,,,'.split(','))
    expect(empty.frequency).toBeNull()
    expect(empty.channel).toBeNull()
    expect(empty.modulation).toBeNull()
    expect(ctcssTone(18)).toBe(82)
  })
})
