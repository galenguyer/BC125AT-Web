import { CHANNEL_COUNT, channelAt, configsEqual, makeConfig, usedChannelCount, type ScannerConfig } from '../kit/model/config'
import { isEmptyChannel } from '../kit/model/channel'
import { locationTitle, validateConfig } from '../kit/model/validation'
import { CSVImportError, exportCSV, importCSV } from '../kit/formats/csv'
import { decodeNative, encodeNative, NativeReadError } from '../kit/formats/native'
import { decodeUniden, encodeUniden, UnidenImportError } from '../kit/formats/uniden'
import { writeSucceeded } from '../kit/sync/session'
import { errorMessage } from './messages'
import { alert, ask, confirm, setIssuesOpen } from './store/dialogs'
import { documentTitle, isDirty, useDocument } from './store/document'
import { chooseFile, csvKind, download, nativeKind, saveFileAs, unidenKind, writeToHandle } from './store/files'
import * as operations from './store/operations'
import { live, selectedDevice, useScanner } from './store/scanner'
import { usePrefs } from './store/prefs'
import { useUI } from './store/ui'
import type { TransportKind } from './platform'

const doc = () => useDocument.getState()
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

// MARK: Documents

/** If there are unsaved changes, offers to save them. Returns false if the person cancelled. */
async function settleUnsavedChanges(action: string): Promise<boolean> {
  const state = doc()
  if (!isDirty(state)) return true
  const answer = await ask(
    `Save changes to “${documentTitle(state)}” before ${action}?`,
    "Your changes will be lost if you don't save them.",
    [
      { label: "Don't Save", value: 'discard', destructive: true },
      { label: 'Cancel', value: 'cancel', cancel: true },
      { label: 'Save', value: 'save', primary: true },
    ],
  )
  if (answer === 'cancel') return false
  if (answer === 'save') return save()
  return true
}

export async function newDocument() {
  if (!(await settleUnsavedChanges('starting a new document'))) return
  doc().reset()
  useUI.getState().setSection({ kind: 'allChannels' })
}

export async function openDocument() {
  if (!(await settleUnsavedChanges('opening another'))) return
  try {
    const file = await chooseFile(nativeKind)
    if (!file) return
    const config = decodeNative(file.text)
    doc().open(config, file.name, file.handle)
    useUI.getState().setSection({ kind: 'allChannels' })
  } catch (error) {
    await alert("Couldn't Open the File", error instanceof NativeReadError ? error.message : errorMessage(error))
  }
}

/** Opens a backup as the document, as one undo step (it isn't tied to a file). */
export function openConfig(config: ScannerConfig) {
  doc().replace(config)
}

/** Saves in place when the file can be written back to; otherwise asks where. Returns whether it saved. */
export async function save(): Promise<boolean> {
  const state = doc()
  if (state.fileHandle && state.fileName) {
    try {
      await writeToHandle(state.fileHandle, encodeNative(state.config))
      doc().markSaved(state.fileName, state.fileHandle)
      return true
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return false
      await alert("Couldn't Save the File", `${errorMessage(error)} Choose Save As… to save it somewhere else.`)
      return false
    }
  }
  return saveAs()
}

export async function saveAs(): Promise<boolean> {
  const state = doc()
  try {
    const saved = await saveFileAs(nativeKind, state.fileName ?? 'Scanner', encodeNative(state.config))
    if (!saved) return false
    doc().markSaved(saved.name, saved.handle)
    return true
  } catch (error) {
    await alert("Couldn't Save the File", errorMessage(error))
    return false
  }
}

// MARK: Import and export

export async function importChannelsCSV() {
  let file
  try {
    file = await chooseFile(csvKind, ['txt'])
  } catch (error) {
    return alert("Couldn't Import Channels", errorMessage(error))
  }
  if (!file) return
  try {
    const imported = importCSV(file.text)
    doc().edit((config) => {
      for (const { number, channel } of imported.channels) config.channels[number - 1] = channel
    })
    let summary = `${plural(imported.channels.length, 'channel', 'channels')} imported from ${file.name}.`
    if (imported.problems.length > 0) {
      summary += `\n\n${imported.problems.length} ${imported.problems.length === 1 ? 'row was' : 'rows were'} skipped:\n`
      summary += imported.problems.slice(0, 8).map((p) => `Line ${p.line}: ${p.message}`).join('\n')
    }
    await alert('Channels Imported', summary)
  } catch (error) {
    await alert("Couldn't Import Channels", error instanceof CSVImportError ? error.message : errorMessage(error))
  }
}

export async function exportChannelsCSV() {
  try {
    await saveFileAs(csvKind, 'Channels', exportCSV(doc().config))
  } catch (error) {
    await alert("Couldn't Export Channels", errorMessage(error))
  }
}

/**
 * Replaces the document with a file from Uniden's software, as one undo step. The file has no
 * global lockouts, so the document's are kept, as are its notes and any bank names the file
 * leaves at Uniden's defaults.
 */
