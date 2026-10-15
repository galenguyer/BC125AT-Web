import { db, type WorkspaceRecord } from './db'
import { useDocument, type DocumentState } from './document'
import { useUI, type Section } from './ui'

/**
 * Keeps the open document in IndexedDB, so closing the tab, a crash or reloading for an update
 * never loses work: it's saved half a second after each change, and again when the page is hidden.
 */

const KEY = 'current'
const DEBOUNCE_MS = 500

interface SavedUI {
  section: Section
}

let timer: ReturnType<typeof setTimeout> | null = null
let started = false

function record(state: DocumentState, withHistory: boolean): WorkspaceRecord {
  return {
    config: state.config,
    savedConfig: state.savedConfig,
    fileName: state.fileName,
    fileHandle: state.fileHandle,
    past: withHistory ? state.past : undefined,
    future: withHistory ? state.future : undefined,
    ui: { section: useUI.getState().section } satisfies SavedUI,
    savedAt: Date.now(),
  }
}

/** Saves the workspace now. With `withHistory`, the undo history too (for an update reload). */
export async function flushWorkspace(withHistory = false): Promise<void> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  try {
    await (await db()).put('workspace', record(useDocument.getState(), withHistory), KEY)
  } catch (error) {
    console.warn('Could not save the workspace', error)
  }
}

/** Loads the saved workspace, if there is one. Returns whether it did. */
export async function restoreWorkspace(): Promise<boolean> {
  let saved: WorkspaceRecord | undefined
  try {
    saved = await (await db()).get('workspace', KEY)
  } catch {
    return false
  }
  if (!saved) return false
  useDocument.getState().restore({
    config: saved.config,
    savedConfig: saved.savedConfig,
    fileName: saved.fileName,
    fileHandle: saved.fileHandle ?? null,
    past: saved.past ?? [],
    future: saved.future ?? [],
  })
  const ui = saved.ui as SavedUI | undefined
  if (ui?.section) useUI.setState({ section: ui.section })
  // The history was only for the reload; later saves don't carry it.
  if (saved.past) void flushWorkspace()
  return true
}

export function startAutosave() {
  if (started) return
  started = true
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void flushWorkspace(), DEBOUNCE_MS)
  }
  useDocument.subscribe((state, previous) => {
    if (state.config !== previous.config || state.fileName !== previous.fileName || state.savedConfig !== previous.savedConfig) schedule()
  })
  useUI.subscribe((state, previous) => {
    if (state.section !== previous.section) schedule()
  })
  addEventListener('pagehide', () => void flushWorkspace())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushWorkspace()
  })
}

// MARK: One tab at a time

/**
 * Only one tab may hold the workspace (and the scanner) at a time. The first tab takes a Web Lock;
 * a later one waits, and its "Use Here" asks the holder, over a BroadcastChannel, to save and let go.
 */
const LOCK = 'bc125at-workspace'
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('bc125at-workspace')

let releaseLock: (() => void) | null = null

/**
 * Takes the workspace lock. Resolves `true` once this tab holds it, or `false` straight away if
 * another tab does and `wait` is false. `onLost` is called if another tab later takes over.
 */
export function acquireWorkspace(wait: boolean, onLost: () => Promise<void>): Promise<boolean> {
  if (!('locks' in navigator)) return Promise.resolve(true)
  return new Promise((resolve) => {
    navigator.locks
      .request(LOCK, { ifAvailable: !wait }, (lock) => {
        if (!lock) {
          resolve(false)
          return undefined
        }
        resolve(true)
        return new Promise<void>((release) => {
          releaseLock = release
        })
      })
      .catch(() => resolve(true))
    if (channel) {
      channel.onmessage = async (event) => {
        if (event.data === 'take-over' && releaseLock) {
          const release = releaseLock
          releaseLock = null
          await onLost()
          release()
        }
      }
    }
  })
}

/** Asks the tab holding the workspace to let go of it. */
export function requestTakeOver() {
  channel?.postMessage('take-over')
}
