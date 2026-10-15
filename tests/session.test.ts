import { beforeAll, describe, expect, it } from 'vitest'
import { rangesOnlyPlan, storedValue } from '../src/kit/model/bandPlan'
import { emptyChannel, isEmptyChannel, makeChannel } from '../src/kit/model/channel'
import { channelAt, cloneConfig, makeConfig } from '../src/kit/model/config'
import { validateConfig } from '../src/kit/model/validation'
import { ScannerConnection } from '../src/kit/protocol/connection'
import { scanTiming, type ScanMode } from '../src/kit/sync/scanMode'
import { CancellationError, ScannerSession, SessionError, writeSucceeded, type Progress } from '../src/kit/sync/session'
import { makeWritePlan, stepsInSection } from '../src/kit/sync/writePlan'
import { MockScanner } from '../src/kit/transport/mockScanner'
import { canadaPlan } from '../src/kit/model/bandPlan'
import { f, sampleConfig } from './sample'

beforeAll(() => {
  Object.assign(scanTiming, { holdWindowMs: 60, holdWindowWhileReceivingMs: 200, pollMs: 5, holdCheckMs: 5 })
})

describe('WritePlan', () => {
  it('identical configs need nothing', () => {
    expect(makeWritePlan(sampleConfig(), sampleConfig()).steps).toEqual([])
  })

  it('app-only fields are ignored', () => {
    const document = sampleConfig()
    document.bankNames[3] = 'Fire'
    document.metadata.notes = 'notes'
    expect(makeWritePlan(sampleConfig(), document).steps).toEqual([])
  })

  it('off-plan values that the scanner already holds are not changes', () => {
    const scanner = makeConfig()
    scanner.channels[0] = makeChannel({ name: 'X', frequency: f('162.5475') })
    const document = cloneConfig(scanner)
    document.channels[0] = { ...document.channels[0], frequency: f('162.5510'), name: 'X  ' }
    const plan = makeWritePlan(scanner, document)
    expect(plan.steps).toEqual([])
    expect(plan.adjustments.map((a) => a.detail)).toEqual(['162.5510 MHz will be stored as 162.5475 MHz', 'Name "X  " will be stored as "X"'])
  })

  it('steps and commands', () => {
    const scanner = makeConfig()
    const document = makeConfig()
    document.settings.backlight = 'AO'
    document.settings.keyLock = true
    document.bankScanEnabled[0] = false
    document.search.customRanges[2].lower = f('30')
    document.closeCall.mode = 1
    document.channels[2] = makeChannel({ name: '', frequency: f('162.55'), modulation: 'FM' })
    document.globalLockouts = [f('460.025')]
    const plan = makeWritePlan(scanner, document)
    expect(plan.steps.map((s) => s.command)).toEqual([
      'BLT,AO', 'KBP,0,1', 'SCG,1000000000', 'CSP,3,00300000,00499950', 'CLC,1,1,1,11111,0',
      'CIN,3, ,01625500,FM,0,2,0,0', 'LOF,04600250',
    ])
    expect(stepsInSection(plan, 'Channels')[0].detail).toBe('162.5500 MHz FM')
  })

  it('clearing a channel uses DCH', () => {
    const scanner = sampleConfig()
    const document = sampleConfig()
    document.channels[74] = makeChannel({ frequency: null })
    const plan = makeWritePlan(scanner, document)
    expect(plan.steps.map((s) => s.command)).toEqual(['DCH,75'])
    expect(plan.steps[0].detail.startsWith('Clear (was 462.5625 MHz NFM')).toBe(true)
  })

  it('priority channels are written last', () => {
    const scanner = makeConfig()
    scanner.channels[0] = makeChannel({ frequency: f('150'), priority: true })
    const document = cloneConfig(scanner)
    document.channels[0] = { ...document.channels[0], priority: false }
    document.channels[1] = makeChannel({ frequency: f('151'), priority: true })
    document.channels[2] = makeChannel({ frequency: f('152') })
    expect(makeWritePlan(scanner, document).steps.map((s) => s.title)).toEqual(['Channel 1', 'Channel 3', 'Channel 2'])
  })

  it('lockout removals come first', () => {
    const scanner = makeConfig()
    scanner.globalLockouts = [f('155')]
    const document = makeConfig()
    document.globalLockouts = [f('156')]
    expect(makeWritePlan(scanner, document).steps.map((s) => s.command)).toEqual(['ULF,01550000', 'LOF,01560000'])
  })

  it('a name-only channel is not written', () => {
    const document = makeConfig()
    document.channels[4] = { ...document.channels[4], name: 'Pending' }
    expect(isEmptyChannel(channelAt(document, 5))).toBe(true)
    expect(validateConfig(document).some((i) => i.location.kind === 'channel' && i.location.number === 5 && i.severity === 'warning' && i.message.includes('no frequency'))).toBe(true)
    expect(makeWritePlan(makeConfig(), document).steps).toEqual([])
  })

  it('the ranges-only plan keeps in-range frequencies', () => {
    expect(storedValue(rangesOnlyPlan, f('154.0062'))).toBe(f('154.0062'))
    expect(storedValue(rangesOnlyPlan, f('60'))).toBeNull()
  })
})

