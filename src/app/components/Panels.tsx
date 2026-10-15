import { useCallback, useEffect, useState } from 'react'
import { decodeNative } from '../../kit/formats/native'
import { downloadNative, openConfig } from '../actions'
import { errorMessage } from '../messages'
import { demoMode } from '../platform'
import { deleteBackup, listBackups, prune } from '../store/backups'
import type { BackupRecord } from '../store/db'
import { closePanel, confirm, useDialogs } from '../store/dialogs'
import { DEFAULT_BACKUP_RETENTION, usePrefs } from '../store/prefs'
import { useUI } from '../store/ui'
import { checkForUpdate, hasServiceWorker, reloadForUpdate, useUpdates } from '../store/updates'
import { Stepper, Switch } from './Fields'
import { CheckCircleIcon, WarningIcon } from './Icons'
import { Modal } from './Sheets'

declare const __APP_VERSION__: string
declare const __BUILD_ID__: string
declare const __BUILD_TIME__: string

export const appVersion = typeof __APP_VERSION__ === 'undefined' ? 'dev' : __APP_VERSION__
export const buildID = typeof __BUILD_ID__ === 'undefined' ? 'dev' : __BUILD_ID__
const buildTime = typeof __BUILD_TIME__ === 'undefined' ? null : __BUILD_TIME__

