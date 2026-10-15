/**
 * A byte pipe to the scanner that frames traffic as `\r`-terminated ASCII lines.
 *
 * The scanner accepts one command at a time; `ScannerConnection` serializes access, so
 * implementations don't need to handle overlapping calls.
 */
export interface LineTransport {
  /** Sends `line` followed by `\r`. */
  writeLine(line: string, timeoutMs: number): Promise<void>
  /** Returns the next line received, without its `\r` terminator. */
  readLine(timeoutMs: number): Promise<string>
  /** Discards any bytes already received but not yet read. */
  drainInput(): Promise<void>
  close(): Promise<void>
}

export type TransportErrorKind = 'deviceNotFound' | 'openFailed' | 'timedOut' | 'ioFailed' | 'closed'

export class TransportError extends Error {
  readonly kind: TransportErrorKind
  readonly reason: string

  constructor(kind: TransportErrorKind, reason = '') {
    super(TransportError.describe(kind, reason))
    this.name = 'TransportError'
    this.kind = kind
    this.reason = reason
  }

  static describe(kind: TransportErrorKind, reason: string): string {
    switch (kind) {
      case 'deviceNotFound':
        return 'No BC125AT found on USB'
      case 'openFailed':
        return `Could not open scanner: ${reason}`
      case 'timedOut':
        return 'Timed out waiting for the scanner'
      case 'ioFailed':
        return `USB I/O failed: ${reason}`
      case 'closed':
        return 'Connection is closed'
    }
  }
}

/** Accumulates received bytes and splits them into `\r`-terminated lines. */
export class LineBuffer {
  private pending: number[] = []
  private readonly decoder = new TextDecoder()

  append(bytes: Iterable<number>) {
    for (const byte of bytes) this.pending.push(byte)
  }

  /** Removes and returns the first complete line, if any. */
  nextLine(): string | null {
    const end = this.pending.indexOf(0x0d)
    if (end < 0) return null
    const line = this.decoder.decode(new Uint8Array(this.pending.slice(0, end)))
    this.pending.splice(0, end + 1)
    return line
  }

  removeAll() {
    this.pending = []
  }
}

/**
 * The receiving half of a streaming transport (WebUSB, Web Serial): a background loop calls
 * `append` with whatever arrives, and `readLine` waits for the next complete line or times out.
 * Neither API can time out a pending read on its own, which is why reads run in a loop.
 */
export class LineReceiver {
  private readonly buffer = new LineBuffer()
  private waiter: (() => void) | null = null
  private failure: Error | null = null

  append(bytes: Uint8Array) {
    this.buffer.append(bytes)
    this.wake()
  }

  /** Every pending and later `readLine` fails with `error` (for example, the device went away). */
  fail(error: Error) {
    this.failure = error
    this.wake()
  }

  clear() {
    this.buffer.removeAll()
  }

  async readLine(timeoutMs: number): Promise<string> {
    const deadline = performance.now() + timeoutMs
    for (;;) {
      const line = this.buffer.nextLine()
      if (line !== null) return line
      if (this.failure) throw this.failure
      const remaining = deadline - performance.now()
      if (remaining <= 0) throw new TransportError('timedOut')
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.waiter = null
          resolve()
        }, remaining)
        this.waiter = () => {
          clearTimeout(timer)
          this.waiter = null
          resolve()
        }
      })
    }
  }

  /** Clears what has arrived, waits briefly for anything still in flight, and clears that too. */
  async drain(quietMs = 50) {
    this.buffer.removeAll()
    await new Promise((resolve) => setTimeout(resolve, quietMs))
    this.buffer.removeAll()
  }

  private wake() {
    this.waiter?.()
  }
}

export const encodeLine = (line: string) => new TextEncoder().encode(`${line}\r`)
