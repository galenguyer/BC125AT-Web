import { useState } from 'react'
import { bankOfChannel } from '../../kit/model/channel'
import { BANK_COUNT, usedChannelCount, usedChannelCountInBank } from '../../kit/model/config'
import { dropOnBank, isChannelDrag, readDrag } from '../drag'
import { useIssues } from '../hooks'
import { useDocument } from '../store/document'
import { sameSection, useUI, type Section } from '../store/ui'
import { AntennaIcon, ErrorIcon, GearIcon, ListIcon, NoSignIcon } from './Icons'
import { openContextMenu } from './Menu'
import { UpdateNote } from './UpdateNote'

function Row({
  section,
  icon,
  label,
  badge,
  title,
  children,
  onContextMenu,
  onDropChannels,
}: {
  section: Section
  icon: React.ReactNode
  label: React.ReactNode
  badge?: number
  title?: string
  children?: React.ReactNode
  onContextMenu?: (event: React.MouseEvent) => void
  onDropChannels?: (data: DataTransfer) => void
}) {
  const current = useUI((s) => s.section)
  const selected = sameSection(current, section)
  const [dropTarget, setDropTarget] = useState(false)
  return (
    <button
      type="button"
      className={`sidebar-row${selected ? ' selected' : ''}${dropTarget ? ' drop-target' : ''}`}
      aria-current={selected ? 'page' : undefined}
      title={title}
      onClick={() => useUI.getState().setSection(section)}
      onContextMenu={onContextMenu}
      onDragOver={
        onDropChannels &&
        ((event) => {
          if (!isChannelDrag(event.dataTransfer)) return
          event.preventDefault()
          setDropTarget(true)
        })
      }
      onDragLeave={() => setDropTarget(false)}
      onDrop={
        onDropChannels &&
        ((event) => {
          event.preventDefault()
          setDropTarget(false)
          onDropChannels(event.dataTransfer)
        })
      }
    >
      {icon}
      <span className="label">{label}</span>
      {children}
      {badge !== undefined && <span className="badge">{badge}</span>}
    </button>
  )
}

function BankRow({ bank, hasErrors }: { bank: number; hasErrors: boolean }) {
  const name = useDocument((s) => s.config.bankNames[bank - 1])
  const scanEnabled = useDocument((s) => s.config.bankScanEnabled[bank - 1])
  const used = useDocument((s) => usedChannelCountInBank(s.config, bank))
  const toggleScan = () =>
    useDocument.getState().edit((config) => {
      config.bankScanEnabled[bank - 1] = !config.bankScanEnabled[bank - 1]
    })
  return (
    <Row
      section={{ kind: 'bank', bank }}
      icon={<span className={`bank-number${scanEnabled ? '' : ' off'}`} aria-label={scanEnabled ? 'Scan enabled' : 'Scan disabled'}>{bank % 10}</span>}
      label={name === '' ? `Bank ${bank}` : `${bank} · ${name}`}
      badge={used}
      title={scanEnabled ? `Bank ${bank} is included when scanning` : `Bank ${bank} is skipped when scanning`}
      onContextMenu={(event) => openContextMenu(event, [{ label: 'Include in Scan', checked: scanEnabled, onSelect: toggleScan }])}
      onDropChannels={(data) => {
        const drag = readDrag(data)
        if (!drag) return
        let placed: number[] | null = null
        useDocument.getState().edit((config) => {
          placed = dropOnBank(config, drag, bank)
        })
        if (placed) useUI.getState().setSelection(placed)
        else useUI.getState().toast(`Bank ${bank} doesn't have room for ${drag.numbers.length === 1 ? 'that channel' : `${drag.numbers.length} channels`}.`)
      }}
    >
      {hasErrors && (
        <span className="error-mark" title="Has errors">
          <ErrorIcon size={12} title="Has errors" />
        </span>
      )}
    </Row>
  )
}

export function Sidebar() {
  const open = useUI((s) => s.sidebarOpen)
  const used = useDocument((s) => usedChannelCount(s.config))
  const lockouts = useDocument((s) => s.config.globalLockouts.length)
  const issues = useIssues()
  const banksWithErrors = new Set(issues.flatMap((i) => (i.severity === 'error' && i.location.kind === 'channel' ? [bankOfChannel(i.location.number)] : [])))

  return (
    <nav className={`sidebar${open ? ' open' : ''}`} aria-label="Sections">
      <div className="sidebar-scroll">
        <div className="sidebar-heading">Channels</div>
        <Row section={{ kind: 'allChannels' }} icon={<span className="row-icon"><ListIcon /></span>} label="All Channels" badge={used} />
        {Array.from({ length: BANK_COUNT }, (_, i) => (
          <BankRow key={i} bank={i + 1} hasErrors={banksWithErrors.has(i + 1)} />
        ))}
        <div className="sidebar-heading">Scanner</div>
        <Row section={{ kind: 'search' }} icon={<span className="row-icon"><AntennaIcon /></span>} label="Search & Close Call" />
        <Row section={{ kind: 'globalLockouts' }} icon={<span className="row-icon"><NoSignIcon /></span>} label="Global Lockouts" badge={lockouts} />
        <Row section={{ kind: 'settings' }} icon={<span className="row-icon"><GearIcon /></span>} label="Settings" />
      </div>
      <UpdateNote />
    </nav>
  )
}
