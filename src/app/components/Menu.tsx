import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { ChevronRightIcon } from './Icons'

export type MenuEntry =
  | {
      kind?: 'item'
      label: string
      shortcut?: string
      disabled?: boolean
      checked?: boolean
      onSelect?: () => void
      submenu?: MenuEntry[]
    }
  | { kind: 'separator' }
  | { kind: 'heading'; label: string }

type Item = Extract<MenuEntry, { label: string; kind?: 'item' }>
const isItem = (entry: MenuEntry): entry is Item => entry.kind === undefined || entry.kind === 'item'
const selectable = (entry: MenuEntry) => isItem(entry) && !entry.disabled

interface PopupProps {
  items: MenuEntry[]
  /** Where to put the menu's top-left corner; it's moved to stay on screen. */
  x: number
  y: number
  /** For a submenu: the parent item's left edge, to flip to if there's no room on the right. */
  flipX?: number
  onClose(): void
  /** Left arrow in a submenu, or Right/Left at the top level of a menubar menu. */
  onNavigate?(direction: 'left' | 'right'): void
  autoFocus?: boolean
  label?: string
}

/** A menu: arrows move, Right opens a submenu, Return chooses, Escape closes. */
export function MenuPopup({ items, x, y, flipX, onClose, onNavigate, autoFocus = true, label }: PopupProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(-1)
  const [open, setOpen] = useState<{ index: number; x: number; y: number; flipX: number; focus: boolean } | null>(null)
  const [position, setPosition] = useState({ left: x, top: y })
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    let left = x
    let top = y
    if (left + rect.width > innerWidth - 8) left = flipX !== undefined ? Math.max(8, flipX - rect.width) : Math.max(8, innerWidth - rect.width - 8)
    if (top + rect.height > innerHeight - 8) top = Math.max(8, innerHeight - rect.height - 8)
    setPosition({ left, top })
  }, [x, y, flipX, items])

  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])

  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
  }, [])

  const openSubmenu = (index: number, focus: boolean) => {
    const button = itemRefs.current[index]
    if (!button) return
    const rect = button.getBoundingClientRect()
    setOpen({ index, x: rect.right + 2, y: rect.top - 5, flipX: rect.left - 2, focus })
  }

  const choose = (index: number) => {
    const item = items[index]
    if (!isItem(item) || item.disabled) return
    if (item.submenu) return openSubmenu(index, true)
    onClose()
    item.onSelect?.()
  }

  const move = (delta: number) => {
    if (items.every((e) => !selectable(e))) return
    let index = active
    for (let i = 0; i < items.length; i++) {
      index = (index + delta + items.length) % items.length
      if (selectable(items[index])) break
    }
    setActive(index)
    itemRefs.current[index]?.scrollIntoView({ block: 'nearest' })
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (open?.focus) return
    switch (event.key) {
      case 'ArrowDown':
        move(1)
        break
      case 'ArrowUp':
        move(-1)
        break
      case 'ArrowRight': {
        const item = items[active]
        if (item && isItem(item) && item.submenu && !item.disabled) openSubmenu(active, true)
        else onNavigate?.('right')
        break
      }
      case 'ArrowLeft':
        onNavigate?.('left')
        break
      case 'Enter':
      case ' ':
        if (active >= 0) choose(active)
        break
      case 'Escape':
        onClose()
        break
      case 'Tab':
        onClose()
        break
      default: {
        // Typing a letter jumps to the next item starting with it.
        if (event.key.length !== 1) return
        const letter = event.key.toLowerCase()
        for (let i = 1; i <= items.length; i++) {
          const index = (active + i) % items.length
          const item = items[index]
          if (selectable(item) && isItem(item) && item.label.toLowerCase().startsWith(letter)) {
            setActive(index)
            itemRefs.current[index]?.scrollIntoView({ block: 'nearest' })
            break
          }
        }
        return
      }
    }
    event.preventDefault()
    event.stopPropagation()
  }

  const submenu = open ? items[open.index] : null

  return (
    <>
      <div ref={ref} className="menu" role="menu" aria-label={label} tabIndex={-1} style={position} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
        {items.map((entry, index) => {
          if (entry.kind === 'separator') return <div key={index} className="menu-separator" role="separator" />
          if (entry.kind === 'heading') return <div key={index} className="menu-heading">{entry.label}</div>
          return (
            <button
              key={index}
              ref={(el) => {
                itemRefs.current[index] = el
              }}
              type="button"
              role={entry.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
              aria-checked={entry.checked}
              aria-haspopup={entry.submenu ? 'menu' : undefined}
              aria-expanded={entry.submenu ? open?.index === index : undefined}
              className={`menu-item${active === index || open?.index === index ? ' active' : ''}`}
              disabled={entry.disabled}
              tabIndex={-1}
              onMouseEnter={() => {
                setActive(index)
                if (hoverTimer.current) clearTimeout(hoverTimer.current)
                if (entry.submenu && !entry.disabled) hoverTimer.current = setTimeout(() => openSubmenu(index, false), 120)
                else if (open) hoverTimer.current = setTimeout(() => setOpen(null), 120)
              }}
              onClick={() => choose(index)}
            >
              {entry.checked && <span className="check">✓</span>}
              <span className="label">{entry.label}</span>
              {entry.shortcut && <span className="shortcut">{entry.shortcut}</span>}
              {entry.submenu && <ChevronRightIcon />}
            </button>
          )
        })}
      </div>
      {open && submenu && isItem(submenu) && submenu.submenu && (
        <MenuPopup
          items={submenu.submenu}
          x={open.x}
          y={open.y}
          flipX={open.flipX}
          autoFocus={open.focus}
          label={submenu.label}
          onClose={onClose}
          onNavigate={(direction) => {
            if (direction === 'left') {
              setOpen(null)
              ref.current?.focus()
            }
          }}
        />
      )}
    </>
  )
}

