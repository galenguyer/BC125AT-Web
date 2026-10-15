import { produce, type Draft } from 'immer'
import { create } from 'zustand'
import { configsEqual, makeConfig, type ScannerConfig } from '../../kit/model/config'

const HISTORY_LIMIT = 100

export interface DocumentState {
  config: ScannerConfig
  /** The file's name (`Scanner.bc125at`), or `null` for an untitled document. */
  fileName: string | null
  /** The file it was opened from or saved to, where the browser supports saving in place. */
  fileHandle: FileSystemFileHandle | null
  /** The configuration as last opened or saved, to tell whether there are unsaved changes. */
  savedConfig: ScannerConfig
  past: ScannerConfig[]
  future: ScannerConfig[]
}

interface DocumentActions {
  /** Applies `recipe` as one undo step. Does nothing, and adds no step, if nothing changed. */
  edit(recipe: (draft: Draft<ScannerConfig>) => void): void
  /** Replaces the configuration as one undo step. */
  replace(config: ScannerConfig): void
  undo(): void
  redo(): void
  /** Starts over with an empty, untitled document. */
  reset(): void
  /** A document opened from a file (or restored): no undo history, no unsaved changes. */
  open(config: ScannerConfig, fileName: string | null, fileHandle: FileSystemFileHandle | null): void
  markSaved(fileName: string, fileHandle: FileSystemFileHandle | null): void
  /** Restores everything, including the undo history, after a reload. */
  restore(state: DocumentState): void
}

export const useDocument = create<DocumentState & DocumentActions>((set, get) => {
  const empty = makeConfig()
  const commit = (config: ScannerConfig) => {
    const { config: current, past } = get()
    if (config === current || configsEqual(config, current)) return
    set({ config, past: [...past, current].slice(-HISTORY_LIMIT), future: [] })
  }
  return {
    config: empty,
    fileName: null,
    fileHandle: null,
    savedConfig: empty,
    past: [],
    future: [],
    edit(recipe) {
      commit(produce(get().config, recipe))
    },
    replace(config) {
      commit(config)
    },
    undo() {
      const { past, future, config } = get()
      if (past.length === 0) return
      set({ config: past[past.length - 1], past: past.slice(0, -1), future: [config, ...future] })
    },
    redo() {
      const { past, future, config } = get()
      if (future.length === 0) return
      set({ config: future[0], past: [...past, config], future: future.slice(1) })
    },
    reset() {
      const config = makeConfig()
      set({ config, savedConfig: config, fileName: null, fileHandle: null, past: [], future: [] })
    },
    open(config, fileName, fileHandle) {
      set({ config, savedConfig: config, fileName, fileHandle, past: [], future: [] })
    },
    markSaved(fileName, fileHandle) {
      set({ savedConfig: get().config, fileName, fileHandle })
    },
    restore(state) {
      set(state)
    },
  }
})

export function isDirty(state: DocumentState): boolean {
  return state.config !== state.savedConfig && !configsEqual(state.config, state.savedConfig)
}

/** The title to show: the file name without its extension, or "Untitled". */
export function documentTitle(state: Pick<DocumentState, 'fileName'>): string {
  return state.fileName ? state.fileName.replace(/\.bc125at$/i, '') : 'Untitled'
}
