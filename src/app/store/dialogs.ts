import { create } from 'zustand'

export interface DialogButton {
  label: string
  value: string
  /** The default button, chosen by Return. */
  primary?: boolean
  /** The button chosen by Escape. */
  cancel?: boolean
  destructive?: boolean
}

export interface Dialog {
  id: number
  title: string
  message: string
  buttons: DialogButton[]
  resolve(value: string): void
}

/** Panels opened from the menus. */
export type Panel = 'none' | 'backups' | 'preferences' | 'about'

interface DialogState {
  dialogs: Dialog[]
  panel: Panel
  issuesOpen: boolean
}

export const useDialogs = create<DialogState>(() => ({ dialogs: [], panel: 'none', issuesOpen: false }))

let nextID = 1

/** Shows a dialog and resolves with the `value` of the button chosen. */
export function ask(title: string, message: string, buttons: DialogButton[]): Promise<string> {
  return new Promise((resolve) => {
    const id = nextID++
    const dialog: Dialog = {
      id,
      title,
      message,
      buttons,
      resolve: (value) => {
        useDialogs.setState((state) => ({ dialogs: state.dialogs.filter((d) => d.id !== id) }))
        resolve(value)
      },
    }
    useDialogs.setState((state) => ({ dialogs: [...state.dialogs, dialog] }))
  })
}

export async function confirm(title: string, message: string, confirmLabel: string, destructive = false): Promise<boolean> {
  const answer = await ask(title, message, [
    { label: 'Cancel', value: 'cancel', cancel: true },
    { label: confirmLabel, value: 'ok', primary: true, destructive },
  ])
  return answer === 'ok'
}

export function alert(title: string, message: string): Promise<void> {
  return ask(title, message, [{ label: 'OK', value: 'ok', primary: true, cancel: true }]).then(() => {})
}

export const openPanel = (panel: Panel) => useDialogs.setState({ panel })
export const closePanel = () => useDialogs.setState({ panel: 'none' })
export const setIssuesOpen = (issuesOpen: boolean) => useDialogs.setState({ issuesOpen })
