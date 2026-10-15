import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { locationTitle } from '../../kit/model/validation'
import * as actions from '../actions'
import { gridCommands } from '../gridCommands'
import { useIssues } from '../hooks'
import { demoMode, preferredTransport, shortcutLabel, support, transportName, type TransportKind } from '../platform'
import { openPanel, setIssuesOpen, useDialogs } from '../store/dialogs'
import { documentTitle, isDirty, useDocument } from '../store/document'
import { isBusy, useOperations } from '../store/operations'
import { usePrefs } from '../store/prefs'
import { live, selectedDevice, useScanner } from '../store/scanner'
import { revealIssue, useUI } from '../store/ui'
import { checkForUpdate } from '../store/updates'
import { CheckCircleIcon, DownloadIcon, ErrorIcon, SidebarIcon, UploadIcon, WarningIcon } from './Icons'
import { Menubar, type MenuEntry, type MenubarMenu } from './Menu'

function connectItems(): MenuEntry[] {
  const preferred = preferredTransport()
  const kinds: TransportKind[] = []
  if (preferred) kinds.push(preferred)
  for (const kind of ['usb', 'serial'] as const) if (!kinds.includes(kind) && (kind === 'usb' ? support.usb : support.serial)) kinds.push(kind)
  if (kinds.length === 0) return [{ label: 'Connect Scanner…', disabled: true }]
  return kinds.map((kind, i) => ({ label: i === 0 ? `Connect Scanner… (${transportName(kind)})` : `Connect over ${transportName(kind)}…`, onSelect: () => void actions.connect(kind) }))
}

function menus(): MenubarMenu[] {
  return [
    {
      title: 'File',
      items: () => [
        { label: 'New', onSelect: () => void actions.newDocument() },
        { label: 'Open…', shortcut: shortcutLabel('mod+o'), onSelect: () => void actions.openDocument() },
        { kind: 'separator' },
        { label: 'Save', shortcut: shortcutLabel('mod+s'), onSelect: () => void actions.save() },
        { label: 'Save As…', shortcut: shortcutLabel('shift+mod+s'), onSelect: () => void actions.saveAs() },
        { kind: 'separator' },
        { label: 'Import Channels from CSV…', onSelect: () => void actions.importChannelsCSV() },
        { label: 'Export Channels as CSV…', onSelect: () => void actions.exportChannelsCSV() },
        { kind: 'separator' },
        { label: 'Import Uniden File…', onSelect: () => void actions.importUnidenFile() },
        { label: 'Export as Uniden File…', onSelect: () => void actions.exportUnidenFile() },
      ],
    },
    {
      title: 'Edit',
      items: () => {
        const doc = useDocument.getState()
        const grid = gridCommands.current
        const selection = grid?.hasSelection() ?? false
        return [
          { label: 'Undo', shortcut: shortcutLabel('mod+z'), disabled: doc.past.length === 0, onSelect: doc.undo },
          { label: 'Redo', shortcut: shortcutLabel('shift+mod+z'), disabled: doc.future.length === 0, onSelect: doc.redo },
          { kind: 'separator' },
          { label: 'Cut', shortcut: shortcutLabel('mod+x'), disabled: !selection, onSelect: () => grid?.cut() },
          { label: 'Copy', shortcut: shortcutLabel('mod+c'), disabled: !selection, onSelect: () => grid?.copy() },
          { label: 'Paste', shortcut: shortcutLabel('mod+v'), disabled: !grid, onSelect: () => grid?.paste() },
          { label: 'Clear Channels', disabled: !selection, onSelect: () => grid?.clear() },
          { kind: 'separator' },
          { label: 'Select All Channels', shortcut: shortcutLabel('mod+a'), disabled: !grid, onSelect: () => grid?.selectAll() },
          { label: 'Find', shortcut: shortcutLabel('mod+f'), disabled: !grid, onSelect: () => grid?.focusFilter() },
        ]
      },
    },
    {
      title: 'Scanner',
      items: () => {
        const canUse = actions.canUseScanner()
        const scanner = useScanner.getState()
        return [
          ...connectItems(),
          { kind: 'separator' },
          { label: 'Read from Scanner…', shortcut: shortcutLabel('shift+mod+r'), disabled: !canUse, onSelect: () => void actions.readFromScanner() },
          { label: 'Write to Scanner…', shortcut: shortcutLabel('shift+mod+u'), disabled: !canUse, onSelect: () => void actions.writeToScanner() },
          { label: 'Compare with Scanner…', shortcut: shortcutLabel('shift+mod+d'), disabled: !canUse, onSelect: () => void actions.compareWithScanner() },
          { kind: 'separator' },
          { label: 'Live View', checked: usePrefs.getState().liveEnabled, onSelect: actions.toggleLive },
          { label: 'Backups…', onSelect: () => openPanel('backups') },
          { label: 'Release Scanner', disabled: !selectedDevice(scanner) || scanner.busy, onSelect: () => void actions.releaseScanner() },
        ]
      },
    },
    {
      title: 'Help',
      items: () => [
        { label: 'About BC125AT CPS', onSelect: () => openPanel('about') },
        { label: 'Preferences…', shortcut: shortcutLabel('mod+,'), onSelect: () => openPanel('preferences') },
        { label: 'Check for Updates', onSelect: () => void checkForUpdate().then(() => openPanel('preferences')) },
        { kind: 'separator' },
        demoMode
          ? { label: 'Leave the Demo', onSelect: () => (location.search = '') }
          : { label: 'Try the Demo Scanner', onSelect: () => window.open('/?demo', '_blank') },
        { label: 'BC125AT CPS for Mac', onSelect: () => window.open('https://github.com/galenguyer/BC125AT-CPS', '_blank', 'noreferrer') },
      ],
    },
  ]
}

