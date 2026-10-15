import { useMemo, useState } from 'react'
import { channelsInBank } from '../../kit/model/channel'
import { CHANNEL_COUNT } from '../../kit/model/config'
import { isPrimaryModifier } from '../platform'
import { useDocument } from '../store/document'
import { usePrefs } from '../store/prefs'
import { useUI } from '../store/ui'
import { ChannelGrid, type Sort } from './ChannelGrid'
import { EyeIcon, InspectorIcon, SearchIcon } from './Icons'
import { Inspector } from './Inspector'

const allNumbers = Array.from({ length: CHANNEL_COUNT }, (_, i) => i + 1)

/** All Channels or one bank: the channel table, its search field and toggles, and the inspector (SPEC.md §8.2). */
export function ChannelView({ bank }: { bank: number | null }) {
  const name = useDocument((s) => (bank === null ? '' : s.config.bankNames[bank - 1]))
  const showEmpty = usePrefs((s) => s.showEmptyChannels)
  const showInspector = usePrefs((s) => s.showInspector)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>({ key: 'number', ascending: true })
  const numbers = useMemo(() => (bank === null ? allNumbers : channelsInBank(bank)), [bank])
  const [lastBank, setLastBank] = useState(bank)
  if (lastBank !== bank) {
    // Switching to another bank starts fresh, as a new table would.
    setLastBank(bank)
    setQuery('')
  }
  const title = bank === null ? 'All Channels' : name === '' ? `Bank ${bank}` : `Bank ${bank}: ${name}`

  return (
    <div className="channel-view">
      <div className="detail">
        <div className="view-header">
          <h1>{title}</h1>
          <label className="search-field">
            <SearchIcon />
            <input
              id="channel-filter"
              className="text-input"
              type="search"
              placeholder="Name or frequency"
              aria-label="Filter channels by name or frequency"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setQuery('')
                  ;(document.querySelector('.grid') as HTMLElement | null)?.focus()
                } else if (e.key === 'ArrowDown' || (e.key === 'Enter' && !isPrimaryModifier(e))) {
                  e.preventDefault()
                  ;(document.querySelector('.grid') as HTMLElement | null)?.focus()
                }
              }}
            />
          </label>
          <button
            type="button"
            className={`icon-button${showEmpty ? ' active' : ''}`}
            aria-pressed={showEmpty}
            title={showEmpty ? 'Hide empty channels' : 'Show empty channels'}
            onClick={() => usePrefs.getState().set({ showEmptyChannels: !showEmpty })}
          >
            <EyeIcon />
          </button>
          <button
            type="button"
            className={`icon-button${showInspector ? ' active' : ''}`}
            aria-pressed={showInspector}
            title={showInspector ? 'Hide the inspector' : 'Show the inspector'}
            onClick={() => usePrefs.getState().set({ showInspector: !showInspector })}
          >
            <InspectorIcon />
          </button>
        </div>
        <ChannelGrid numbers={numbers} sort={sort} setSort={setSort} query={query} />
      </div>
      {showInspector && <InspectorPanel />}
    </div>
  )
}

function InspectorPanel() {
  const selection = useUI((s) => s.selection)
  return (
    <aside className="inspector" aria-label="Inspector">
      <Inspector selection={selection} />
    </aside>
  )
}
