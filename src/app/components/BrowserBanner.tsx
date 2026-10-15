import { demoMode, os, support } from '../platform'
import { usePrefs } from '../store/prefs'
import { CloseIcon } from './Icons'

/**
 * Explains, when this browser can't reach the scanner, what to use instead (NOTES.md). Editing
 * files still works, so it's a dismissible banner, not a wall.
 */
export function browserAdvice(): string | null {
  if (demoMode) return null
  if (!support.secure) {
    return 'This page isn’t loaded over a secure connection (HTTPS), so the browser won’t let it reach USB devices. Open it with an https:// address.'
  }
  if (support.usb || support.serial) {
    if (os === 'mac' && !support.usb) {
      return 'This browser has Web Serial but not WebUSB, and on a Mac the scanner is only reachable over WebUSB. Use Helium, Chrome or Edge.'
    }
    return null
  }
  if (os === 'ios') return 'No browser on iPhone or iPad can reach USB devices, so this page can edit files but can’t read or write a scanner. Use a computer, or an Android device with Chrome.'
  return 'This browser can’t talk to USB devices (it has neither WebUSB nor Web Serial), so you can edit files but not read or write a scanner. Switch to a Chromium-based browser:'
}

export function BrowserBanner() {
  const dismissed = usePrefs((s) => s.dismissedSupportBanner)
  const advice = browserAdvice()
  if (!advice || dismissed) return null
  const suggestBrowsers = support.secure && !support.usb && !support.serial && os !== 'ios'
  return (
    <div className="banner" role="note">
      <p>
        {advice}{' '}
        {suggestBrowsers && (
          <>
            <a href="https://helium.computer" target="_blank" rel="noreferrer">
              Helium
            </a>{' '}
            (recommended), Chrome, Edge, Opera or Vivaldi. Safari and Firefox don’t support WebUSB or Web Serial.
          </>
        )}
      </p>
      <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => usePrefs.getState().set({ dismissedSupportBanner: true })}>
        <CloseIcon />
      </button>
    </div>
  )
}
