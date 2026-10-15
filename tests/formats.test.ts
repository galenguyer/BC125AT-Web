import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { emptyChannel, makeChannel } from '../src/kit/model/channel'
import { channelAt, cloneConfig, makeConfig } from '../src/kit/model/config'
import { ctcssTenthsHz, ctcssTone, dcsCodes, dcsTone, TONE_NO_TONE, TONE_SEARCH } from '../src/kit/model/tone'
import { validateChannel } from '../src/kit/model/validation'
import { channelsFromClipboard, clipboardText } from '../src/kit/formats/clipboard'
import { CSVImportError, exportCSV, importCSV } from '../src/kit/formats/csv'
import { decodeNative, encodeNative, NativeReadError } from '../src/kit/formats/native'
import { decodeUniden, encodeUniden, UnidenImportError } from '../src/kit/formats/uniden'
import { f, sampleConfig } from './sample'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/golden/${name}`, import.meta.url), 'utf8')

describe('Native format', () => {
  it('round-trips', () => {
    const config = sampleConfig()
    config.metadata = { model: 'BC125AT', firmware: 'Version 1.06.06', readAt: '2026-10-12T19:00:00Z', notes: 'Test' }
    const text = encodeNative(config)
    expect(decodeNative(text)).toEqual(config)
    expect(text).toContain('"format" : "net.k9fgt.bc125at.config"')
    expect(text).toContain('"frequency" : "162.5500"')
    expect(text).toContain('"tone" : "D036"')
    expect(text).not.toContain('"channel" : 3,')
  })

  it('reads files without a band plan as USA', () => {
    const config = sampleConfig()
    config.settings.bandPlan = 1
    const text = encodeNative(config)
    expect(text).toContain('"bandPlan" : 1')
    expect(decodeNative(text.replace('"bandPlan" : 1,', '')).settings.bandPlan).toBe(0)
  })

  it('rejects other files', () => {
    expect(() => decodeNative('{}')).toThrow(new NativeReadError('notABC125ATFile'))
    expect(() => decodeNative('not json')).toThrow(new NativeReadError('notABC125ATFile'))
    expect(() => decodeNative('{"format":"net.k9fgt.bc125at.config","version":99}')).toThrow(new NativeReadError('newerVersion', 99))
  })

  it('reports where a file is damaged', () => {
    const text = encodeNative(sampleConfig()).replace('"162.5500"', '"lots"')
    expect(() => decodeNative(text)).toThrow(/lots.*channels/)
  })

  it('saves Scan Hits under its old key', () => {
    const config = makeConfig()
    config.closeCall.mode = 3
    config.closeCall.scanHits = true
    const text = encodeNative(config)
    expect(text).toContain('"lockOutHits" : true')
    expect(decodeNative(text).closeCall.scanHits).toBe(true)
  })

  /** Written by the macOS app's own `bc125at-cli convert` (1.5.1) from the Uniden sample. */
  it('matches the macOS app byte for byte', () => {
    const golden = fixture('uniden-sample.bc125at')
    const fromUniden = decodeUniden(fixture('uniden-sample.bc125at_ss'))
    expect(encodeNative(fromUniden)).toBe(golden)
    expect(encodeNative(decodeNative(golden))).toBe(golden)
    // The web app's own file, with metadata, notes and lockouts, re-encoded by the macOS app.
    expect(fixture('web-sample-macos-roundtrip.bc125at')).toBe(fixture('web-sample.bc125at'))
  })

  it('reads files written by the macOS app', () => {
    const config = decodeNative(fixture('uniden-sample.bc125at'))
    expect(channelAt(config, 2)).toEqual(makeChannel({ name: 'TALKAROUND', frequency: f('155.475'), modulation: 'NFM', tone: ctcssTone(ctcssTenthsHz.indexOf(1109)), delay: -10 }))
    expect(config.bankNames[1]).toBe('Fire')
    expect(config.settings.bandPlan).toBe(1)
  })
})

describe('CSV', () => {
  it('round-trips channels', () => {
    const config = sampleConfig()
    const csv = exportCSV(config)
    expect(csv.startsWith('Channel,Bank,Name,Frequency,Modulation,Tone,Delay,Lockout,Priority\r\n1,1,Air Guard,121.5000,AM,CSQ,2,No,No\r\n')).toBe(true)
    expect(csv).toContain('2,1,"NOAA ""1"", main",162.5500,FM,No Tone,2,No,Yes')
    const imported = importCSV(csv)
    expect(imported.problems).toEqual([])
    expect(imported.channels.map((c) => c.number)).toEqual([1, 2, 75, 500])
    for (const { number, channel } of imported.channels) expect(channel).toEqual(channelAt(config, number))
  })

  it("imports bc125py's export", () => {
    const csv = [
      'Index,Name,Frequency (MHz),Modulation,CTCSS,Delay (sec),Lockout,Priority',
      '1,AAR HOTD,452.9375,nfm,none,2,unlocked,off',
      '2,Pri,162.4000,fm,ctcss_100.0,-5,locked,on',
      '3,,000.0000,auto,none,2,unlocked,off',
      '4,Bad,999.0,fm,none,2,unlocked,off',
    ].join('\n')
    const imported = importCSV(csv)
    expect(imported.channels.length).toBe(4)
    expect(imported.channels[0].channel).toEqual(makeChannel({ name: 'AAR HOTD', frequency: f('452.9375'), modulation: 'NFM' }))
    expect(imported.channels[1].channel.tone).toBe(ctcssTone(12))
    expect(imported.channels[1].channel.lockedOut && imported.channels[1].channel.priority).toBe(true)
    expect(imported.channels[2].channel).toEqual(emptyChannel())
    expect(validateChannel(imported.channels[3].channel).some((i) => i.severity === 'error')).toBe(true)
  })

  it('reports bad rows', () => {
    const imported = importCSV('Channel,Frequency,Tone\n1,162.55,banana\n600,162.55,none\n2,162.55,none\n')
    expect(imported.channels.map((c) => c.number)).toEqual([2])
    expect(imported.problems.map((p) => p.line)).toEqual([2, 3])
    expect(() => importCSV('Channel,Name\n1,A\n')).toThrow(new CSVImportError(['Frequency']))
  })
})

describe('Clipboard', () => {
  it('round-trips', () => {
    const config = sampleConfig()
    const channels = [channelAt(config, 1), channelAt(config, 2), emptyChannel(), channelAt(config, 75)]
    const text = clipboardText(channels)
    expect(text.startsWith('Name\tFrequency\tModulation\tTone\tDelay\tLockout\tPriority\nAir Guard\t121.5000\tAM\tCSQ\t2\tNo\tNo\n')).toBe(true)
    expect(channelsFromClipboard(text)).toEqual(channels)
  })

  it('pastes from spreadsheets without headers', () => {
    expect(channelsFromClipboard('Tower\t118.3\tAM\n\tnot a frequency\n')).toBeNull()
    const ok = channelsFromClipboard('Tower\t118.3\tAM\nGround\t121.9\tAM\n')
    expect(ok?.map((c) => c.name)).toEqual(['Tower', 'Ground'])
    expect(ok?.every((c) => !c.lockedOut)).toBe(true)
  })

  it('pastes a column of frequencies', () => {
    expect(channelsFromClipboard('162.4\n162.425\n162.45\n')?.map((c) => c.frequency)).toEqual([f('162.4'), f('162.425'), f('162.45')])
  })
})

describe('Uniden format', () => {
  const sample = fixture('uniden-sample.bc125at_ss')

  it("reads Uniden's layout", () => {
    const config = decodeUniden(sample)
    expect(config.settings.backlight).toBe('KS')
    expect(config.settings.keyBeep).toBe(99)
    expect(config.settings.batteryChargeHours).toBe(14)
    expect(config.settings.priorityMode).toBe(2)
    expect(config.settings.weatherAlertPriority).toBe(true)
    expect(config.settings.bandPlan).toBe(1)
    // Bank, service group and custom range On/Off are raw mask digits: On means disabled.
    expect(config.bankScanEnabled[0]).toBe(false)
    expect(config.bankScanEnabled[1]).toBe(true)
    expect(config.search.serviceGroupsEnabled[0]).toBe(false)
    expect(config.search.serviceGroupsEnabled[1]).toBe(true)
    expect(config.search.customRanges[0].enabled).toBe(true)
    expect(config.search.customRanges[4].enabled).toBe(false)
    expect(config.search.customRanges[4].upper).toBe(1_369_916)
    // Close Call bands are the right way round.
    expect(config.closeCall.bandsEnabled).toEqual([false, true, false, true, false])
    expect(config.closeCall.mode).toBe(1)
    expect(config.closeCall.alertLight).toBe(false)
    expect(config.search.delay).toBe(-5)
    expect(config.search.codeSearch).toBe(true)
    // Uniden's default bank names mean "no name".
    expect(config.bankNames[0]).toBe('')
    expect(config.bankNames[1]).toBe('Fire')
    expect(channelAt(config, 1)).toEqual(makeChannel({ name: 'GUARD', frequency: f('121.5'), modulation: 'AM', delay: 5, priority: true }))
    expect(channelAt(config, 2).tone).toBe(ctcssTone(ctcssTenthsHz.indexOf(1109)))
    expect(channelAt(config, 2).delay).toBe(-10)
    expect(channelAt(config, 3)).toEqual(emptyChannel())
    expect(channelAt(config, 51).tone).toBe(dcsTone(dcsCodes.indexOf(265)))
    expect(channelAt(config, 51).lockedOut).toBe(true)
    expect(channelAt(config, 52).tone).toBe(TONE_SEARCH)
    expect(channelAt(config, 53).tone).toBe(TONE_NO_TONE)
    expect(channelAt(config, 53).modulation).toBe('FM')
    expect(config.globalLockouts).toEqual([])
  })

  it('round-trips', () => {
    const config = sampleConfig()
    config.bankNames[3] = 'Tab\tin name'
    const decoded = decodeUniden(encodeUniden(config))
    const expected = cloneConfig(config)
    expected.globalLockouts = []
    expected.bankNames[3] = 'Tab in name'
    expect(decoded).toEqual(expected)
    expect(encodeUniden(decoded)).toBe(encodeUniden(config))
  })

  it("writes Uniden's layout", () => {
    const lines = encodeUniden(makeConfig()).split('\r\n')
    expect(lines.length).toBe(1 + 2 + 10 + 10 + 3 + 10 + 500 + 1)
    expect(lines.at(-1)).toBe('')
    expect(lines[0]).toBe('Misc\tKey\tAuto\tOff\t8\t9\t8\t2\tUSA')
    expect(lines[13]).toBe('Custom\t1\tSearch Bnak1\t25000000\t27995000\tOff')
    expect(lines[26]).toBe('Conventional\t1\tBank 1\tOff')
    expect(lines[29]).toBe('C-Freq\t3\t\t0\tAuto\tOff\tOn\t2\tOff')
  })

  it("refuses values it doesn't know", () => {
    expect(() => decodeUniden(sample.replace('C110.9', 'C111.1'))).toThrow(new UnidenImportError(13, '“C111.1” isn\'t a known tone'))
    expect(() => decodeUniden(`${sample}Trunk\t1\tOn\r\n`)).toThrow(new UnidenImportError(19, 'unknown record “Trunk”'))
    expect(() => decodeUniden('C-Freq\t1\tX\t121500000\tAM\tOff\tOff\t2\tOff\r\n')).toThrow(new UnidenImportError(null))
  })

  /** The web app's export of the sample, converted by the macOS app's CLI, comes back identical. */
  it('matches the macOS app', () => {
    expect(encodeUniden(decodeNative(fixture('web-sample.bc125at')))).toBe(fixture('web-sample.bc125at_ss'))
    expect(encodeNative(decodeUniden(fixture('web-sample.bc125at_ss')))).toBe(fixture('web-sample-from-ss.bc125at'))
  })
})