describe('Writing', () => {
  it('writes and verifies', async () => {
    const mock = new MockScanner()
    const session = new ScannerSession(mock)
    const document = sampleConfig()
    document.channels[2] = makeChannel({ name: 'Off plan', frequency: f('162.551'), modulation: 'FM' })
    const plan = makeWritePlan(await session.readConfiguration(), document)
    const report = await session.write(plan)
    expect(writeSucceeded(report)).toBe(true)
    expect(report.written).toBe(plan.steps.length)
    expect(channelAt(report.scannerConfig, 3).frequency).toBe(f('162.5475'))
    expect(makeWritePlan(mock.config, document).steps).toEqual([])
    expect(mock.inProgramMode).toBe(false)
    expect(mock.received.at(-1)).toBe('EPG')
  })

  it('moving priority within a bank sticks', async () => {
    const scanner = makeConfig()
    scanner.channels[0] = makeChannel({ frequency: f('150'), priority: true })
    const mock = new MockScanner(cloneConfig(scanner))
    const document = cloneConfig(scanner)
    document.channels[0] = { ...document.channels[0], priority: false }
    document.channels[1] = makeChannel({ frequency: f('151'), priority: true })
    const report = await new ScannerSession(mock).write(makeWritePlan(scanner, document))
    expect(writeSucceeded(report)).toBe(true)
    expect(channelAt(mock.config, 2).priority && !channelAt(mock.config, 1).priority).toBe(true)
  })

  it('rejected steps are reported and the rest still written', async () => {
    const mock = new MockScanner()
    const document = makeConfig()
    document.channels[0] = makeChannel({ frequency: f('60') })
    document.channels[1] = makeChannel({ frequency: f('162.55') })
    const report = await new ScannerSession(mock).write(makeWritePlan(makeConfig(), document))
    expect(report.failures.map((x) => x.step.title)).toEqual(['Channel 1'])
    expect(report.mismatches.map((x) => x.title)).toEqual(['Channel 1'])
    expect(report.written).toBe(1)
    expect(channelAt(mock.config, 2).frequency).toBe(f('162.55'))
  })

  it('the Canada plan predicts with the Canada table', async () => {
    const mock = new MockScanner()
    const document = makeConfig()
    document.settings.bandPlan = 1
    document.channels[0] = makeChannel({ name: 'Off plan', frequency: f('154.0062'), modulation: 'NFM' })
    expect(validateConfig(document).some((i) => i.message.includes('stored as 154.0050'))).toBe(true)
    const plan = makeWritePlan(makeConfig(), document)
    expect(plan.steps[0].command).toBe('BPL,1')
    expect(channelAt(plan.target, 1).frequency).toBe(f('154.0050'))
    const report = await new ScannerSession(mock).write(plan)
    expect(writeSucceeded(report)).toBe(true)
    expect(report.storedDifferently).toEqual([])
    expect(channelAt(mock.config, 1).frequency).toBe(f('154.0050'))
  })

  it('reports frequencies stored differently than predicted', async () => {
    const mock = new MockScanner(makeConfig(), canadaPlan)
    const document = makeConfig()
    document.channels[0] = makeChannel({ name: 'Off plan', frequency: f('162.5475'), modulation: 'NFM' })
    document.channels[1] = makeChannel({ frequency: f('162.55') })
    const report = await new ScannerSession(mock).write(makeWritePlan(makeConfig(), document))
    expect(writeSucceeded(report)).toBe(true)
    expect(report.storedDifferently).toEqual([{ title: 'Channel 1', detail: '162.5475 MHz was stored as 162.5500 MHz' }])
    expect(channelAt(report.acceptedConfig, 1).frequency).toBe(f('162.55'))
    expect(channelAt(report.acceptedConfig, 1).name).toBe('Off plan')
    expect(channelAt(report.acceptedConfig, 2)).toEqual(channelAt(document, 2))
  })

  it('leaves volume and squelch alone', async () => {
    const scanner = sampleConfig()
    scanner.settings.volume = 12
    scanner.settings.squelch = 7
    const mock = new MockScanner(cloneConfig(scanner))
    const document = cloneConfig(scanner)
    document.settings.volume = 2
    document.settings.squelch = 0
    document.settings.contrast = 5
    const plan = makeWritePlan(scanner, document)
    expect(plan.steps.map((s) => s.command)).toEqual(['CNT,5'])
    const report = await new ScannerSession(mock).write(plan)
    expect(writeSucceeded(report)).toBe(true)
    expect(mock.received.some((line) => line.startsWith('VOL,') || line.startsWith('SQL,'))).toBe(false)
    expect(mock.config.settings.volume).toBe(12)
    expect(report.acceptedConfig.settings.squelch).toBe(7)
  })

  it('a timeout stops the write but leaves program mode', async () => {
    const mock = new MockScanner()
    mock.unresponsiveCommands.add('BLT')
    const document = makeConfig()
    document.settings.backlight = 'AO'
    await expect(new ScannerSession(mock).write(makeWritePlan(makeConfig(), document))).rejects.toMatchObject({ kind: 'timedOut' })
    expect(mock.inProgramMode).toBe(false)
  })
})

