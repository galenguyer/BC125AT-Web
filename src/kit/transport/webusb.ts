import { encodeLine, LineReceiver, TransportError, type LineTransport } from './lineTransport'

export const SCANNER_VENDOR_ID = 0x1965
export const SCANNER_PRODUCT_ID = 0x0017
export const usbFilters: USBDeviceFilter[] = [{ vendorId: SCANNER_VENDOR_ID, productId: SCANNER_PRODUCT_ID }]

/** CDC data. */
const DATA_INTERFACE_CLASS = 0x0a

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TransportError('timedOut')), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Talks to the scanner's CDC data interface directly over its bulk pipes (SPEC.md §2).
 *
 * On macOS no driver attaches to the BC125AT's data interface (there's no `/dev/cu.*` node), so
 * the browser can claim interface 1 and exchange bytes without any line-coding or DTR setup. On
 * Windows and Linux the system's serial driver usually owns the interface, and Web Serial is the
 * way in instead.
 *
 * `transferIn` has no timeout and can't be cancelled, so a loop keeps one read outstanding at all
 * times and feeds a `LineReceiver`, which is what times out.
 */
export class WebUSBTransport implements LineTransport {
  readonly device: USBDevice
  private readonly interfaceNumber: number
  private readonly inEndpoint: number
  private readonly outEndpoint: number
  private readonly receiver = new LineReceiver()
  private closed = false
  private readLoop: Promise<void> | null = null

  private constructor(device: USBDevice, interfaceNumber: number, inEndpoint: number, outEndpoint: number) {
    this.device = device
    this.interfaceNumber = interfaceNumber
    this.inEndpoint = inEndpoint
    this.outEndpoint = outEndpoint
  }

  static async open(device: USBDevice): Promise<WebUSBTransport> {
    try {
      if (!device.opened) await device.open()
    } catch (error) {
      throw new TransportError('openFailed', `the browser couldn't open the USB device (${describe(error)})`)
    }
    try {
      if (device.configuration === null) await device.selectConfiguration(1)
      const configuration = device.configuration
      if (!configuration) throw new TransportError('openFailed', 'the scanner has no USB configuration')
      const data =
        configuration.interfaces.find((i) => i.alternates.some((a) => a.interfaceClass === DATA_INTERFACE_CLASS)) ??
        configuration.interfaces.find((i) => i.interfaceNumber === 1)
      if (!data) throw new TransportError('openFailed', "the scanner's data interface is missing")
      try {
        await device.claimInterface(data.interfaceNumber)
      } catch (error) {
        throw new TransportError('openFailed', `the USB interface is in use (${describe(error)})`)
      }
      const alternate = data.alternates.find((a) => a.interfaceClass === DATA_INTERFACE_CLASS) ?? data.alternates[0]
      if (alternate.alternateSetting !== 0) await device.selectAlternateInterface(data.interfaceNumber, alternate.alternateSetting)
      const inEndpoint = alternate.endpoints.find((e) => e.type === 'bulk' && e.direction === 'in')
      const outEndpoint = alternate.endpoints.find((e) => e.type === 'bulk' && e.direction === 'out')
      if (!inEndpoint || !outEndpoint) throw new TransportError('openFailed', "the scanner's bulk endpoints are missing")
      const transport = new WebUSBTransport(device, data.interfaceNumber, inEndpoint.endpointNumber, outEndpoint.endpointNumber)
      transport.readLoop = transport.runReadLoop(inEndpoint.packetSize || 64)
      return transport
    } catch (error) {
      await device.close().catch(() => {})
      if (error instanceof TransportError) throw error
      throw new TransportError('openFailed', describe(error))
    }
  }

  private async runReadLoop(packetSize: number) {
    while (!this.closed) {
      try {
        const result = await this.device.transferIn(this.inEndpoint, Math.max(64, packetSize))
        if (result.status === 'stall') {
          await this.device.clearHalt('in', this.inEndpoint)
          continue
        }
        if (result.data && result.data.byteLength > 0) {
          this.receiver.append(new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength))
        }
      } catch (error) {
        if (!this.closed) this.receiver.fail(new TransportError('ioFailed', this.device.opened ? describe(error) : 'the scanner was disconnected'))
        return
      }
    }
  }

  async writeLine(line: string, timeoutMs: number): Promise<void> {
    if (this.closed) throw new TransportError('closed')
    let result: USBOutTransferResult
    try {
      result = await withTimeout(this.device.transferOut(this.outEndpoint, encodeLine(line)), timeoutMs)
    } catch (error) {
      if (error instanceof TransportError) throw error
      throw new TransportError('ioFailed', this.device.opened ? describe(error) : 'the scanner was disconnected')
    }
    if (result.status === 'stall') {
      await this.device.clearHalt('out', this.outEndpoint).catch(() => {})
      throw new TransportError('ioFailed', 'the scanner stalled the write')
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
    try {
      await this.device.releaseInterface(this.interfaceNumber)
    } catch {
      // Already released, or the device is gone.
    }
    try {
      await this.device.close()
    } catch {
      // Already closed.
    }
    await this.readLoop?.catch(() => {})
  }
}
