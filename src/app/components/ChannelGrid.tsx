import { useVirtualizer } from '@tanstack/react-virtual'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { delayName, delays, emptyChannel, isEmptyChannel, modulationName, modulations, type Channel, type Delay, type Modulation } from '../../kit/model/channel'
import { CHANNEL_COUNT, channelAt } from '../../kit/model/config'
import { mhz, parseFrequency } from '../../kit/model/frequency'
import { editChannels, setChannelFrequency } from '../../kit/model/moves'
import { toneName } from '../../kit/model/tone'
import type { ValidationIssue } from '../../kit/model/validation'
import { channelsFromClipboard, clipboardText } from '../../kit/formats/clipboard'
import { DRAG_TYPE, dropOnChannel, isChannelDrag, readDrag, tabID, type ChannelDrag } from '../drag'
import { gridCommands } from '../gridCommands'
import { useIssues } from '../hooks'
import { isPrimaryModifier } from '../platform'
import { useDocument } from '../store/document'
import { usePrefs } from '../store/prefs'
import { canControl, live, useScanner } from '../store/scanner'
import { useUI } from '../store/ui'
import { toneMenu } from './Fields'
import { ChevronIcon, ErrorIcon, WarningIcon } from './Icons'
import { openContextMenu, openMenuBelow, type MenuEntry } from './Menu'

type Column = 'name' | 'frequency' | 'modulation' | 'tone' | 'delay' | 'lockout' | 'priority'
/** The columns a cell can be selected in, left to right. */
const COLUMNS: Column[] = ['name', 'frequency', 'modulation', 'tone', 'delay', 'lockout', 'priority']
const TEXT_COLUMNS: Column[] = ['name', 'frequency']
const ROW_HEIGHT = 28

export type SortKey = 'number' | 'name' | 'frequency'
export interface Sort {
  key: SortKey
  ascending: boolean
}

interface Row {
  number: number
  channel: Channel
  issues: ValidationIssue[]
}

interface Focus {
  number: number
  column: Column
}

interface Editing extends Focus {
  /** What the field starts with: the current value, or the character typed to start editing. */
  initial: string
  /** Typing replaced the value; put the caret at the end instead of selecting everything. */
  typed: boolean
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** One undo step that applies `change` to `numbers`, mirroring the scanner's one-priority-per-bank rule. */
function edit(numbers: number[], change: (channel: Channel) => Channel | void) {
  if (numbers.length === 0) return
  useDocument.getState().edit((config) => editChannels(config, numbers, change))
}

const used = (numbers: number[]) => {
  const config = useDocument.getState().config
  return numbers.filter((n) => !isEmptyChannel(channelAt(config, n)))
}

// MARK: Cells

interface Handlers {
  cellDown(event: React.MouseEvent, number: number, column: Column | 'number'): void
  doubleClick(number: number, column: Column): void
  commitText(number: number, column: Column, text: string): void
  endEditing(move: 'none' | 'next' | 'previous', cancelled: boolean): void
  contextMenu(event: React.MouseEvent, number: number): void
  dragStart(event: React.DragEvent, number: number): void
  dragOver(event: React.DragEvent, number: number): void
  drop(event: React.DragEvent, number: number): void
  dragEnd(): void
  openTone(element: HTMLElement, number: number): void
  returnFocus(): void
}

function CellEditor({ editing, number, column, handlers }: { editing: Editing; number: number; column: Column; handlers: Handlers }) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  const [text, setText] = useState(editing.initial)
  useEffect(() => {
    const input = ref.current
    if (!input) return
    input.focus()
    if (editing.typed) input.setSelectionRange(input.value.length, input.value.length)
    else input.select()
  }, [editing])
  const finish = (move: 'none' | 'next' | 'previous', cancelled: boolean) => {
    if (done.current) return
    done.current = true
    if (!cancelled) handlers.commitText(number, column, text)
    handlers.endEditing(move, cancelled)
  }
  return (
    <input
      ref={ref}
      className={`cell-input${column === 'frequency' ? ' num' : ''}`}
      value={text}
      aria-label={`Channel ${number} ${column}`}
      inputMode={column === 'frequency' ? 'decimal' : undefined}
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish('none', false)}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') {
          event.preventDefault()
          finish('none', false)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          finish('none', true)
        } else if (event.key === 'Tab') {
          event.preventDefault()
          finish(event.shiftKey ? 'previous' : 'next', false)
        }
      }}
    />
  )
}

