/**
 * Opening and saving files. Chromium browsers (which this app needs for the scanner anyway) have
 * the File System Access API, so a document can be saved back in place; elsewhere, files are
 * chosen with an `<input type=file>` and saved as downloads.
 */

export interface FileKind {
  description: string
  extension: string
  mime: string
}

export const nativeKind: FileKind = { description: 'BC125AT CPS document', extension: 'bc125at', mime: 'application/json' }
export const csvKind: FileKind = { description: 'CSV', extension: 'csv', mime: 'text/csv' }
export const unidenKind: FileKind = { description: "Uniden BC125AT file", extension: 'bc125at_ss', mime: 'text/plain' }

export interface OpenedFile {
  name: string
  text: string
  handle: FileSystemFileHandle | null
}

const hasPickers = typeof window !== 'undefined' && 'showOpenFilePicker' in window && 'showSaveFilePicker' in window

/**
 * Chrome's file pickers accept only extensions made of letters, digits and `+` (with dots between),
 * and throw on anything else: `.bc125at_ss` is refused for its underscore.
 */
export const isValidPickerExtension = (extension: string) => /^[A-Za-z0-9+]+(\.[A-Za-z0-9+]+)*$/.test(extension)

/**
 * The picker's file type filter. A kind whose own extension the picker can't take gets no filter,
 * so the picker shows every file rather than hiding the ones wanted.
 */
export function pickerTypes(kind: FileKind, extraExtensions: string[] = []): FilePickerAcceptType[] {
  if (!isValidPickerExtension(kind.extension)) return []
  const extensions = [kind.extension, ...extraExtensions].filter(isValidPickerExtension)
  return [{ description: kind.description, accept: { [kind.mime]: extensions.map((e) => `.${e}`) as `.${string}`[] } }]
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

/** Asks for a file to open. Returns `null` if the person cancelled. */
export async function chooseFile(kind: FileKind, extraExtensions: string[] = []): Promise<OpenedFile | null> {
  if (hasPickers) {
    try {
      // Any file is allowed too: Uniden's files and CSVs often arrive with other extensions.
      const [handle] = await window.showOpenFilePicker({ types: pickerTypes(kind, extraExtensions), excludeAcceptAllOption: false, id: kind.extension })
      const file = await handle.getFile()
      return { name: file.name, text: await file.text(), handle }
    } catch (error) {
      if (isAbort(error)) return null
      throw error
    }
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = [kind.extension, ...extraExtensions].map((e) => `.${e}`).join(',')
    input.addEventListener('change', async () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      try {
        resolve({ name: file.name, text: await file.text(), handle: null })
      } catch (error) {
        reject(error)
      }
    })
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}

/** Writes `text` to `handle`, asking for permission again if the browser has forgotten it. */
export async function writeToHandle(handle: FileSystemFileHandle, text: string): Promise<void> {
  const permissionHandle = handle as FileSystemFileHandle & {
    queryPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>
    requestPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>
  }
  if (permissionHandle.queryPermission && (await permissionHandle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    if ((await permissionHandle.requestPermission?.({ mode: 'readwrite' })) !== 'granted') throw new Error("The browser didn't allow saving to the file.")
  }
  const writable = await handle.createWritable()
  await writable.write(text)
  await writable.close()
}

export interface SavedFile {
  name: string
  handle: FileSystemFileHandle | null
}

/** Asks where to save `text`, then saves it there (or downloads it). Returns `null` if cancelled. */
export async function saveFileAs(kind: FileKind, suggestedName: string, text: string): Promise<SavedFile | null> {
  const name = suggestedName.toLowerCase().endsWith(`.${kind.extension}`) ? suggestedName : `${suggestedName}.${kind.extension}`
  if (hasPickers) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: name, types: pickerTypes(kind), excludeAcceptAllOption: false, id: kind.extension })
      await writeToHandle(handle, text)
      return { name: handle.name, handle }
    } catch (error) {
      if (isAbort(error)) return null
      throw error
    }
  }
  download(name, text, kind.mime)
  return { name, handle: null }
}

export function download(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