describe('ScannerSession', () => {
  it('reads everything', async () => {
    const original = sampleConfig()
    const mock = new MockScanner(cloneConfig(original))
    const progress: Progress[] = []
    const read = await new ScannerSession(mock).readConfiguration({ progress: (p) => progress.push(p) })
    const expected = cloneConfig(original)
    expected.bankNames = makeConfig().bankNames
    expected.metadata = read.metadata
    expect(read).toEqual(expected)
    expect(read.metadata.model).toBe('BC125AT')
    expect(read.metadata.firmware).toBe('Version 1.06.06')
    expect(progress.at(-1)!.completed).toBe(progress.at(-1)!.total)
    expect(mock.received.at(-1)).toBe('EPG')
    expect(mock.inProgramMode).toBe(false)
  })

  it('reads and writes the band plan', async () => {
    const canada = makeConfig()
    canada.settings.bandPlan = 1
    const mock = new MockScanner(cloneConfig(canada))
    const session = new ScannerSession(mock)
    expect((await session.readConfiguration()).settings.bandPlan).toBe(1)
    const document = sampleConfig()
    const plan = makeWritePlan(canada, document)
    expect(plan.steps[0].command).toBe('BPL,0')
    expect(plan.steps[0].detail).toBe('Canada → USA')
    expect(writeSucceeded(await session.write(plan))).toBe(true)
    expect(mock.config.settings.bandPlan).toBe(0)
  })

  it('reads Close Call Only and Scan Hits', async () => {
    const config = makeConfig()
    config.closeCall.mode = 3
    config.closeCall.scanHits = true
    const read = await new ScannerSession(new MockScanner(cloneConfig(config))).readConfiguration()
    expect(read.closeCall).toEqual(config.closeCall)
  })

  it('program mode refused', async () => {
    const mock = new MockScanner()
    mock.refusesProgramMode = true
    await expect(new ScannerSession(mock).readConfiguration()).rejects.toEqual(new SessionError('programModeRefused'))
  })

  it('leaves program mode after a timeout', async () => {
    const mock = new MockScanner()
    mock.unresponsiveCommands.add('CSP')
    await expect(new ScannerSession(mock).readConfiguration()).rejects.toMatchObject({ kind: 'timedOut' })
    expect(mock.received.at(-1)).toBe('EPG')
    expect(mock.inProgramMode).toBe(false)
  })

  it('leaves program mode when cancelled', async () => {
    const mock = new MockScanner()
    const controller = new AbortController()
    const read = new ScannerSession(mock).readConfiguration({
      signal: controller.signal,
      progress: (p) => {
        if (p.completed === 100) controller.abort()
      },
    })
    await expect(read).rejects.toBeInstanceOf(CancellationError)
    expect(mock.received.at(-1)).toBe('EPG')
    expect(mock.inProgramMode).toBe(false)
  })

  it('rejects other models', async () => {
    const mock = new MockScanner()
    mock.model = 'BCD996P2'
    await expect(new ScannerSession(mock).readConfiguration()).rejects.toEqual(new SessionError('unsupportedModel', 'BCD996P2'))
    expect(mock.received.includes('PRG')).toBe(false)
  })

  it('reads status and sets levels', async () => {
    const config = makeConfig()
    config.settings.volume = 3
    config.settings.squelch = 2
    const mock = new MockScanner(config)
    mock.glgFields = '01625500,FM,,0,,,WX,1,0,,7,'.split(',')
    const session = new ScannerSession(mock)
    expect((await session.liveStatus()).channel).toBe(7)
    expect(await session.levels()).toEqual({ volume: 3, squelch: 2 })
    await session.setVolume(9)
    await session.setSquelch(20)
    expect(await session.levels()).toEqual({ volume: 9, squelch: 15 })
    expect(mock.received.includes('PRG')).toBe(false)
  })
})

