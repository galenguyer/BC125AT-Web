import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { LiveStatus } from '../src/kit/model/liveStatus'
import { encodeLine, LineReceiver, TransportError, type LineTransport } from '../src/kit/transport/lineTransport'
import { MockScanner } from '../src/kit/transport/mockScanner'
import { sampleConfig } from './sample'

/**
 * A transport that behaves like USB rather than like a function call: each reply arrives
 * asynchronously after a random delay, sometimes split across packets, through the same
 * `LineReceiver` the WebUSB and Web Serial transports use. The scanner behind it is the ordinary
 * `MockScanner`; only the timing is realistic.
 */
class StreamingTransport implements LineTransport {
  static open = 0
  static maxOpen = 0
  readonly scanner: MockScanner
  readonly receiver = new LineReceiver()
  /** Every exchange, in order, with the reply the caller actually received. */
  readonly exchanges: { sent: string; received: string | null }[] = []
  private closed = false
  /** Replaces the scanner's `GLG` replies, to replay ones recorded from a real scanner. */
  static glg: (() => string | null) | null = null
  private glg = () => StreamingTransport.glg?.() ?? null

  constructor(scanner: MockScanner) {
    this.scanner = scanner
    StreamingTransport.open += 1
    StreamingTransport.maxOpen = Math.max(StreamingTransport.maxOpen, StreamingTransport.open)
  }

  async writeLine(line: string): Promise<void> {
    if (this.closed) throw new TransportError('closed')
    const fields = line.split(',')
    const reply = encodeLine((fields[0] === 'GLG' && this.glg?.()) || this.scanner.reply(fields[0], fields.slice(1)))
    this.scanner.received.push(line)
    this.exchanges.push({ sent: line, received: null })
    // 1–6 ms later, in one or two packets.
    const split = Math.random() < 0.5 ? Math.floor(Math.random() * reply.length) : reply.length
    setTimeout(() => this.receiver.append(reply.slice(0, split)), 1 + Math.random() * 3)
    if (split < reply.length) setTimeout(() => this.receiver.append(reply.slice(split)), 4 + Math.random() * 2)
  }

  async readLine(timeoutMs: number): Promise<string> {
    const line = await this.receiver.readLine(timeoutMs)
    const pending = this.exchanges.findLast((e) => e.received === null)
    if (pending) pending.received = line
    return line
  }

  drainInput() {
    return this.receiver.drain(5)
  }

  async close() {
    if (this.closed) return
    this.closed = true
    StreamingTransport.open -= 1
    this.receiver.fail(new TransportError('closed'))
  }
}

/** A reply belongs to the command if it starts with its name, or is a bare ERR/NG. */
let testScanner: MockScanner
const transports: StreamingTransport[] = []
const testDevice = {
  id: 'test',
  kind: 'usb' as const,
  label: 'BC125AT',
  open: async () => {
    const transport = new StreamingTransport(testScanner)
    transports.push(transport)
    return transport
  },
}

vi.mock('../src/app/devices', () => ({
  grantedDevices: async () => {
    // Discovery takes a moment, as navigator.usb.getDevices() does.
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 20))
    return [testDevice]
  },
  requestDevice: async () => testDevice,
  watchDevices: () => () => {},
}))

const mismatched = (exchanges: { sent: string; received: string | null }[]) =>
  exchanges.filter((e) => e.received !== null && e.received !== 'ERR' && e.received !== 'NG' && e.received.split(',')[0] !== e.sent.split(',')[0])

