import { describe, expect, it } from 'vitest'
import { makeChannel } from '../src/kit/model/channel'
import { cloneConfig, makeConfig } from '../src/kit/model/config'
import { parseTone, TONE_NONE } from '../src/kit/model/tone'
import { exportCSV } from '../src/kit/formats/csv'
import {
  crossesBanks,
  emptyRun,
  firstEmptyRun,
  insertChannels,
  radioReferenceEntries,
  radioReferenceName,
  radioReferenceTone,
  RadioReferenceImportError,
} from '../src/kit/formats/radioReference'
import { f, sampleConfig } from './sample'

const exported = `"Frequency Output","Frequency Input","FCC Callsign",Agency/Category,Description,"Alpha Tag","PL Output Tone","PL Input Tone",Mode,"Class Station Code",Tag
118.30000,0.00000,,,Tower,"ROC Tower",,,AM,BM,Aircraft
37.900000,39.90000,KEH763,Webster,"Highway Department","Webster Highway","151.4 PL",,FM,RM,"Public Works"
155.71500,0.00000,KNGA965,,"Fire-Rescue Dispatch/Operations","ROC ARFF","155 DPL",,FMN,BM,"Fire Dispatch"
173.33750,0.00000,WNYD449,,"SCAN Runway Reporting System","SCAN Rnwy",,,Telm,F,Data
460.70000,465.70000,KXA741,,"American Airlines",American,"CC 1|TG 1001|SL 1",,DMR,RM,Business
453.10000,0.00000,,,"County, Fire","",,,"Project 25",BM,"Fire Dispatch"
851.01250,0.00000,,,Trunk,"Trunk CC",,,FMN,RM,Interop
461.11250,0.00000,KB74329,,"Fedex - Ramp","Fedex Ramp Operations 2","293 NAC",,FMN,M,Business
466.03750,0.00000,,,"LTR site",LTR,,,LTR,RM,Business
`

describe('RadioReference import', () => {
  it('reads usable rows', () => {
    const entries = radioReferenceEntries(exported)
    expect(entries).toHaveLength(9)
    const usable = entries.filter((e) => e.channel !== null)
    expect(usable.map((e) => e.line)).toEqual([2, 3, 4, 9])

    expect(usable[0].channel).toEqual(makeChannel({ name: 'ROC Tower', frequency: f('118.3'), modulation: 'AM' }))
    expect(usable[1].channel?.modulation).toBe('FM')
    expect(usable[1].channel?.tone).toBe(parseTone('151.4'))
    expect(usable[1].channel?.name).toBe('Webster Highway')
    expect(usable[2].channel?.modulation).toBe('NFM')
    expect(usable[2].channel?.tone).toBe(parseTone('D155'))
    expect(usable[2].channel?.lockedOut).toBe(false)
    // Truncated to 16 characters, and a NAC is digital, so the channel is left open.
    expect(usable[3].channel?.name).toBe('Fedex Ramp Opera')
    expect(usable[3].channel?.tone).toBe(TONE_NONE)
    expect(usable[3].note).not.toBeNull()
  })

  it('explains skipped rows', () => {
    const skipped = new Map(radioReferenceEntries(exported).filter((e) => e.channel === null).map((e) => [e.line, e.skipReason]))
    expect(skipped.get(5)).toBe('Telm is data, not voice')
    expect(skipped.get(6)).toBe('DMR is digital')
    expect(skipped.get(7)).toBe('Project 25 is digital')
    expect(skipped.get(8)).toBe("851.0125 MHz is outside the scanner's bands")
    expect(skipped.get(10)).toBe('LTR is a trunked system')
  })

  it('names fall back to the description', () => {
    expect(radioReferenceName('', 'County, Fire')).toBe('County  Fire')
    expect(radioReferenceName('Café Ops', '')).toBe('Caf Ops')
    expect(radioReferenceName('Fifteen chars + space', '')).toBe('Fifteen chars +')
  })

  it('reads tones', () => {
    expect(radioReferenceTone('110.9 PL')).toBe(parseTone('110.9'))
    expect(radioReferenceTone('023 DPL')).toBe(parseTone('D023'))
    expect(radioReferenceTone('CSQ')).toBe(TONE_NONE)
    expect(radioReferenceTone('293 NAC')).toBeNull()
    expect(radioReferenceTone('RAN 1')).toBeNull()
  })

  it('rejects other files', () => {
    expect(() => radioReferenceEntries(exportCSV(sampleConfig()).replace('Modulation', 'X'))).toThrow(/no Mode column/)
    expect(() => radioReferenceEntries('')).toThrow(RadioReferenceImportError)
  })

  it('finds room for channels', () => {
    const config = makeConfig()
    config.channels[2] = makeChannel({ frequency: f('121.5') })
    config.channels[48] = makeChannel({ frequency: f('121.5') })
    expect(emptyRun(config, 1)).toBe(2)
    expect(emptyRun(config, 3)).toBe(0)
    expect(emptyRun(config, 4)).toBe(45)
    expect(emptyRun(config, 500)).toBe(1)
    expect(firstEmptyRun(config, 2)).toBe(1)
    expect(firstEmptyRun(config, 10)).toBe(4)
    // 46 won't fit in bank 1, so prefer the start of bank 2 over crossing from 50.
    expect(firstEmptyRun(config, 46)).toBe(51)
    expect(firstEmptyRun(config, 451)).toBe(50)
    expect(firstEmptyRun(config, 452)).toBeNull()
    expect(crossesBanks(45, 7)).toBe(true)
    expect(crossesBanks(41, 10)).toBe(false)
  })

  it('inserts only into empty channels', () => {
    const config = makeConfig()
    config.channels[4] = makeChannel({ frequency: f('121.5') })
    const added = [makeChannel({ name: 'A', frequency: f('118.3') }), makeChannel({ name: 'B', frequency: f('118.8') })]
    const before = cloneConfig(config)
    expect(insertChannels(config, added, 4)).toBe(false)
    expect(config).toEqual(before)
    expect(insertChannels(config, added, 2)).toBe(true)
    expect(config.channels[1].name).toBe('A')
    expect(config.channels[2].name).toBe('B')
    expect(insertChannels(config, added, 500)).toBe(false)
  })
})