describe('MockScanner', () => {
  it('reproduces measured behaviour', async () => {
    const mock = new MockScanner()
    const connection = new ScannerConnection(mock)
    expect(await connection.send('BLT')).toBe('BLT,NG')
    await connection.enterProgramMode()
    await connection.execute('CIN,1,A,1625510,FM,0,2,0,1')
    expect(await connection.send('CIN,1')).toBe('CIN,1,A,01625475,FM,0,2,0,1')
    await connection.execute('CIN,2,B,1625500,FM,0,2,0,1')
    expect(channelAt(mock.config, 1).priority).toBe(false)
    await connection.execute('CIN,2,,1624000,,,,,')
    expect(channelAt(mock.config, 2).name).toBe('B')
    await connection.execute('CNT,20')
    expect(await connection.send('CNT')).toBe('CNT,8')
    for (let n = 0; n < 101; n++) await connection.execute(`LOF,${4_500_000 + n * 125}`)
    expect(mock.config.globalLockouts.length).toBe(100)
    expect(await connection.send('ZZZ')).toBe('ERR')
    await connection.execute('DCH,1')
    expect(channelAt(mock.config, 1)).toEqual(emptyChannel())
  })
})

describe('Scan mode', () => {
  const scanner = (mode: ScanMode) => {
    const mock = new MockScanner(sampleConfig())
    mock.scanMode = mode
    return mock
  }

  it('detects scanning', async () => {
    expect(await new ScannerSession(scanner({ kind: 'scanning' })).scanMode()).toEqual({ kind: 'scanning' })
  })

  it('detects hold', async () => {
    expect(await new ScannerSession(scanner({ kind: 'hold', channel: 75 })).scanMode()).toEqual({ kind: 'hold', channel: 75 })
  })

  it('no channel is unknown', async () => {
    expect(await new ScannerSession(new MockScanner()).scanMode()).toBeNull()
  })

  it('holds on a channel from scanning without toggling banks', async () => {
    const mock = scanner({ kind: 'scanning' })
    const banks = [...mock.config.bankScanEnabled]
    expect(await new ScannerSession(mock).hold(500)).toBe(true)
    expect(mock.scanMode).toEqual({ kind: 'hold', channel: 500 })
    expect(mock.config.bankScanEnabled).toEqual(banks)
    expect(mock.received.filter((l) => l.startsWith('KEY'))).toEqual(['KEY,S,P', 'KEY,H,P', 'KEY,5,P', 'KEY,0,P', 'KEY,0,P', 'KEY,H,P'])
  })

  it('holds on a channel from hold on another', async () => {
    const mock = scanner({ kind: 'hold', channel: 1 })
    expect(await new ScannerSession(mock).hold(75)).toBe(true)
    expect(mock.scanMode).toEqual({ kind: 'hold', channel: 75 })
  })

  it('holding on an empty channel reports failure', async () => {
    expect(await new ScannerSession(scanner({ kind: 'scanning' })).hold(3)).toBe(false)
  })

  it('restores after reading', async () => {
    for (const mode of [{ kind: 'scanning' }, { kind: 'hold', channel: 75 }] as ScanMode[]) {
      const mock = scanner(mode)
      const session = new ScannerSession(mock)
      const before = await session.scanMode()
      await session.readConfiguration()
      expect(mock.scanMode).toEqual({ kind: 'hold', channel: 1 })
      expect(await session.restore(before!)).toBe(true)
      expect(mock.scanMode).toEqual(mode)
    }
  })
})
