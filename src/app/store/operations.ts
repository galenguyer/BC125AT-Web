import { create } from 'zustand'
import type { ScannerConfig } from '../../kit/model/config'
import { CancellationError, type Progress, type WriteReport } from '../../kit/sync/session'
import { makeWritePlan, type WritePlan } from '../../kit/sync/writePlan'
import { errorMessage } from '../messages'
import { saveBackup } from './backups'
import { live, selectedDevice } from './scanner'
import type { BackupRecord } from './db'

/** Every stage of Read, Write and Compare, each shown in one sheet (SPEC.md §7). */
export type Sheet =
  | { kind: 'none' }
  | { kind: 'reading'; progress: Progress }
  | { kind: 'readFinished'; config: ScannerConfig }
  | { kind: 'readFailed'; message: string }
  | { kind: 'checking'; progress: Progress }
  | { kind: 'upToDate' }
  | { kind: 'review'; plan: WritePlan; scanner: ScannerConfig }
  /** Compare with Scanner: the differences, with nothing to write. */
  | { kind: 'compared'; plan: WritePlan }
  | { kind: 'writing'; progress: Progress; plan: WritePlan }
  | { kind: 'writeFinished'; report: WriteReport; plan: WritePlan; backup: BackupRecord }
  | { kind: 'writeFailed'; message: string; backup: BackupRecord | null }

interface OperationsState {
  sheet: Sheet
}

export const useOperations = create<OperationsState>(() => ({ sheet: { kind: 'none' } }))

const set = (sheet: Sheet) => useOperations.setState({ sheet })
const current = () => useOperations.getState().sheet

let controller: AbortController | null = null

export const isBusy = (sheet: Sheet) => sheet.kind === 'reading' || sheet.kind === 'checking' || sheet.kind === 'writing'

/** Progress updates are throttled: every few steps is plenty for a progress bar. */
function throttled(kind: 'reading' | 'checking', every: number) {
  return (progress: Progress) => {
    if (progress.completed % every !== 0 && progress.completed !== progress.total) return
    const sheet = current()
    if (sheet.kind === kind) set({ ...sheet, progress })
  }
}

/** Reads the whole configuration, then calls `apply` with it. */
export async function read(apply: (config: ScannerConfig) => void) {
  if (isBusy(current())) return
  controller = new AbortController()
  const signal = controller.signal
  set({ kind: 'reading', progress: { completed: 0, total: 1 } })
  try {
    const config = await live.withScanner('Paused while reading from the scanner', true, (session) =>
      session.readConfiguration({ signal, progress: throttled('reading', 10) }),
    )
    apply(config)
    set({ kind: 'readFinished', config })
  } catch (error) {
    if (error instanceof CancellationError) set({ kind: 'none' })
    else set({ kind: 'readFailed', message: errorMessage(error, selectedDevice()?.kind) })
  }
}

/**
 * Reads the scanner and works out what writing `document` would change. With `compareOnly`, the
 * result is shown without the option to write.
 */
export async function prepare(document: ScannerConfig, compareOnly: boolean) {
  if (isBusy(current())) return
  controller = new AbortController()
  const signal = controller.signal
  set({ kind: 'checking', progress: { completed: 0, total: 1 } })
  try {
    const scanner = await live.withScanner('Paused while checking the scanner', true, (session) =>
      session.readConfiguration({ signal, progress: throttled('checking', 10) }),
    )
    const plan = makeWritePlan(scanner, document)
    set(plan.steps.length === 0 ? { kind: 'upToDate' } : compareOnly ? { kind: 'compared', plan } : { kind: 'review', plan, scanner })
  } catch (error) {
    if (error instanceof CancellationError) set({ kind: 'none' })
    else set({ kind: 'writeFailed', message: errorMessage(error, selectedDevice()?.kind), backup: null })
  }
}

/**
 * Writes the plan being reviewed. Backs up the scanner's current contents first; if the backup
 * can't be saved, nothing is written. `apply` gets the result so the document can be updated to
 * what the scanner actually stored.
 */
export async function write(apply: (report: WriteReport, plan: WritePlan) => void) {
  const sheet = current()
  if (sheet.kind !== 'review') return
  const { plan, scanner } = sheet
  let backup: BackupRecord
  try {
    backup = await saveBackup(scanner)
  } catch (error) {
    set({ kind: 'writeFailed', message: `Couldn't save a backup of the scanner, so nothing was written. ${errorMessage(error)}`, backup: null })
    return
  }
  controller = new AbortController()
  const signal = controller.signal
  set({ kind: 'writing', progress: { completed: 0, total: 1 }, plan })
  try {
    const report = await live.withScanner('Paused while writing to the scanner', true, (session) =>
      session.write(plan, {
        signal,
        progress: (progress) => {
          if (progress.completed % 5 !== 0 && progress.completed !== progress.total) return
          const now = current()
          if (now.kind === 'writing') set({ ...now, progress })
        },
      }),
    )
    apply(report, plan)
    set({ kind: 'writeFinished', report, plan, backup })
  } catch (error) {
    if (error instanceof CancellationError) {
      set({
        kind: 'writeFailed',
        message: `Writing was cancelled partway through, so the scanner may be partly updated. Read from the scanner to see what it holds now. Its previous contents are in the backup “${backup.name}”.`,
        backup,
      })
    } else {
      set({
        kind: 'writeFailed',
        message: `${errorMessage(error, selectedDevice()?.kind)}\n\nThe scanner may be partly updated. Its previous contents are in the backup “${backup.name}”.`,
        backup,
      })
    }
  }
}

export function cancel() {
  controller?.abort()
  if (current().kind === 'review') set({ kind: 'none' })
}

export function dismiss() {
  controller = null
  set({ kind: 'none' })
}

/** Sends `EPG` to recover a scanner left in program mode (SPEC.md §7). Leaves scan and hold alone. */
export function release(): Promise<void> {
  return live.withScanner('Paused while releasing the scanner', false, (session) => session.releaseProgramMode())
}