/** Closes the menu on a click outside it (in any of its submenus counts as inside). */
function useOutsideClick(onClose: () => void, ignore?: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const listener = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (target?.closest('.menu')) return
      if (ignore?.current?.contains(target)) return
      onClose()
    }
    const blur = () => onClose()
    document.addEventListener('pointerdown', listener, true)
    window.addEventListener('blur', blur)
    window.addEventListener('resize', blur)
    return () => {
      document.removeEventListener('pointerdown', listener, true)
      window.removeEventListener('blur', blur)
      window.removeEventListener('resize', blur)
    }
  }, [onClose, ignore])
}

// MARK: Context menus

interface ContextMenuState {
  menu: { items: MenuEntry[]; x: number; y: number; restoreFocus: HTMLElement | null } | null
}

const useContextMenuStore = create<ContextMenuState>(() => ({ menu: null }))

export function openContextMenu(event: { clientX: number; clientY: number; preventDefault(): void }, items: MenuEntry[]) {
  event.preventDefault()
  useContextMenuStore.setState({ menu: { items, x: event.clientX, y: event.clientY, restoreFocus: document.activeElement as HTMLElement | null } })
}

/** Opens a menu below an element, as a pop-up button would. */
export function openMenuBelow(element: HTMLElement, items: MenuEntry[]) {
  const rect = element.getBoundingClientRect()
  useContextMenuStore.setState({ menu: { items, x: rect.left, y: rect.bottom + 2, restoreFocus: element } })
}

export function ContextMenuHost() {
  const menu = useContextMenuStore((s) => s.menu)
  const close = useRef(() => {
    const restore = useContextMenuStore.getState().menu?.restoreFocus
    useContextMenuStore.setState({ menu: null })
    restore?.focus({ preventScroll: true })
  }).current
  useOutsideClick(close)
  if (!menu) return null
  return createPortal(<MenuPopup items={menu.items} x={menu.x} y={menu.y} onClose={close} />, document.body)
}

// MARK: Menubar

export interface MenubarMenu {
  title: string
  items: () => MenuEntry[]
}

export function Menubar({ menus }: { menus: MenubarMenu[] }) {
  const [open, setOpen] = useState<number | null>(null)
  const bar = useRef<HTMLDivElement>(null)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const close = useRef(() => setOpen(null)).current
  useOutsideClick(close, bar)

  const anchor = open === null ? null : buttons.current[open]?.getBoundingClientRect()

  return (
    <div ref={bar} className="menubar" role="menubar">
      {menus.map((menu, index) => (
        <button
          key={menu.title}
          ref={(el) => {
            buttons.current[index] = el
          }}
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={open === index}
          className={`menubar-item${open === index ? ' open' : ''}`}
          onPointerDown={(event) => {
            event.preventDefault()
            setOpen(open === index ? null : index)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
              event.preventDefault()
              setOpen(index)
            }
          }}
          onMouseEnter={() => {
            if (open !== null && open !== index) setOpen(index)
          }}
        >
          {menu.title}
        </button>
      ))}
      {open !== null &&
        anchor &&
        createPortal(
          <MenuPopup
            key={open}
            label={menus[open].title}
            items={menus[open].items()}
            x={anchor.left}
            y={anchor.bottom + 3}
            onClose={() => {
              const button = buttons.current[open]
              setOpen(null)
              button?.focus({ preventScroll: true })
            }}
            onNavigate={(direction) => setOpen((open + (direction === 'right' ? 1 : menus.length - 1)) % menus.length)}
          />,
          document.body,
        )}
    </div>
  )
}