export async function importUnidenFile() {
  let file
  try {
    file = await chooseFile(unidenKind, ['txt'])
  } catch (error) {
    return alert("Couldn't Import the Uniden File", errorMessage(error))
  }
  if (!file) return
  try {
    const imported = decodeUniden(file.text)
    const current = doc().config
    imported.globalLockouts = [...current.globalLockouts]
    imported.bankNames = imported.bankNames.map((name, bank) => (name === '' ? current.bankNames[bank] : name))
    imported.metadata = { ...current.metadata }
    doc().replace(imported)
    let message = `Read ${usedChannelCount(imported)} channels and every setting from ${file.name}.`
    if (current.globalLockouts.length > 0) {
      message += `\n\nUniden's files have no global lockouts, so this document's ${current.globalLockouts.length} were kept.`
    }
    if (imported.settings.bandPlan === 1) message += '\n\nThe file sets the band plan to Canada, so writing it will switch the scanner to Canada.'
    await alert('Uniden File Imported', message)
  } catch (error) {
    await alert("Couldn't Import the Uniden File", error instanceof UnidenImportError ? error.message : errorMessage(error))
  }
}

export async function exportUnidenFile() {
  try {
    await saveFileAs(unidenKind, 'Scanner', encodeUniden(doc().config))
  } catch (error) {
    await alert("Couldn't Export the Uniden File", errorMessage(error))
  }
}

export function downloadNative(name: string, config: ScannerConfig) {
  download(`${name}.bc125at`, encodeNative(config), nativeKind.mime)
}

// MARK: Scanner

const scannerIdle = () => !useScanner.getState().busy && !operations.isBusy(operations.useOperations.getState().sheet)
export const canUseScanner = () => selectedDevice() !== null && scannerIdle()

export async function connect(kind: TransportKind) {
  try {
    await live.connect(kind)
  } catch (error) {
    await alert("Couldn't Connect", errorMessage(error, kind))
  }
}

/** Replaces the document's contents, keeping app-only bank names and notes (one undo step). */
function replaceWithScanner(config: ScannerConfig) {
  const current = doc().config
  doc().replace({ ...config, bankNames: [...current.bankNames], metadata: { ...config.metadata, notes: current.metadata.notes } })
}

export async function readFromScanner() {
  if (!canUseScanner()) return
  if (!configsEqual(doc().config, makeConfig())) {
    const ok = await confirm(
      "Replace this document with the scanner's contents?",
      "Everything in this document will be replaced by what's on the scanner. You can undo this.",
      'Read and Replace',
    )
    if (!ok) return
  }
  await operations.read(replaceWithScanner)
}

/** Errors block writing (SPEC.md §7); warnings don't. */
export async function writeToScanner() {
  if (!canUseScanner()) return
  const errors = validateConfig(doc().config).filter((i) => i.severity === 'error')
  if (errors.length > 0) {
    let message = errors.slice(0, 5).map((e) => `${locationTitle(e.location)}: ${e.message}`).join('\n')
    if (errors.length > 5) message += `\n…and ${errors.length - 5} more`
    const answer = await ask(`Fix ${plural(errors.length, 'Problem', 'Problems')} Before Writing`, message, [
      { label: 'Show Problems', value: 'show' },
      { label: 'OK', value: 'ok', primary: true, cancel: true },
    ])
    if (answer === 'show') setIssuesOpen(true)
    return
  }
  await operations.prepare(doc().config, false)
}

/** The write itself, from the review sheet. */
export async function confirmWrite() {
  await operations.write((report, plan) => {
    // When everything verified, update the document to exactly what the scanner stored (snapped
    // frequencies, trimmed names). On failure, keep the document as the person left it.
    if (!writeSucceeded(report) || (plan.adjustments.length === 0 && report.storedDifferently.length === 0)) return
    const document = doc().config
    const updated = { ...report.acceptedConfig, metadata: document.metadata, channels: [...report.acceptedConfig.channels] }
    // Channels with only a name aren't written; keep them so the name isn't lost.
    for (let number = 1; number <= CHANNEL_COUNT; number++) {
      if (isEmptyChannel(channelAt(document, number))) updated.channels[number - 1] = channelAt(document, number)
    }
    doc().replace(updated)
  })
}

/** Like Write to Scanner, but only lists the differences. Works even if the document has errors. */
export async function compareWithScanner() {
  if (!canUseScanner()) return
  await operations.prepare(doc().config, true)
}

export async function releaseScanner() {
  if (!selectedDevice() || !scannerIdle()) return
  try {
    await operations.release()
    useUI.getState().toast('Sent the scanner out of program mode.')
  } catch (error) {
    await alert("Couldn't Release the Scanner", errorMessage(error, selectedDevice()?.kind))
  }
}

export const toggleLive = () => void live.setEnabled(!usePrefs.getState().liveEnabled)
