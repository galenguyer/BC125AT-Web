export type OS = 'mac' | 'windows' | 'linux' | 'chromeos' | 'android' | 'ios' | 'other'

export function detectOS(): OS {
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
  const platform = (data?.platform ?? navigator.platform ?? '').toLowerCase()
  const ua = navigator.userAgent.toLowerCase()
  if (/iphone|ipad|ipod/.test(ua) || (platform === 'macintel' && navigator.maxTouchPoints > 1)) return 'ios'
  if (platform.includes('android') || ua.includes('android')) return 'android'
  if (platform.includes('cros') || platform.includes('chrome os') || ua.includes('cros')) return 'chromeos'
  if (platform.includes('mac')) return 'mac'
  if (platform.includes('win')) return 'windows'
  if (platform.includes('linux')) return 'linux'
  return 'other'
}

export const os = detectOS()
export const isApple = os === 'mac' || os === 'ios'

const params = new URLSearchParams(location.search)
/** `?demo` runs against a simulated scanner, for trying the app without hardware. */
export const demoMode = params.has('demo')
/** `?nousb` pretends neither WebUSB nor Web Serial exists, to check the browser advice. */
const forceUnsupported = params.has('nousb')

export interface BrowserSupport {
  usb: boolean
  serial: boolean
  secure: boolean
}

export const support: BrowserSupport = {
  usb: !forceUnsupported && 'usb' in navigator,
  serial: !forceUnsupported && 'serial' in navigator,
  secure: window.isSecureContext,
}

export const canUseHardware = support.usb || support.serial || demoMode

export type TransportKind = 'usb' | 'serial'

/**
 * WebUSB on macOS (no serial device appears there, SPEC.md §2) and Android; Web Serial on Windows,
 * Linux and ChromeOS, where the system's serial driver claims the scanner.
 */
export function preferredTransport(): TransportKind | null {
  const wantsUSB = os === 'mac' || os === 'android' || os === 'other'
  if (wantsUSB) return support.usb ? 'usb' : support.serial ? 'serial' : null
  return support.serial ? 'serial' : support.usb ? 'usb' : null
}

export const transportName = (kind: TransportKind) => (kind === 'usb' ? 'WebUSB' : 'Web Serial')

/** The modifier shown in menus: ⌘ on Apple systems, Ctrl elsewhere. */
export const isPrimaryModifier = (event: { metaKey: boolean; ctrlKey: boolean }) => (isApple ? event.metaKey : event.ctrlKey)

/** `⇧⌘R` on a Mac, `Ctrl+Shift+R` elsewhere. `keys` uses `mod`, `shift`, `alt` and the key. */
export function shortcutLabel(keys: string): string {
  const parts = keys.split('+')
  const key = parts.pop()!.toUpperCase()
  if (isApple) {
    const symbols = { mod: '⌘', shift: '⇧', alt: '⌥' } as Record<string, string>
    const order = ['alt', 'shift', 'mod']
    return order.filter((m) => parts.includes(m)).map((m) => symbols[m]).join('') + key
  }
  const names = { mod: 'Ctrl', shift: 'Shift', alt: 'Alt' } as Record<string, string>
  return [...['mod', 'shift', 'alt'].filter((m) => parts.includes(m)).map((m) => names[m]), key].join('+')
}

/** Whether `event` is the shortcut `keys` (as in `shortcutLabel`). */
export function matchesShortcut(event: KeyboardEvent, keys: string): boolean {
  const parts = keys.split('+')
  const key = parts.pop()!
  return (
    event.key.toLowerCase() === key.toLowerCase() &&
    isPrimaryModifier(event) === parts.includes('mod') &&
    event.shiftKey === parts.includes('shift') &&
    event.altKey === parts.includes('alt')
  )
}
