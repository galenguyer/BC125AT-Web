import { create } from 'zustand'
import { flushWorkspace } from './workspace'

/**
 * New versions arrive as a new service worker. It waits (prompt mode) until the person chooses
 * Reload, so a deploy never reloads the page out from under them. Before reloading, the
 * workspace and its undo history are saved, and restored when the page comes back.
 */
export type UpdateStatus = 'idle' | 'checking' | 'upToDate' | 'available' | 'failed' | 'unsupported'

interface UpdateState {
  status: UpdateStatus
  /** Set by "Later": the note stays hidden until the next visit (the update applies then). */
  hiddenForSession: boolean
  lastChecked: number | null
}

export const useUpdates = create<UpdateState>(() => ({
  status: 'serviceWorker' in navigator ? 'idle' : 'unsupported',
  hiddenForSession: false,
  lastChecked: null,
}))

let registration: ServiceWorkerRegistration | null = null
let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null

const CHECK_INTERVAL_MS = 60 * 60 * 1000

export function registered(reg: ServiceWorkerRegistration | undefined, update: (reload?: boolean) => Promise<void>) {
  registration = reg ?? null
  applyUpdate = update
  if (!reg) return
  setInterval(() => void checkForUpdate(), CHECK_INTERVAL_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForUpdate()
  })
}

export function updateFound() {
  useUpdates.setState({ status: 'available' })
}

/** Asks the server for a newer version. */
export async function checkForUpdate() {
  if (!registration || useUpdates.getState().status === 'available') return
  useUpdates.setState({ status: 'checking' })
  try {
    await registration.update()
    // `updateFound` runs once a new worker has installed; give it a moment before saying "up to date".
    await new Promise((resolve) => setTimeout(resolve, 1500))
    if (registration.waiting || registration.installing) {
      if (registration.waiting) useUpdates.setState({ status: 'available' })
      else useUpdates.setState({ status: 'checking' })
    } else if (useUpdates.getState().status === 'checking') {
      useUpdates.setState({ status: 'upToDate', lastChecked: Date.now() })
    }
  } catch {
    if (useUpdates.getState().status === 'checking') useUpdates.setState({ status: 'failed', lastChecked: Date.now() })
  }
}

export const hasServiceWorker = () => registration !== null

/** Saves everything, then switches to the new version, which reloads the page. */
export async function reloadForUpdate() {
  await flushWorkspace(true)
  // The new worker reloads the page once it takes control. A page loaded before any worker was
  // installed (a first visit) is never taken over, so reload it directly if nothing happens.
  setTimeout(() => location.reload(), 1500)
  if (applyUpdate) await applyUpdate(true)
}

export function hideUpdateForSession() {
  useUpdates.setState({ hiddenForSession: true })
}
