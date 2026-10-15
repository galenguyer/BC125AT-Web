/** The channel table's clipboard and selection commands, for the Edit menu. Set while it's shown. */
export interface GridCommands {
  copy(): void
  cut(): void
  paste(): void
  clear(): void
  selectAll(): void
  focusFilter(): void
  hasSelection(): boolean
}

export const gridCommands: { current: GridCommands | null } = { current: null }
