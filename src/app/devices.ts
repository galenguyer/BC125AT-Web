import type { LineTransport } from '../kit/transport/lineTransport'
import { MockScanner } from '../kit/transport/mockScanner'
import { serialFilters, WebSerialTransport } from '../kit/transport/webserial'
import { SCANNER_PRODUCT_ID, SCANNER_VENDOR_ID, usbFilters, WebUSBTransport } from '../kit/transport/webusb'
import { makeDemoScanner } from './demo'
import { demoMode, support, type TransportKind } from './platform'

/** A scanner the browser has been given access to. */
export interface ScannerDevice {
  id: string
  kind: TransportKind | 'demo'
  label: string
  open(): Promise<LineTransport>
}

const ids = new WeakMap<object, string>()
let nextID = 1
const idFor = (object: object, prefix: string) => {
  let id = ids.get(object)
  if (!id) {
    id = `${prefix}-${nextID++}`
    ids.set(object, id)
  }
  return id
}

const isScanner = (device: USBDevice) => device.vendorId === SCANNER_VENDOR_ID && device.productId === SCANNER_PRODUCT_ID
const isScannerPort = (port: SerialPort) => {
  const info = port.getInfo()
  return info.usbVendorId === SCANNER_VENDOR_ID && info.usbProductId === SCANNER_PRODUCT_ID
}

function usbDevice(device: USBDevice): ScannerDevice {
  return {
    id: idFor(device, 'usb'),
    kind: 'usb',
    label: device.productName || 'BC125AT',
    open: () => WebUSBTransport.open(device),
  }
}

function serialDevice(port: SerialPort): ScannerDevice {
  return {
    id: idFor(port, 'serial'),
    kind: 'serial',
    label: 'BC125AT',
    open: () => WebSerialTransport.open(port),
  }
}

let demoScanner: MockScanner | null = null
const demoDevice: ScannerDevice = {
  id: 'demo',
  kind: 'demo',
  label: 'BC125AT (demo)',
  async open() {
    demoScanner ??= makeDemoScanner()
    return demoScanner
  },
}

/** Every scanner this page may use without asking: ones granted before, and still plugged in. */
export async function grantedDevices(): Promise<ScannerDevice[]> {
  const devices: ScannerDevice[] = []
  if (demoMode) devices.push(demoDevice)
  if (support.usb) {
    try {
      devices.push(...(await navigator.usb.getDevices()).filter(isScanner).map(usbDevice))
    } catch {
      // Blocked by a permissions policy.
    }
  }
  if (support.serial) {
    try {
      devices.push(...(await navigator.serial.getPorts()).filter(isScannerPort).map(serialDevice))
    } catch {
      // Blocked by a permissions policy.
    }
  }
  return devices
}

/** Shows the browser's device chooser. Returns `null` if the person closed it without choosing. */
export async function requestDevice(kind: TransportKind): Promise<ScannerDevice | null> {
  try {
    if (kind === 'usb') return usbDevice(await navigator.usb.requestDevice({ filters: usbFilters }))
    return serialDevice(await navigator.serial.requestPort({ filters: serialFilters }))
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'AbortError')) return null
    throw error
  }
}

/** Calls `changed` whenever a scanner is plugged in or unplugged. */
export function watchDevices(changed: () => void): () => void {
  const listeners: [EventTarget, string][] = []
  if (support.usb) listeners.push([navigator.usb, 'connect'], [navigator.usb, 'disconnect'])
  if (support.serial) listeners.push([navigator.serial, 'connect'], [navigator.serial, 'disconnect'])
  for (const [target, type] of listeners) target.addEventListener(type, changed)
  return () => {
    for (const [target, type] of listeners) target.removeEventListener(type, changed)
  }
}
