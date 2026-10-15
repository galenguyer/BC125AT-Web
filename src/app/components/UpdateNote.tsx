import { useOperations, isBusy } from '../store/operations'
import { useScanner } from '../store/scanner'
import { hideUpdateForSession, reloadForUpdate, useUpdates } from '../store/updates'
import { ArrowDownCircleIcon, CloseIcon } from './Icons'

/**
 * A one-line yellow note at the bottom of the sidebar when a new version has been deployed.
 * Reload saves the document (with its undo history) and switches to the new version; it waits
 * while the scanner is being read or written.
 */
export function UpdateNote() {
  const available = useUpdates((s) => s.status === 'available' && !s.hiddenForSession)
  const scannerBusy = useScanner((s) => s.busy)
  const sheetBusy = useOperations((s) => isBusy(s.sheet))
  const busy = scannerBusy || sheetBusy
  if (!available) return null
  return (
    <div className="update-note" role="status">
      <ArrowDownCircleIcon />
      <button
        type="button"
        className="grow"
        disabled={busy}
        title={busy ? 'Finish with the scanner first' : 'Reload to use the new version. Your document is kept.'}
        onClick={() => void reloadForUpdate()}
      >
        {busy ? 'Update ready after this finishes' : 'Update available: Reload'}
      </button>
      <button type="button" title="Later: hide until next time" aria-label="Hide update note until next time" onClick={hideUpdateForSession}>
        <CloseIcon />
      </button>
    </div>
  )
}
