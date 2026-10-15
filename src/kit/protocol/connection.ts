import type { LineTransport } from '../transport/lineTransport'

export type ScannerErrorKind = 'rejected' | 'notAllowed' | 'unexpectedResponse'

/** The scanner answered, but not with what was asked for. */
export class ScannerError extends Error {
  readonly kind: ScannerErrorKind
  readonly command: string
  readonly response: string

  constructor(kind: ScannerErrorKind, command: string, response = '') {
    super(ScannerError.describe(kind, command, response))
    this.name = 'ScannerError'
    this.kind = kind
    this.command = command
    this.response = response
  }

  static describe(kind: ScannerErrorKind, command: string, response: string): string {
    switch (kind) {
      case 'rejected':
        return `Scanner rejected ${command} (ERR)`
      case 'notAllowed':
        return `Scanner refused ${command} right now (NG)`
      case 'unexpectedResponse':
        return `Unexpected reply to ${command}: ${JSON.stringify(response)}`
    }
  }
}

export const DEFAULT_TIMEOUT_MS = 1000

/** Sends commands one at a time and interprets the replies (SPEC.md §3). */
export class ScannerConnection {
  readonly transport: LineTransport
  defaultTimeoutMs = DEFAULT_TIMEOUT_MS
  /** Called with every line sent and the reply received (or `null` on failure). For logs. */
  onExchange: ((sent: string, reply: string | null) => void) | null = null
  /** Each exchange waits for the one before it, so a reply is never read by the wrong caller. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(transport: LineTransport) {
    this.transport = transport
  }

  /** Sends `line` and returns the raw reply, without interpreting it. */
  send(line: string, timeoutMs?: number): Promise<string> {
    const run = async () => {
      const timeout = timeoutMs ?? this.defaultTimeoutMs
      try {
        await this.transport.writeLine(line, timeout)
        const reply = await this.transport.readLine(timeout)
        this.onExchange?.(line, reply)
        return reply
      } catch (error) {
        this.onExchange?.(line, null)
        // A reply that arrives late would be read as the answer to the next command.
        await this.transport.drainInput().catch(() => {})
        throw error
      }
    }
    const result = this.queue.then(run, run)
    this.queue = result.catch(() => {})
    return result
  }

  /**
   * Sends a command and returns the reply's fields after the command name.
   *
   * `BLT` → `["AO"]`; `CIN,1` → `["1", "NAME", "1625500", …]`; a set command → `["OK"]`.
   */
  async execute(line: string, timeoutMs?: number): Promise<string[]> {
    const command = line.split(',')[0]
    const reply = await this.send(line, timeoutMs)
    return parseReply(reply, command)
  }

  enterProgramMode() {
    return this.expectOK('PRG')
  }

  exitProgramMode() {
    return this.expectOK('EPG')
  }

  /** Runs `body` in program mode, always sending `EPG` afterwards — even if `body` throws. */
  async inProgramMode<T>(body: () => Promise<T>): Promise<T> {
    await this.enterProgramMode()
    try {
      return await body()
    } finally {
      await this.exitProgramMode().catch(() => {})
    }
  }

  private async expectOK(command: string) {
    const fields = await this.execute(command)
    if (fields.length !== 1 || fields[0] !== 'OK') {
      throw new ScannerError('unexpectedResponse', command, [command, ...fields].join(','))
    }
  }
}

export function parseReply(reply: string, command: string): string[] {
  const fields = reply.split(',')
  // Errors arrive bare ("ERR") or prefixed ("PRG,NG"). A channel named "ERR" has more fields.
  const last = fields[fields.length - 1]
  if (last === 'ERR' && fields.length <= 2) throw new ScannerError('rejected', command)
  if (last === 'NG' && fields.length <= 2) throw new ScannerError('notAllowed', command)
  if (fields[0] !== command || fields.length < 2) throw new ScannerError('unexpectedResponse', command, reply)
  return fields.slice(1)
}
