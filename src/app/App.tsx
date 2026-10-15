import { useEffect } from 'react'
import { create } from 'zustand'
import * as actions from './actions'
import { gridCommands } from './gridCommands'
import { matchesShortcut } from './platform'
import { openPanel, useDialogs } from './store/dialogs'
import { useDocument } from './store/document'
import { isBusy, useOperations } from './store/operations'
import { useScanner } from './store/scanner'
import { useUI } from './store/ui'
import { requestTakeOver } from './store/workspace'
import { BrowserBanner } from './components/BrowserBanner'
import { ChannelView } from './components/ChannelView'
import { ContextMenuHost } from './components/Menu'
import { LiveBar } from './components/LiveBar'
import { PanelHost } from './components/Panels'
import { LockoutsView, SearchView, SettingsView } from './components/SectionViews'
import { DialogHost, OperationSheet } from './components/Sheets'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'

/** Whether another tab holds the workspace (and the scanner), so this one is idle. */
export const useTabState = create<{ elsewhere: boolean; waiting: boolean }>(() => ({ elsewhere: false, waiting: false }))

function Detail() {
  const section = useUI((s) => s.section)
  switch (section.kind) {
    case 'allChannels':
      return <ChannelView bank={null} />
    case 'bank':
      return <ChannelView bank={section.bank} />
    case 'search':
      return <SearchView />
    case 'globalLockouts':
      return <LockoutsView />
    case 'settings':
      return <SettingsView />
  }
}

function Toasts() {
  const toasts = useUI((s) => s.toasts)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          {t.message}
        </div>
      ))}
    </div>
  )
}

const isTextField = (element: Element | null) =>
  element instanceof HTMLTextAreaElement || (element instanceof HTMLInputElement && !['checkbox', 'radio', 'range', 'button'].includes(element.type))

/** Keyboard shortcuts, as in the macOS app's menus (⌘ on a Mac, Ctrl elsewhere). */
function useShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (useDialogs.getState().dialogs.length > 0 || useDialogs.getState().panel !== 'none' || useOperations.getState().sheet.kind !== 'none') return
      const run = (action: () => unknown) => {
        event.preventDefault()
        void action()
      }
      if (matchesShortcut(event, 'mod+o')) return run(actions.openDocument)
      if (matchesShortcut(event, 'mod+s')) return run(actions.save)
      if (matchesShortcut(event, 'shift+mod+s')) return run(actions.saveAs)
      if (matchesShortcut(event, 'shift+mod+r')) return run(actions.readFromScanner)
      if (matchesShortcut(event, 'shift+mod+u')) return run(actions.writeToScanner)
      if (matchesShortcut(event, 'shift+mod+d')) return run(actions.compareWithScanner)
      if (matchesShortcut(event, 'mod+,')) return run(() => openPanel('preferences'))
      if (matchesShortcut(event, 'mod+f') && gridCommands.current) return run(() => gridCommands.current?.focusFilter())
      // Text fields keep their own undo.
      if (isTextField(document.activeElement)) return
      if (matchesShortcut(event, 'mod+z')) return run(useDocument.getState().undo)
      if (matchesShortcut(event, 'shift+mod+z') || matchesShortcut(event, 'mod+y')) return run(useDocument.getState().redo)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

/** Leaving mid-write could leave the scanner in program mode, so ask first. */
function useUnloadGuard() {
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (useScanner.getState().busy || isBusy(useOperations.getState().sheet)) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])
}

export function ElsewhereOverlay({ onUseHere }: { onUseHere: () => void }) {
  const waiting = useTabState((s) => s.waiting)
  return (
    <div className="overlay">
      <div className="sheet">
        <img src="/icons/icon-192.png" alt="" width={64} height={64} style={{ borderRadius: 14 }} />
        <h2>BC125AT CPS Is Open in Another Tab</h2>
        <p className="note">Only one tab can use the document and the scanner at a time. Your work is saved there.</p>
        <div className="sheet-buttons" style={{ justifyContent: 'center' }}>
          <button
            type="button"
            className="button primary"
            disabled={waiting}
            onClick={() => {
              useTabState.setState({ waiting: true })
              requestTakeOver()
              onUseHere()
            }}
          >
            {waiting ? 'Waiting for the other tab…' : 'Use Here'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function App({ onUseHere }: { onUseHere: () => void }) {
  useShortcuts()
  useUnloadGuard()
  const elsewhere = useTabState((s) => s.elsewhere)
  const sidebarOpen = useUI((s) => s.sidebarOpen)
  return (
    <div className="app">
      <TopBar />
      <BrowserBanner />
      <div className="main" onClick={sidebarOpen ? (e) => !(e.target as Element).closest('.sidebar') && useUI.getState().setSidebarOpen(false) : undefined}>
        <Sidebar />
        <main className="detail" style={{ minWidth: 0 }}>
          <Detail />
        </main>
      </div>
      <LiveBar />
      <OperationSheet />
      <PanelHost />
      <DialogHost />
      <ContextMenuHost />
      <Toasts />
      {elsewhere && <ElsewhereOverlay onUseHere={onUseHere} />}
    </div>
  )
}
