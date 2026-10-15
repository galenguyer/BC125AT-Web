import { ScannerError } from '../kit/protocol/connection'
import { FormatError } from '../kit/protocol/wire'
import { SessionError } from '../kit/sync/session'
import { TransportError } from '../kit/transport/lineTransport'
import { os, type TransportKind } from './platform'

/** What to tell the person when talking to the scanner fails (as the macOS app's `ScannerReader.message`). */
export function errorMessage(error: unknown, kind?: TransportKind | 'demo'): string {
  if (error instanceof SessionError || error instanceof ScannerError) return error.message
  if (error instanceof TransportError) {
    if (error.kind !== 'openFailed') return error.message
    let message = `${error.message}. If another program or browser tab is talking to the scanner, close it and try again.`
    if (kind === 'usb' && (os === 'windows' || os === 'linux' || os === 'chromeos')) {
      message += " On this system the scanner's serial driver usually holds it: choose Scanner ▸ Connect over Web Serial instead."
    } else if (kind === 'serial' && os === 'linux') {
      message += ' On Linux, your user may also need to be in the dialout group to use serial ports.'
    }
    return message
  }
  if (error instanceof FormatError) return `${error.message}. The scanner may be running firmware this app doesn't know.`
  if (error instanceof Error) return error.message
  return String(error)
}

/** The live bar's shorter form. */
export function liveErrorMessage(error: unknown, kind?: TransportKind | 'demo'): string {
  if (error instanceof TransportError && error.kind === 'openFailed') {
    return kind === 'usb' && (os === 'windows' || os === 'linux') ? 'The scanner is held by the system; connect over Web Serial' : 'The scanner is in use by another program or tab'
  }
  return `Can't reach the scanner: ${errorMessage(error, kind)}`
}