function ConnectionStatus() {
  const devices = useScanner((s) => s.devices)
  const device = useScanner((s) => selectedDevice(s))
  if (devices.length === 0) {
    const kind = preferredTransport()
    return (
      <button type="button" className="connection button" disabled={!kind} title={kind ? 'Choose your BC125AT in the browser’s list' : 'This browser can’t reach USB devices'} onClick={() => kind && void actions.connect(kind)}>
        <span className="dot" />
        <span className="label">Connect Scanner…</span>
      </button>
    )
  }
  return (
    <div className="connection" title={device?.kind === 'serial' ? 'Connected over Web Serial' : device?.kind === 'usb' ? 'Connected over WebUSB' : 'A simulated scanner'}>
      <span className="dot on" />
      {devices.length > 1 ? (
        <select className="select" aria-label="Scanner" value={device?.id} onChange={(e) => void live.select(e.target.value)}>
          {devices.map((d, i) => (
            <option key={d.id} value={d.id}>
              {d.label} ({d.kind === 'serial' ? 'Serial' : d.kind === 'usb' ? 'USB' : 'Demo'} {i + 1})
            </option>
          ))}
        </select>
      ) : (
        <span className="label">{device?.label}</span>
      )}
    </div>
  )
}

function IssuesButton() {
  const issues = useIssues()
  const open = useDialogs((s) => s.issuesOpen)
  const button = useRef<HTMLButtonElement>(null)
  const errors = issues.filter((i) => i.severity === 'error').length
  const label = issues.length === 0 ? 'No Issues' : issues.length === 1 ? '1 Issue' : `${issues.length} Issues`
  return (
    <>
      <button
        ref={button}
        type="button"
        className={`button issues-button ${issues.length === 0 ? '' : errors > 0 ? 'errors' : 'warnings'}`}
        title={issues.length === 0 ? 'Nothing in this document would cause a problem on the scanner' : 'Show problems that would affect writing to the scanner'}
        aria-expanded={open}
        onClick={() => setIssuesOpen(!open)}
      >
        {issues.length === 0 ? <CheckCircleIcon /> : errors > 0 ? <ErrorIcon /> : <WarningIcon />}
        <span className="hide-narrow">{label}</span>
      </button>
      {open && <IssuesPopover anchor={button.current} />}
    </>
  )
}

function IssuesPopover({ anchor }: { anchor: HTMLElement | null }) {
  const issues = useIssues()
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 50, left: 0 })
  useLayoutEffect(() => {
    const rect = anchor?.getBoundingClientRect()
    const width = ref.current?.offsetWidth ?? 420
    if (rect) setPosition({ top: rect.bottom + 6, left: Math.max(8, Math.min(rect.right - width, innerWidth - width - 8)) })
  }, [anchor])
  useLayoutEffect(() => {
    const close = (event: PointerEvent) => {
      if (ref.current?.contains(event.target as Node) || anchor?.contains(event.target as Node)) return
      setIssuesOpen(false)
    }
    const key = (event: KeyboardEvent) => event.key === 'Escape' && setIssuesOpen(false)
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', key)
    }
  }, [anchor])
  return createPortal(
    <div ref={ref} className="issues-popover" style={position} role="dialog" aria-label="Issues">
      {issues.length === 0 ? (
        <div className="none">
          <CheckCircleIcon size={28} />
          <div>
            <strong>No Issues</strong>
          </div>
          Everything here can be written to the scanner as is.
        </div>
      ) : (
        issues.map((issue, i) => (
          <button
            key={i}
            type="button"
            onClick={() => {
              setIssuesOpen(false)
              revealIssue(issue.location)
            }}
          >
            <span className={issue.severity === 'error' ? 'issue-badge error' : 'issue-badge'}>{issue.severity === 'error' ? <ErrorIcon title="Error" /> : <WarningIcon title="Warning" />}</span>
            <span>
              <div className="where">{locationTitle(issue.location)}</div>
              <div className="what">{issue.message}</div>
            </span>
          </button>
        ))
      )}
    </div>,
    document.body,
  )
}

export function TopBar() {
  const title = useDocument((s) => documentTitle(s))
  const dirty = useDocument((s) => isDirty(s))
  const hasDevice = useScanner((s) => selectedDevice(s) !== null)
  const busy = useScanner((s) => s.busy) || isBusy(useOperations((s) => s.sheet))
  const canUse = hasDevice && !busy
  const sidebarOpen = useUI((s) => s.sidebarOpen)
  return (
    <header className="topbar">
      <button type="button" className="icon-button sidebar-toggle" aria-label="Sections" aria-expanded={sidebarOpen} onClick={() => useUI.getState().setSidebarOpen(!sidebarOpen)}>
        <SidebarIcon />
      </button>
      <div className="topbar-brand">
        <img src="/icons/icon-192.png" alt="" />
      </div>
      <Menubar menus={menus()} />
      <div className="doc-title">
        <strong>{title}</strong>
        {dirty && <span className="edited">— Edited</span>}
        {demoMode && <span className="edited">· Demo scanner</span>}
      </div>
      <div className="topbar-actions">
        <ConnectionStatus />
        <button type="button" className="button" disabled={!canUse} title="Read the whole configuration from the connected scanner" onClick={() => void actions.readFromScanner()}>
          <DownloadIcon />
          <span className="hide-narrow">Read</span>
        </button>
        <button type="button" className="button" disabled={!canUse} title="Write this document to the connected scanner" onClick={() => void actions.writeToScanner()}>
          <UploadIcon />
          <span className="hide-narrow">Write</span>
        </button>
        <IssuesButton />
      </div>
    </header>
  )
}