describe('Live monitor against a USB-like transport', () => {
  let scannerModule: typeof import('../src/app/store/scanner')
  let prefsModule: typeof import('../src/app/store/prefs')

  beforeAll(async () => {
    // The app's modules read these browser globals when they load.
    vi.stubGlobal('location', { search: '' })
    vi.stubGlobal('window', { isSecureContext: true })
    scannerModule = await import('../src/app/store/scanner')
    prefsModule = await import('../src/app/store/prefs')
  })

  afterEach(async () => {
    StreamingTransport.glg = null
    await scannerModule.live.setEnabled(false)
    transports.length = 0
    StreamingTransport.maxOpen = StreamingTransport.open
  })

  /** Every status the live bar shows from now on: a channel, or "Scanning…". */
  function recordBar() {
    const shown: { at: number; text: string }[] = []
    const unsubscribe = scannerModule.useScanner.subscribe((state) => {
      if (state.live.kind !== 'live') return
      const text = state.status && state.settled ? `CH ${state.status.channel}` : 'Scanning…'
      if (shown.at(-1)?.text !== text) shown.push({ at: performance.now(), text })
    })
    return { shown, unsubscribe }
  }

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  async function holdAndWatch(label: string) {
    const { live } = scannerModule
    const bar = recordBar()
    const heldAt = performance.now()
    live.hold(500)
    await wait(1500)
    bar.unsubscribe()
    const afterHold = bar.shown.filter((s) => s.at >= heldAt).map((s) => `${Math.round(s.at - heldAt)} ms: ${s.text}`)
    const all = transports.flatMap((t) => t.exchanges)
    console.log(`[${label}] live bar after Hold:\n  ${afterHold.join('\n  ')}\n  ${all.length} exchanges over ${transports.length} transport(s), at most ${StreamingTransport.maxOpen} open at once, ${mismatched(all).length} mismatched`)
    return { afterHold, all }
  }

  it('startup: the first device refresh and a USB connect event at the same time', async () => {
    const { live } = scannerModule
    testScanner = new MockScanner(sampleConfig())
    testScanner.scanMode = { kind: 'scanning' }
    prefsModule.usePrefs.setState({ liveEnabled: true })
    await Promise.all([live.refreshDevices(), live.refreshDevices(), live.refreshDevices()])
    await wait(1500)
    const { afterHold, all } = await holdAndWatch('startup race')
    expect(mismatched(all)).toEqual([])
    expect(StreamingTransport.maxOpen).toBe(1)
    expect(afterHold.filter((s) => s.includes('CH ')).length).toBeLessThanOrEqual(1)
  }, 15_000)

  it('after a read: withScanner pauses polling, then polling resumes', async () => {
    const { live } = scannerModule
    testScanner = new MockScanner(sampleConfig())
    testScanner.scanMode = { kind: 'scanning' }
    prefsModule.usePrefs.setState({ liveEnabled: true })
    await live.refreshDevices()
    await wait(800)
    await live.withScanner('Paused while reading', true, (session) => session.readConfiguration())
    await wait(800)
    const { afterHold, all } = await holdAndWatch('after a read')
    expect(mismatched(all)).toEqual([])
    expect(StreamingTransport.maxOpen).toBe(1)
    expect(afterHold.filter((s) => s.includes('CH ')).length).toBeLessThanOrEqual(1)
  }, 30_000)

  it('pairs every reply with its command, and shows a held channel without flickering', async () => {
    const { live, useScanner } = scannerModule
    prefsModule.usePrefs.setState({ liveEnabled: true })
    const scanner = new MockScanner(sampleConfig())
    scanner.scanMode = { kind: 'scanning' }
    const transports: StreamingTransport[] = []
    useScanner.setState({
      devices: [
        {
          id: 'test',
          kind: 'usb',
          label: 'BC125AT',
          open: async () => {
            const transport = new StreamingTransport(scanner)
            transports.push(transport)
            return transport
          },
        },
      ],
      selectedId: 'test',
    })

    // Every status the live bar would show, with whether it's "settled" (a channel) or "Scanning…".
    const shown: { at: number; text: string }[] = []
    const describe = (status: LiveStatus | null, settled: boolean) => (status && settled ? `CH ${status.channel}` : 'Scanning…')
    const unsubscribe = useScanner.subscribe((state) => {
      if (state.live.kind !== 'live') return
      const text = describe(state.status, state.settled)
      if (shown.at(-1)?.text !== text) shown.push({ at: performance.now(), text })
    })

    live.start()
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(useScanner.getState().live.kind).toBe('live')

    // Hold on channel 500, as the live bar's Hold button would.
    const heldAt = performance.now()
    live.hold(500)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    unsubscribe()

    const afterHold = shown.filter((s) => s.at >= heldAt).map((s) => `${Math.round(s.at - heldAt)} ms: ${s.text}`)
    console.log('Live bar after Hold:\n  ' + afterHold.join('\n  '))
    const all = transports.flatMap((t) => t.exchanges)
    console.log(`${all.length} exchanges over ${transports.length} transport(s), at most ${StreamingTransport.maxOpen} open at once`)

    expect(scanner.scanMode).toEqual({ kind: 'hold', channel: 500 })
    expect(mismatched(all)).toEqual([])
    expect(StreamingTransport.maxOpen).toBe(1)
    // Once held, it should go to the channel and stay there.
    const changes = afterHold.filter((s) => s.includes('CH ')).length
    expect(changes).toBeLessThanOrEqual(1)
  }, 15_000)

  // Recorded from a BC125AT held on channel 13 with priority on: every ~2 s the scanner samples the
  // priority channel (channel 1, 121.5000), and GLG reports that frequency under channel 13.
  const held13 = 'GLG,01187000,AM,,0,,,YYZ TWR N,0,1,,13,'
  const prioritySample = 'GLG,01215000,AM,,0,,,YYZ TWR N,0,1,,13,'

  it("priority checks during hold don't flicker the live bar", async () => {
    const { live, useScanner } = scannerModule
    testScanner = new MockScanner(sampleConfig())
    prefsModule.usePrefs.setState({ liveEnabled: true })
    let polls = 0
    StreamingTransport.glg = () => (++polls % 10 === 0 ? prioritySample : held13)
    await live.refreshDevices()
    await wait(1200)
    const bar = recordBar()
    const frequencies = new Set<number | null>()
    const unsubscribe = useScanner.subscribe((state) => frequencies.add(state.status?.frequency ?? null))
    await wait(4500)
    bar.unsubscribe()
    unsubscribe()
    console.log(`[priority] ${polls} polls, live bar: ${bar.shown.map((s) => s.text).join(' → ') || 'CH 13 throughout'}`)
    expect(polls).toBeGreaterThan(15)
    expect(bar.shown.map((s) => s.text)).not.toContain('Scanning…')
    expect([...frequencies]).toEqual([1_187_000])
  }, 15_000)

  it('a frequency that changes and stays on the same channel is shown', async () => {
    const { live, useScanner } = scannerModule
    testScanner = new MockScanner(sampleConfig())
    prefsModule.usePrefs.setState({ liveEnabled: true })
    let changed = false
    StreamingTransport.glg = () => (changed ? prioritySample : held13)
    await live.refreshDevices()
    await wait(1200)
    expect(useScanner.getState().status?.frequency).toBe(1_187_000)
    changed = true
    await wait(1200)
    expect(useScanner.getState().status?.frequency).toBe(1_215_000)
  }, 15_000)
})
