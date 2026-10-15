import { create } from 'zustand'
import type { IssueLocation } from '../../kit/model/validation'
import { bankOfChannel } from '../../kit/model/channel'

export type Section = { kind: 'allChannels' } | { kind: 'bank'; bank: number } | { kind: 'search' } | { kind: 'globalLockouts' } | { kind: 'settings' }

export const sameSection = (a: Section, b: Section) => a.kind === b.kind && (a.kind !== 'bank' || (b.kind === 'bank' && a.bank === b.bank))

export interface Toast {
  id: number
  message: string
}

interface UIState {
  section: Section
  /** Selected channel numbers in the channel table. */
  selection: number[]
  /** A channel to scroll to and select once the table shows it (from the issues list). */
  reveal: number | null
  sidebarOpen: boolean
  toasts: Toast[]
  setSection(section: Section): void
  setSelection(selection: number[]): void
  revealChannel(number: number): void
  clearReveal(): void
  setSidebarOpen(open: boolean): void
  /** A short message, for where the macOS app beeps (a refused paste or drop). */
  toast(message: string): void
}

let nextToast = 1

export const useUI = create<UIState>((set, get) => ({
  section: { kind: 'allChannels' },
  selection: [],
  reveal: null,
  sidebarOpen: false,
  toasts: [],
  setSection(section) {
    if (sameSection(section, get().section)) return set({ sidebarOpen: false })
    set({ section, selection: [], sidebarOpen: false })
  },
  setSelection(selection) {
    set({ selection })
  },
  revealChannel(number) {
    set({ section: { kind: 'bank', bank: bankOfChannel(number) }, selection: [number], reveal: number, sidebarOpen: false })
  },
  clearReveal() {
    set({ reveal: null })
  },
  setSidebarOpen(sidebarOpen) {
    set({ sidebarOpen })
  },
  toast(message) {
    const id = nextToast++
    set({ toasts: [...get().toasts, { id, message }] })
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 3500)
  },
}))

/** Where an issue is shown (SPEC.md §8.1): a channel's bank, or its section. */
export function revealIssue(location: IssueLocation) {
  const ui = useUI.getState()
  switch (location.kind) {
    case 'channel':
      return ui.revealChannel(location.number)
    case 'bank':
    case 'settings':
      return ui.setSection({ kind: 'settings' })
    case 'search':
    case 'closeCall':
      return ui.setSection({ kind: 'search' })
    case 'globalLockouts':
      return ui.setSection({ kind: 'globalLockouts' })
  }
}
