import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App, ElsewhereOverlay, useTabState } from './app/App'
import { live, startScannerWatch } from './app/store/scanner'
import { registered, updateFound } from './app/store/updates'
import { acquireWorkspace, flushWorkspace, restoreWorkspace, startAutosave } from './app/store/workspace'
import './app/styles.css'

const root = createRoot(document.getElementById('root')!)

/** Another tab asked for the workspace: save, let go of the scanner, and step aside. */
async function lose() {
  await flushWorkspace()
  await live.yieldToOtherTab()
  useTabState.setState({ elsewhere: true, waiting: false })
}

/** Takes the workspace back from the tab holding it, then starts again with what it saved. */
function useHere() {
  void acquireWorkspace(true, lose).then(() => location.reload())
}

async function boot() {
  await restoreWorkspace()
  startAutosave()
  startScannerWatch()
  const updateSW = registerSW({
    onNeedRefresh: updateFound,
    onRegisteredSW: (_url, registration) => registered(registration, updateSW),
  })
  root.render(
    <StrictMode>
      <App onUseHere={useHere} />
    </StrictMode>,
  )
}

void acquireWorkspace(false, lose).then((acquired) => {
  if (acquired) {
    void boot()
    return
  }
  root.render(<ElsewhereOverlay onUseHere={() => void acquireWorkspace(true, lose).then(() => boot())} />)
})
