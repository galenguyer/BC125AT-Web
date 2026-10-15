import { create } from 'zustand'

/** Per-browser preferences, kept in localStorage. Every access is guarded: storage can be unavailable. */
export interface Prefs {
  /** Flags channels that share a frequency with another channel. */
  duplicateWarnings: boolean
  /** How many scanner backups to keep. */
  backupRetention: number
  /** The live bar polls the scanner. */
  liveEnabled: boolean
  showEmptyChannels: boolean
  showInspector: boolean
  /** The browser-support banner was dismissed. */
  dismissedSupportBanner: boolean
}

export const DEFAULT_BACKUP_RETENTION = 50

const defaults: Prefs = {
  duplicateWarnings: true,
  backupRetention: DEFAULT_BACKUP_RETENTION,
  liveEnabled: true,
  showEmptyChannels: false,
  showInspector: false,
  dismissedSupportBanner: false,
}

const KEY = 'bc125at-prefs'

function load(): Prefs {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>
    return { ...defaults, ...stored }
  } catch {
    return { ...defaults }
  }
}

interface PrefsStore extends Prefs {
  set(change: Partial<Prefs>): void
}

export const usePrefs = create<PrefsStore>((set, get) => ({
  ...load(),
  set(change) {
    set(change)
    try {
      const { set: _ignored, ...prefs } = get()
      void _ignored
      localStorage.setItem(KEY, JSON.stringify(prefs))
    } catch {
      // Storage unavailable (private window, blocked site data): keep the change for this visit.
    }
  },
}))