function BackupsPanel() {
  const [backups, setBackups] = useState<BackupRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(() => {
    listBackups().then(setBackups, (e) => setError(errorMessage(e)))
  }, [])
  useEffect(refresh, [refresh])
  const retention = usePrefs((s) => s.backupRetention)

  return (
    <Modal wide label="Backups" onEscape={closePanel}>
      <h2>Scanner Backups</h2>
      <p className="note">
        Before every write, the scanner’s contents are saved here, in this browser. The newest {retention} are kept. Open one to make it the document (you can undo that), then write it to go
        back.
      </p>
      <div className="change-list">
        {error && <p style={{ padding: 12 }}>{error}</p>}
        {backups?.length === 0 && <p style={{ padding: 16, textAlign: 'center' }} className="secondary">No backups yet. One is made each time you write to the scanner.</p>}
        {backups?.map((backup) => (
          <div key={backup.id} className="backup-row">
            <div className="info">
              <div>{backup.name}</div>
              <div>
                {backup.channelCount} channels{backup.firmware ? ` · ${backup.firmware}` : ''}
              </div>
            </div>
            <button
              type="button"
              className="button"
              onClick={() => {
                try {
                  openConfig(decodeNative(backup.text))
                  closePanel()
                  useUI.getState().toast(`Opened “${backup.name}”. Undo to go back.`)
                } catch (e) {
                  setError(errorMessage(e))
                }
              }}
            >
              Open
            </button>
            <button type="button" className="button" onClick={() => downloadNative(backup.name, decodeNative(backup.text))}>
              Download
            </button>
            <button
              type="button"
              className="button destructive"
              onClick={async () => {
                if (!(await confirm(`Delete “${backup.name}”?`, 'This backup will be removed from this browser.', 'Delete', true))) return
                if (backup.id !== undefined) await deleteBackup(backup.id)
                refresh()
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
      <div className="sheet-buttons">
        <button type="button" className="button primary" data-primary="true" onClick={closePanel}>
          Done
        </button>
      </div>
    </Modal>
  )
}

function UpdateStatus() {
  const status = useUpdates((s) => s.status)
  switch (status) {
    case 'checking':
      return <span className="secondary">Checking…</span>
    case 'upToDate':
      return (
        <span style={{ color: 'var(--green)', display: 'inline-flex', gap: 5, alignItems: 'center' }}>
          <CheckCircleIcon /> Up to date
        </span>
      )
    case 'available':
      return (
        <button type="button" className="button primary" onClick={() => void reloadForUpdate()}>
          Reload to Update
        </button>
      )
    case 'failed':
      return (
        <span className="secondary" style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }} title="The update server couldn't be reached">
          <WarningIcon /> Couldn’t check
        </span>
      )
    case 'unsupported':
      return <span className="secondary">Not available in this browser</span>
    default:
      return null
  }
}

function PreferencesPanel() {
  const prefs = usePrefs()
  const checking = useUpdates((s) => s.status === 'checking')
  return (
    <Modal wide label="Preferences" onEscape={closePanel}>
      <h2>Preferences</h2>
      <div className="form" style={{ width: '100%', overflowY: 'auto' }}>
        <section className="form-section">
          <h2>BC125AT CPS</h2>
          <div className="form-group">
            <div className="form-row">
              <span className="label">Version</span>
              <span className="value num">
                {appVersion} ({buildID})
              </span>
            </div>
            <div className="form-row">
              <span className="label">Updates</span>
              <UpdateStatus />
              <button type="button" className="button" disabled={checking || !hasServiceWorker()} onClick={() => void checkForUpdate()}>
                Check Now
              </button>
            </div>
          </div>
          <p className="form-footer">
            New versions are checked for every hour and when you come back to this tab. When one is ready, a note appears at the bottom of the sidebar; reloading keeps your document and its undo
            history.
          </p>
        </section>
        <section className="form-section">
          <h2>Checks</h2>
          <div className="form-group">
            <div className="form-row">
              <label htmlFor="pref-duplicates" className="label">
                Warn about duplicate frequencies
              </label>
              <Switch label="Warn about duplicate frequencies" checked={prefs.duplicateWarnings} onChange={(v) => prefs.set({ duplicateWarnings: v })} />
            </div>
          </div>
          <p className="form-footer">Flags channels that share a frequency with another channel. Duplicates are always allowed; this only controls the warnings.</p>
        </section>
        <section className="form-section">
          <h2>Backups</h2>
          <div className="form-group">
            <div className="form-row">
              <span className="label">Keep the newest {prefs.backupRetention} backups</span>
              <Stepper
                label="Backups to keep"
                value={prefs.backupRetention / 10}
                min={1}
                max={50}
                onChange={(v) => {
                  prefs.set({ backupRetention: v * 10 })
                  void prune(v * 10)
                }}
              />
            </div>
          </div>
          <p className="form-footer">
            Before every write, the scanner’s current contents are saved in this browser as a .bc125at file you can open and write back. Default {DEFAULT_BACKUP_RETENTION}.
          </p>
        </section>
      </div>
      <div className="sheet-buttons">
        <button type="button" className="button primary" data-primary="true" onClick={closePanel}>
          Done
        </button>
      </div>
    </Modal>
  )
}

function AboutPanel() {
  return (
    <Modal label="About" onEscape={closePanel}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <img src="/icons/icon-192.png" alt="" width={56} height={56} style={{ borderRadius: 12 }} />
        <div>
          <h2>BC125AT CPS</h2>
          <p className="note num">
            Version {appVersion} ({buildID}){buildTime ? `, built ${new Date(buildTime).toLocaleDateString()}` : ''}
          </p>
        </div>
      </div>
      <p>
        Read, edit and write a Uniden BC125AT scanner over USB, in the browser. The web version of{' '}
        <a href="https://github.com/galenguyer/BC125AT-CPS" target="_blank" rel="noreferrer">
          BC125AT CPS for Mac
        </a>
        , and it opens and saves the same .bc125at files.
      </p>
      <p className="note">
        Nearly all of it was written by Claude, with a human pointing at things and plugging in the scanner. Keep a backup. Not affiliated with or endorsed by Uniden. Protocol notes cross-checked
        against bc125py by Max Loiacono (MIT). MIT License.
      </p>
      {demoMode && <p className="note">You’re using the demo scanner: nothing here touches real hardware.</p>}
      <div className="sheet-buttons">
        <button type="button" className="button primary" data-primary="true" onClick={closePanel}>
          OK
        </button>
      </div>
    </Modal>
  )
}

export function PanelHost() {
  const panel = useDialogs((s) => s.panel)
  switch (panel) {
    case 'backups':
      return <BackupsPanel />
    case 'preferences':
      return <PreferencesPanel />
    case 'about':
      return <AboutPanel />
    default:
      return null
  }
}
