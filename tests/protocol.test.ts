import { describe, expect, it } from 'vitest'
import { emptyChannel, makeChannel } from '../src/kit/model/channel'
import { dcsTone } from '../src/kit/model/tone'
import { parseReply, ScannerConnection, ScannerError } from '../src/kit/protocol/connection'
import { channelFromCIN, commandWritingChannel, enabledFlagsFromInvertedMask, FormatError, invertedMask } from '../src/kit/protocol/wire'
import { LineBuffer, LineReceiver, TransportError } from '../src/kit/transport/lineTransport'
import { MockTransport } from '../src/kit/transport/mockScanner'

const bytes = (text: string) => new TextEncoder().encode(text)

describe('LineBuffer', () => {
  it('splits lines across packets', () => {
    const buffer = new LineBuffer()
    buffer.append(bytes('VER,Vers'))
    expect(buffer.nextLine()).toBeNull()
    buffer.append(bytes('ion 1.06.06\rMDL,BC1'))
    expect(buffer.nextLine()).toBe('VER,Version 1.06.06')
    expect(buffer.nextLine()).toBeNull()
    buffer.append(bytes('25AT\r'))
    expect(buffer.nextLine()).toBe('MDL,BC125AT')
  })

  it('empty line', () => {
    const buffer = new LineBuffer()
    buffer.append([0x0d])
    expect(buffer.nextLine()).toBe('')
  })
})

describe('LineReceiver', () => {
  it('waits for a line that arrives in pieces', async () => {
    const receiver = new LineReceiver()
    const line = receiver.readLine(500)
    setTimeout(() => receiver.append(bytes('MDL,BC')), 5)
    setTimeout(() => receiver.append(bytes('125AT\rVER')), 10)
    expect(await line).toBe('MDL,BC125AT')
  })

  it('times out', async () => {
    await expect(new LineReceiver().readLine(20)).rejects.toMatchObject({ kind: 'timedOut' })
  })

  it('fails pending reads', async () => {
    const receiver = new LineReceiver()
    const line = receiver.readLine(1000)
    receiver.fail(new TransportError('ioFailed', 'the scanner was disconnected'))
    await expect(line).rejects.toThrow('the scanner was disconnected')
  })
})

describe('Reply parsing', () => {
  it('strips the command name', () => {
    expect(parseReply('MDL,BC125AT', 'MDL')).toEqual(['BC125AT'])
    expect(parseReply('CIN,OK', 'CIN')).toEqual(['OK'])
  })

  it('keeps a trailing empty field', () => {
    expect(parseReply('BLT,AO,', 'BLT')).toEqual(['AO', ''])
    expect(parseReply('CSP,1,250000,279950,', 'CSP')).toEqual(['1', '250000', '279950', ''])
  })

  it('errors, bare and prefixed', () => {
    expect(() => parseReply('ERR', 'ZZZ')).toThrow(new ScannerError('rejected', 'ZZZ'))
    expect(() => parseReply('NG', 'BLT')).toThrow(new ScannerError('notAllowed', 'BLT'))
    expect(() => parseReply('PRG,NG', 'PRG')).toThrow(new ScannerError('notAllowed', 'PRG'))
  })

  it('a channel named ERR is not an error', () => {
    expect(parseReply('CIN,1,ERR,1625500,FM,0,2,0,0', 'CIN')[1]).toBe('ERR')
  })

  it('mismatched command', () => {
    expect(() => parseReply('MDL,BC125AT', 'VER')).toThrow(new ScannerError('unexpectedResponse', 'VER', 'MDL,BC125AT'))
  })
})

describe('Program mode', () => {
  it('always exits program mode', async () => {
    const mock = new MockTransport((line) => (line === 'PRG' ? 'PRG,OK' : line === 'EPG' ? 'EPG,OK' : 'ERR'))
    const connection = new ScannerConnection(mock)
    await expect(
      connection.inProgramMode(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(mock.sent).toEqual(['PRG', 'EPG'])
  })

  it('a timeout is a transport error', async () => {
    const connection = new ScannerConnection(new MockTransport(() => null))
    await expect(connection.execute('MDL')).rejects.toMatchObject({ name: 'TransportError', kind: 'timedOut' })
  })

  it('runs one exchange at a time', async () => {
    const order: string[] = []
    const transport = {
      pending: [] as string[],
      async writeLine(line: string) {
        order.push(`>${line}`)
        this.pending.push(`${line},OK`)
      },
      async readLine() {
        await new Promise((resolve) => setTimeout(resolve, 5))
        const reply = this.pending.shift()!
        order.push(`<${reply}`)
        return reply
      },
      async drainInput() {},
      async close() {},
    }
    const connection = new ScannerConnection(transport)
    await Promise.all([connection.execute('VOL'), connection.execute('SQL'), connection.execute('GLG')])
    expect(order).toEqual(['>VOL', '<VOL,OK', '>SQL', '<SQL,OK', '>GLG', '<GLG,OK'])
  })
})

describe('Wire', () => {
  it('parses a channel', () => {
    const { number, channel } = channelFromCIN(['12', 'NOAA 1', '01625500', 'FM', '0', '2', '0', '1'])
    expect(number).toBe(12)
    expect(channel).toEqual(makeChannel({ name: 'NOAA 1', frequency: 1_625_500, modulation: 'FM', priority: true }))
  })

  it('an empty channel matches the scanner', () => {
    expect(channelFromCIN(['27', '', '00000000', 'AUTO', '0', '2', '1', '0']).channel).toEqual(emptyChannel())
  })

  it("a comma in a name doesn't shift fields", () => {
    const { channel } = channelFromCIN(['1', 'A', 'B', '01625500', 'NFM', '76', '-5', '0', '0'])
    expect(channel.name).toBe('A,B')
    expect(channel.tone).toBe(76)
    expect(channel.delay).toBe(-5)
  })

  it('rejects bad fields', () => {
    expect(() => channelFromCIN(['1', 'X', '01625500', 'XM', '0', '2', '0', '0'])).toThrow(FormatError)
    expect(() => channelFromCIN(['1', 'X', '01625500', 'FM', '120', '2', '0', '0'])).toThrow(FormatError)
  })

  it('write commands', () => {
    const channel = makeChannel({ name: '', frequency: 1_625_500, modulation: 'NFM', tone: dcsTone(0), delay: -10 })
    expect(commandWritingChannel(channel, 7)).toBe('CIN,7, ,01625500,NFM,128,-10,0,0')
    expect(commandWritingChannel(emptyChannel(), 7)).toBe('DCH,7')
  })

  it('masks', () => {
    expect(enabledFlagsFromInvertedMask('1010000001', 10, 'SCG')).toEqual([false, true, false, true, true, true, true, true, true, false])
    expect(invertedMask([false, true])).toBe('10')
    expect(() => enabledFlagsFromInvertedMask('10', 10, 'SCG')).toThrow(FormatError)
  })
})