interface RowProps {
  row: Row
  top: number
  odd: boolean
  selected: boolean
  cellMode: boolean
  focusColumn: Column | null
  editing: Editing | null
  dropTarget: boolean
  handlers: Handlers
}

const GridRow = memo(function GridRow({ row, top, odd, selected, cellMode, focusColumn, editing, dropTarget, handlers }: RowProps) {
  const { number, channel, issues } = row
  const empty = isEmptyChannel(channel)
  const errors = issues.filter((i) => i.severity === 'error')
  const classes = ['grid-row', selected ? (cellMode ? 'selected-cell-mode' : 'selected') : '', empty ? 'empty' : '', dropTarget ? 'drop-target' : '']
  const cellClass = (column: Column, extra = '') => `cell ${extra}${focusColumn === column ? ' focused' : ''}`
  const down = (column: Column | 'number') => (event: React.MouseEvent) => handlers.cellDown(event, number, column)

  return (
    <div
      className={classes.join(' ')}
      style={{ transform: `translateY(${top}px)`, background: !selected && odd ? 'var(--bg-row-alt)' : undefined }}
      role="row"
      aria-rowindex={number}
      aria-selected={selected}
      draggable={!editing}
      onDragStart={(e) => handlers.dragStart(e, number)}
      onDragOver={(e) => handlers.dragOver(e, number)}
      onDrop={(e) => handlers.drop(e, number)}
      onDragEnd={handlers.dragEnd}
      onContextMenu={(e) => handlers.contextMenu(e, number)}
    >
      <div className="cell center" role="gridcell">
        {issues.length > 0 && (
          <span className={`issue-badge${errors.length ? ' error' : ''}`} title={issues.map((i) => i.message).join('\n')}>
            {errors.length ? <ErrorIcon size={13} title={`${issues.length} issues`} /> : <WarningIcon size={13} title={`${issues.length} warnings`} />}
          </span>
        )}
      </div>
      <div className="cell number num" role="rowheader" onMouseDown={down('number')} title="Drag to move">
        {number}
      </div>
      <div className={cellClass('name', 'text')} role="gridcell" onMouseDown={down('name')} onDoubleClick={() => handlers.doubleClick(number, 'name')}>
        {editing?.column === 'name' ? (
          <CellEditor editing={editing} number={number} column="name" handlers={handlers} />
        ) : (
          <span className="text-value">{channel.name}</span>
        )}
      </div>
      <div className={cellClass('frequency', 'text num')} role="gridcell" onMouseDown={down('frequency')} onDoubleClick={() => handlers.doubleClick(number, 'frequency')}>
        {editing?.column === 'frequency' ? (
          <CellEditor editing={editing} number={number} column="frequency" handlers={handlers} />
        ) : channel.frequency === null ? (
          ''
        ) : (
          mhz(channel.frequency)
        )}
      </div>
      <div className={cellClass('modulation')} role="gridcell" onMouseDown={down('modulation')}>
        {!empty && (
          <select
            className="cell-select"
            data-column="modulation"
            aria-label={`Channel ${number} modulation`}
            value={channel.modulation}
            tabIndex={-1}
            onChange={(e) => {
              const modulation = e.target.value as Modulation
              edit([number], (c) => ({ ...c, modulation }))
              handlers.returnFocus()
            }}
          >
            {modulations.map((m) => (
              <option key={m} value={m}>
                {modulationName(m)}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className={cellClass('tone')} role="gridcell" onMouseDown={down('tone')}>
        {!empty && (
          <button type="button" className="tone-button" data-column="tone" tabIndex={-1} aria-label={`Channel ${number} tone`} aria-haspopup="menu" onClick={(e) => handlers.openTone(e.currentTarget, number)}>
            <span>{toneName(channel.tone)}</span>
            <ChevronIcon />
          </button>
        )}
      </div>
      <div className={cellClass('delay')} role="gridcell" onMouseDown={down('delay')}>
        {!empty && (
          <select
            className="cell-select"
            data-column="delay"
            aria-label={`Channel ${number} delay`}
            value={channel.delay}
            tabIndex={-1}
            onChange={(e) => {
              const delay = Number(e.target.value) as Delay
              edit([number], (c) => ({ ...c, delay }))
              handlers.returnFocus()
            }}
          >
            {delays.map((d) => (
              <option key={d} value={d}>
                {delayName(d)}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className={cellClass('lockout', 'center')} role="gridcell" onMouseDown={down('lockout')}>
        {!empty && (
          <input
            type="checkbox"
            className="checkbox"
            tabIndex={-1}
            aria-label={`Channel ${number} locked out`}
            checked={channel.lockedOut}
            onChange={(e) => {
              const lockedOut = e.target.checked
              edit([number], (c) => ({ ...c, lockedOut }))
              handlers.returnFocus()
            }}
          />
        )}
      </div>
      <div className={cellClass('priority', 'center')} role="gridcell" onMouseDown={down('priority')}>
        {!empty && (
          <input
            type="checkbox"
            className="checkbox"
            tabIndex={-1}
            aria-label={`Channel ${number} priority`}
            checked={channel.priority}
            onChange={(e) => {
              const priority = e.target.checked
              edit([number], (c) => ({ ...c, priority }))
              handlers.returnFocus()
            }}
          />
        )}
      </div>
    </div>
  )
})

// MARK: Grid

export function ChannelGrid({ numbers, sort, setSort, query }: { numbers: number[]; sort: Sort; setSort: (sort: Sort) => void; query: string }) {
  const channels = useDocument((s) => s.config.channels)
  const issues = useIssues()
  const showEmpty = usePrefs((s) => s.showEmptyChannels)
  const selection = useUI((s) => s.selection)
  const reveal = useUI((s) => s.reveal)
  const listenable = useScanner((s) => canControl(s))
  const [focus, setFocus] = useState<Focus | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const anchor = useRef<number | null>(null)
  const typed = useRef({ digits: '', at: 0 })

  const rows = useMemo<Row[]>(() => {
    const trimmed = query.trim().toLowerCase()
    const byChannel = new Map<number, ValidationIssue[]>()
    for (const issue of issues) {
      if (issue.location.kind !== 'channel') continue
      const list = byChannel.get(issue.location.number)
      if (list) list.push(issue)
      else byChannel.set(issue.location.number, [issue])
    }
    const result: Row[] = []
    for (const number of numbers) {
      const channel = channels[number - 1]
      if (isEmptyChannel(channel) && !showEmpty && channel.name === '') continue
      if (trimmed !== '' && !channel.name.toLowerCase().includes(trimmed) && !(channel.frequency !== null && mhz(channel.frequency).startsWith(trimmed))) continue
      result.push({ number, channel, issues: byChannel.get(number) ?? [] })
    }
    if (sort.key === 'name') {
      result.sort((a, b) => collator.compare(a.channel.name, b.channel.name) || a.number - b.number)
    } else if (sort.key === 'frequency') {
      // Empty channels sort after every frequency.
      result.sort((a, b) => {
        const x = a.channel.frequency
        const y = b.channel.frequency
        if (x !== null && y !== null) return x - y || a.number - b.number
        if (x !== null) return -1
        if (y !== null) return 1
        return a.number - b.number
      })
    }
    if (!sort.ascending) result.reverse()
    return result
  }, [channels, numbers, showEmpty, query, sort, issues])

  const indexOf = useMemo(() => new Map(rows.map((row, i) => [row.number, i])), [rows])
  const selected = useMemo(() => new Set(selection), [selection])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  // Switching banks starts fresh, as a new table would.
  useEffect(() => {
    setFocus(null)
    setEditing(null)
    anchor.current = null
    scrollRef.current?.scrollTo({ top: 0 })
  }, [numbers])

  const scrollTo = useCallback(
    (number: number) => {
      const index = indexOf.get(number)
      if (index !== undefined) virtualizer.scrollToIndex(index, { align: 'auto' })
    },
    [indexOf, virtualizer],
  )

  // An issue chosen in the issues list: select its channel and bring it into view.
  useEffect(() => {
    if (reveal === null) return
    if (!indexOf.has(reveal)) {
      if (!showEmpty && isEmptyChannel(channels[reveal - 1])) usePrefs.getState().set({ showEmptyChannels: true })
      return
    }
    useUI.getState().clearReveal()
    setFocus(null)
    scrollTo(reveal)
    scrollRef.current?.focus({ preventScroll: true })
  }, [reveal, indexOf, scrollTo, showEmpty, channels])

  const select = (numbersToSelect: number[]) => useUI.getState().setSelection(numbersToSelect)
  const returnFocus = () => scrollRef.current?.focus({ preventScroll: true })

  const moveFocus = (next: Focus) => {
    setFocus(next)
    select([next.number])
    anchor.current = next.number
    scrollTo(next.number)
  }

  const beginEditing = (number: number, column: Column, typedText?: string) => {
    const channel = useDocument.getState().config.channels[number - 1]
    const current = column === 'name' ? channel.name : channel.frequency === null ? '' : mhz(channel.frequency)
    setFocus({ number, column })
    select([number])
    anchor.current = number
    scrollTo(number)
    setEditing({ number, column, initial: typedText ?? current, typed: typedText !== undefined })
  }

  /** The editable cell after (or before) one, in display order: Name, then Frequency, then the next row's Name. */
  const neighbourText = (from: Focus, forward: boolean): Focus | null => {
    const cells = rows.flatMap((row) => TEXT_COLUMNS.map((column) => ({ number: row.number, column })))
    const index = cells.findIndex((c) => c.number === from.number && c.column === from.column)
    const next = index < 0 ? null : cells[index + (forward ? 1 : -1)]
    return next ?? null
  }

  // MARK: Edits

  const clearChannels = (list: number[]) => {
    if (list.length === 0) return
    useDocument.getState().edit((config) => {
      for (const n of list) config.channels[n - 1] = emptyChannel()
    })
  }

  const copy = (list: number[]) => {
    if (list.length === 0) return ''
    const config = useDocument.getState().config
    return clipboardText(list.map((n) => channelAt(config, n)))
  }

  /** Pastes into consecutive channels starting at the first selected one (or the first in view), stopping at 500. */
  const paste = (text: string) => {
    const pasted = channelsFromClipboard(text)
    if (!pasted) {
      useUI.getState().toast("The clipboard doesn't hold channels or frequencies this app understands.")
      return
    }
    const sortedSelection = [...useUI.getState().selection].sort((a, b) => a - b)
    const start = sortedSelection[0] ?? numbers[0] ?? 1
    const targets: number[] = []
    for (let n = start; n < Math.min(start + pasted.length, CHANNEL_COUNT + 1); n++) targets.push(n)
    useDocument.getState().edit((config) => {
      targets.forEach((n, i) => (config.channels[n - 1] = pasted[i]))
    })
    select(targets)
    setFocus(null)
    if (targets.length < pasted.length) useUI.getState().toast(`Only ${targets.length} of ${pasted.length} channels fit before channel 500.`)
  }

  const selectedNumbers = () => [...useUI.getState().selection].sort((a, b) => a - b)

  // Edit menu and clipboard events.
  useEffect(() => {
    gridCommands.current = {
      copy: () => void navigator.clipboard.writeText(copy(selectedNumbers())),
      cut: () => {
        const list = selectedNumbers()
        void navigator.clipboard.writeText(copy(list)).then(() => clearChannels(list))
      },
      paste: () =>
        void navigator.clipboard.readText().then(paste, () => useUI.getState().toast('The browser didn’t allow reading the clipboard. Press the paste shortcut instead.')),
      clear: () => clearChannels(selectedNumbers()),
      selectAll: () => {
        setFocus(null)
        select(rows.map((r) => r.number))
        returnFocus()
      },
      focusFilter: () => document.getElementById('channel-filter')?.focus(),
      hasSelection: () => useUI.getState().selection.length > 0,
    }
    return () => {
      gridCommands.current = null
    }
  })

  useEffect(() => {
    const inGrid = () => {
      const active = document.activeElement
      return active === scrollRef.current || (active instanceof HTMLElement && scrollRef.current?.contains(active) && active.tagName !== 'INPUT')
    }
    const onCopy = (event: ClipboardEvent) => {
      if (!inGrid() || useUI.getState().selection.length === 0) return
      event.preventDefault()
      event.clipboardData?.setData('text/plain', copy(selectedNumbers()))
    }
    const onCut = (event: ClipboardEvent) => {
      if (!inGrid() || useUI.getState().selection.length === 0) return
      onCopy(event)
      clearChannels(selectedNumbers())
    }
    const onPaste = (event: ClipboardEvent) => {
      if (!inGrid()) return
      event.preventDefault()
      paste(event.clipboardData?.getData('text/plain') ?? '')
    }
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCut)
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCut)
      document.removeEventListener('paste', onPaste)
    }
  })

  // MARK: Handlers

  const handlers: Handlers = {
    cellDown(event, number, column) {
      if (event.button !== 0) {
        if (event.button === 2 && !selected.has(number)) {
          select([number])
          setFocus(null)
        }
        return
      }
      const primary = isPrimaryModifier(event)
      if (event.shiftKey && anchor.current !== null && indexOf.has(anchor.current)) {
        const a = indexOf.get(anchor.current)!
        const b = indexOf.get(number)!
        select(rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => r.number))
        setFocus(null)
        event.preventDefault()
      } else if (primary) {
        select(selected.has(number) ? selection.filter((n) => n !== number) : [...selection, number])
        anchor.current = number
        setFocus(null)
        event.preventDefault()
      } else if (column === 'number') {
        select([number])
        anchor.current = number
        setFocus(null)
      } else {
        select([number])
        anchor.current = number
        setFocus({ number, column })
      }
      // Keep keyboard focus on the grid, except for controls that take it themselves.
      const target = event.target as HTMLElement
      if (!target.closest('select, input, button')) {
        event.preventDefault()
        if (!editing) returnFocus()
      }
    },
    doubleClick(number, column) {
      if (TEXT_COLUMNS.includes(column)) beginEditing(number, column)
    },
    commitText(number, column, text) {
      const config = useDocument.getState().config
      const channel = config.channels[number - 1]
      if (column === 'name') {
        if (text !== channel.name) edit([number], (c) => ({ ...c, name: text }))
        return
      }
      const trimmed = text.trim()
      const current = channel.frequency === null ? '' : mhz(channel.frequency)
      if (trimmed === current) return
      if (trimmed === '') {
        // Clearing a frequency empties the channel.
        if (!isEmptyChannel(channel)) useDocument.getState().edit((draft) => setChannelFrequency(draft, number, null))
        return
      }
      const frequency = parseFrequency(trimmed)
      if (frequency === null) {
        useUI.getState().toast(`“${trimmed}” isn't a frequency. Type it in MHz, such as 162.55.`)
        return
      }
      useDocument.getState().edit((draft) => setChannelFrequency(draft, number, frequency))
    },
    endEditing(move, cancelled) {
      const current = editing
      setEditing(null)
      if (!current) return
      if (move !== 'none' && !cancelled) {
        const next = neighbourText(current, move === 'next')
        if (next) {
          // Wait for the commit to land before starting the next edit.
          setTimeout(() => beginEditing(next.number, next.column), 0)
          return
        }
      }
      returnFocus()
    },
    contextMenu(event, number) {
      const list = selected.has(number) ? selectedNumbers() : [number]
      if (!selected.has(number)) {
        select([number])
        setFocus(null)
      }
      const inUse = used(list)
      const config = useDocument.getState().config
      const items: MenuEntry[] = []
      if (list.length === 1 && inUse.length === 1 && listenable) {
        items.push({ label: 'Listen on Scanner', onSelect: () => live.hold(number) }, { kind: 'separator' })
      }
      items.push(
        { label: 'Copy', onSelect: () => void navigator.clipboard.writeText(copy(list)) },
        { label: list.length === 1 ? 'Clear Channel' : `Clear ${list.length} Channels`, onSelect: () => clearChannels(list) },
      )
      if (inUse.length > 0) {
        const common = <T,>(value: (c: Channel) => T) => {
          const values = inUse.map((n) => value(channelAt(config, n)))
          return values.every((v) => v === values[0]) ? values[0] : null
        }
        const mod = common((c) => c.modulation)
        const dly = common((c) => c.delay)
        items.push(
          { kind: 'separator' },
          { label: 'Modulation', submenu: modulations.map((m) => ({ label: modulationName(m), checked: mod === m, onSelect: () => edit(inUse, (c) => ({ ...c, modulation: m })) })) },
          { label: 'Tone', submenu: toneMenu(common((c) => c.tone), (tone) => edit(inUse, (c) => ({ ...c, tone }))) },
          { label: 'Delay', submenu: delays.map((d) => ({ label: delayName(d), checked: dly === d, onSelect: () => edit(inUse, (c) => ({ ...c, delay: d })) })) },
          { kind: 'separator' },
          { label: 'Lock Out', onSelect: () => edit(inUse, (c) => ({ ...c, lockedOut: true })) },
          { label: 'Unlock', onSelect: () => edit(inUse, (c) => ({ ...c, lockedOut: false })) },
        )
        if (inUse.length === 1) {
          const priority = channelAt(config, inUse[0]).priority
          items.push({ label: priority ? 'Remove Priority' : 'Make Priority Channel', onSelect: () => edit(inUse, (c) => ({ ...c, priority: !priority })) })
        }
      }
      openContextMenu(event, items)
    },
    dragStart(event, number) {
      const list = selected.has(number) ? selectedNumbers() : [number]
      if (!selected.has(number)) select([number])
      const config = useDocument.getState().config
      const drag: ChannelDrag = { source: tabID, numbers: list, channels: list.map((n) => channelAt(config, n)) }
      event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(drag))
      event.dataTransfer.setData('text/plain', copy(list))
      event.dataTransfer.effectAllowed = 'copyMove'
    },
    dragOver(event, number) {
      if (!isChannelDrag(event.dataTransfer)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      if (dropTarget !== number) setDropTarget(number)
    },
    drop(event, number) {
      event.preventDefault()
      setDropTarget(null)
      const drag = readDrag(event.dataTransfer)
      if (!drag) return
      let placed: number[] = []
      useDocument.getState().edit((config) => {
        placed = dropOnChannel(config, drag, number)
      })
      select(placed)
      setFocus(null)
      if (placed.length < drag.numbers.length) useUI.getState().toast(`Only ${placed.length} of ${drag.numbers.length} channels fit before channel 500.`)
    },
    dragEnd() {
      setDropTarget(null)
    },
    openTone(element, number) {
      const channel = useDocument.getState().config.channels[number - 1]
      openMenuBelow(element, toneMenu(channel.tone, (tone) => edit([number], (c) => ({ ...c, tone }))))
    },
    returnFocus,
  }

  // MARK: Keyboard

  const activate = (target: Focus) => {
    const channel = useDocument.getState().config.channels[target.number - 1]
    if (TEXT_COLUMNS.includes(target.column)) return beginEditing(target.number, target.column)
    if (isEmptyChannel(channel)) return
    const cell = scrollRef.current?.querySelector<HTMLElement>(`[aria-rowindex="${target.number}"] [data-column="${target.column}"]`)
    switch (target.column) {
      case 'lockout':
        return edit([target.number], (c) => ({ ...c, lockedOut: !c.lockedOut }))
      case 'priority':
        return edit([target.number], (c) => ({ ...c, priority: !c.priority }))
      case 'tone':
        if (cell) handlers.openTone(cell, target.number)
        return
      default:
        if (cell instanceof HTMLSelectElement) {
          cell.focus()
          try {
            cell.showPicker()
          } catch {
            // Not supported; the select is focused, and arrows change it.
          }
        }
    }
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.target !== scrollRef.current) return
    const primary = isPrimaryModifier(event)
    if (focus && indexOf.has(focus.number)) {
      const row = indexOf.get(focus.number)!
      const column = COLUMNS.indexOf(focus.column)
      const go = (r: number, c: number) => {
        const nextRow = rows[Math.max(0, Math.min(rows.length - 1, r))]
        if (nextRow) moveFocus({ number: nextRow.number, column: COLUMNS[Math.max(0, Math.min(COLUMNS.length - 1, c))] })
      }
      switch (event.key) {
        case 'ArrowUp':
          go(row - 1, column)
          break
        case 'ArrowDown':
          go(row + 1, column)
          break
        case 'ArrowLeft':
          go(row, column - 1)
          break
        case 'ArrowRight':
          go(row, column + 1)
          break
        case 'Tab':
          if (event.shiftKey) {
            if (column > 0) go(row, column - 1)
            else go(row - 1, COLUMNS.length - 1)
          } else if (column < COLUMNS.length - 1) go(row, column + 1)
          else go(row + 1, 0)
          break
        case 'Enter':
        case ' ':
          activate(focus)
          break
        case 'Backspace':
        case 'Delete':
          if (focus.column === 'name') edit([focus.number], (c) => ({ ...c, name: '' }))
          else if (focus.column === 'frequency' && !isEmptyChannel(channels[focus.number - 1])) {
            useDocument.getState().edit((draft) => setChannelFrequency(draft, focus.number, null))
          }
          break
        case 'Escape':
          setFocus(null)
          break
        default:
          // Typing into a name or frequency starts editing it with what was typed.
          if (event.key.length === 1 && !primary && !event.altKey && TEXT_COLUMNS.includes(focus.column)) {
            beginEditing(focus.number, focus.column, event.key)
            break
          }
          return
      }
      event.preventDefault()
      return
    }

    // Whole rows selected.
    const list = selectedNumbers()
    const extend = (delta: number) => {
      if (rows.length === 0) return
      const current = anchor.current !== null && indexOf.has(anchor.current) ? indexOf.get(anchor.current)! : delta > 0 ? -1 : rows.length
      const nextIndex = Math.max(0, Math.min(rows.length - 1, current + delta))
      const next = rows[nextIndex].number
      if (event.shiftKey && list.length > 0) select([...new Set([...list, next])])
      else select([next])
      anchor.current = next
      scrollTo(next)
    }
    switch (event.key) {
      case 'ArrowUp':
        extend(-1)
        break
      case 'ArrowDown':
        extend(1)
        break
      case 'ArrowRight':
      case 'ArrowLeft':
      case 'Tab':
        if (list.length === 0 || event.key === 'Tab') return
        moveFocus({ number: list[0], column: event.key === 'ArrowLeft' ? 'priority' : 'name' })
        break
      case 'Enter':
        if (list.length === 0) return
        beginEditing(list[0], 'name')
        break
      case 'Backspace':
      case 'Delete':
        clearChannels(list)
        break
      case 'Escape':
        select([])
        break
      case 'a':
        if (!primary) return
        select(rows.map((r) => r.number))
        break
      default: {
        // Typing a channel number selects it: "4", "5", "8" in quick succession goes to 458.
        if (!/^[0-9]$/.test(event.key) || primary || event.altKey) return
        const now = performance.now()
        typed.current = { digits: (now - typed.current.at < 1000 ? typed.current.digits : '') + event.key, at: now }
        const number = Number(typed.current.digits)
        if (indexOf.has(number)) {
          select([number])
          anchor.current = number
          scrollTo(number)
        }
      }
    }
    event.preventDefault()
  }

  const sortHeader = (key: SortKey, label: string) => (
    <div
      className={`sortable${sort.key === key ? ' sorted' : ''}`}
      role="columnheader"
      aria-sort={sort.key === key ? (sort.ascending ? 'ascending' : 'descending') : 'none'}
      onClick={() => setSort(sort.key === key ? { key, ascending: !sort.ascending } : { key, ascending: true })}
    >
      {label}
      {sort.key === key ? (sort.ascending ? ' ▲' : ' ▼') : ''}
    </div>
  )

  const cellMode = focus !== null

  return (
    <div className="grid-wrap">
      <div
        ref={scrollRef}
        className="grid"
        tabIndex={0}
        role="grid"
        aria-label="Channels"
        aria-rowcount={rows.length}
        aria-multiselectable
        onKeyDown={onKeyDown}
        onDragLeave={(event) => {
          if (!scrollRef.current?.contains(event.relatedTarget as Node)) setDropTarget(null)
        }}
      >
        <div className="grid-inner">
          <div className="grid-header" role="row">
            <div role="columnheader" aria-label="Issues" />
            {sortHeader('number', '#')}
            {sortHeader('name', 'Name')}
            {sortHeader('frequency', 'Frequency (MHz)')}
            <div role="columnheader">Modulation</div>
            <div role="columnheader">Tone</div>
            <div role="columnheader">Delay</div>
            <div role="columnheader">Lockout</div>
            <div role="columnheader">Priority</div>
          </div>
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index]
              const isFocusRow = focus?.number === row.number
              return (
                <GridRow
                  key={row.number}
                  row={row}
                  top={item.start}
                  odd={item.index % 2 === 1}
                  selected={selected.has(row.number)}
                  cellMode={cellMode}
                  focusColumn={isFocusRow ? focus.column : null}
                  editing={editing?.number === row.number ? editing : null}
                  dropTarget={dropTarget === row.number}
                  handlers={handlers}
                />
              )
            })}
          </div>
        </div>
      </div>
      {rows.length === 0 && (
        <div className="empty-state">
          {query.trim() === '' ? (
            <>
              <h2>No Channels</h2>
              <p>Read from the scanner, paste channels, or show empty channels and type a frequency.</p>
            </>
          ) : (
            <>
              <h2>No Results</h2>
              <p>No channel's name or frequency matches “{query.trim()}”.</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
