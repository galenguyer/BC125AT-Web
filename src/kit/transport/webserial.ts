import { encodeLine, LineReceiver, TransportError, type LineTransport } from './lineTransport'
import { SCANNER_PRODUCT_ID, SCANNER_VENDOR_ID } from './webusb'

export const serialFilters: SerialPortFilter[] = [{ usbVendorId: SCANNER_VENDOR_ID, usbProductId: SCANNER_PRODUCT_ID }]

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Talks to the scanner through the system's serial driver (Windows' usbser, Linux's cdc_acm),
 * which claims the BC125AT on those systems. The scanner is a USB CDC device, so the baud rate is
 * required by the API but ignored by the scanner.
 */
export class WebSerialTransport implements LineTransport {
  readonly port: SerialPort
  private readonly receiver = new LineReceiver()
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>
  private closed = false
  private readLoop: Promise<void> | null = null

  private constructor(port: SerialPort) {
    this.port = port
    this.writer = port.writable!.getWriter()
  }

  static async open(port: SerialPort): Promise<WebSerialTransport> {
    try {
      await port.open({ baudRate: 115200 })
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'InvalidStateError')) {
        throw new TransportError('openFailed', `the serial port is in use (${describe(error)})`)
      }
      // Already open (in this page): use it.
    }
    if (!port.readable || !port.writable) {
      await port.close().catch(() => {})
      throw new TransportError('openFailed', "the serial port can't be read or written")
    }
    const transport = new WebSerialTransport(port)
    transport.readLoop = transport.runReadLoop()
    return transport
  }

  private async runReadLoop() {
    while (!this.closed && this.port.readable) {
      const reader = this.port.readable.getReader()
      this.reader = reader
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          if (value && value.byteLength > 0) this.receiver.append(value)
        }
      } catch (error) {
        // A framing or buffer error leaves the port usable; anything else, it's gone.
        if (!this.closed && !(error instanceof DOMException && ['BreakError', 'FramingError', 'ParityError', 'BufferOverrunError'].includes(error.name))) {
          this.receiver.fail(new TransportError('ioFailed', 'the scanner was disconnected'))
          return
        }
      } finally {
        reader.releaseLock()
        this.reader = null
      }
    }
  }

  async writeLine(line: string, timeoutMs: number): Promise<void> {
    if (this.closed) throw new TransportError('closed')
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        this.writer.write(encodeLine(line)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new TransportError('timedOut')), timeoutMs)
        }),
      ])
    } catch (error) {
      if (error instanceof TransportError) throw error
      throw new TransportError('ioFailed', describe(error))
    } finally {
      clearTimeout(timer)
    }
  }

  readLine(timeoutMs: number): Promise<string> {
    if (this.closed) return Promise.reject(new TransportError('closed'))
    return this.receiver.readLine(timeoutMs)
  }

  drainInput(): Promise<void> {
    return this.receiver.drain()
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.receiver.fail(new TransportError('closed'))
    await this.reader?.cancel().catch(() => {})
    await this.readLoop?.catch(() => {})
    try {
      this.writer.releaseLock()
    } catch {
      // Already released.
    }
    await this.port.close().catch(() => {})
  }
}
