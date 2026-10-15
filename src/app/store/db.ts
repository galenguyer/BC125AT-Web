import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { ScannerConfig } from '../../kit/model/config'

export interface WorkspaceRecord {
  config: ScannerConfig
  savedConfig: ScannerConfig
  fileName: string | null
  fileHandle: FileSystemFileHandle | null
  /** Saved only when reloading for an update, so undo still works afterwards. */
  past?: ScannerConfig[]
  future?: ScannerConfig[]
  ui?: unknown
  savedAt: number
}

export interface BackupRecord {
  id?: number
  /** `Scanner backup 2026-10-15 at 14.03.22`. */
  name: string
  createdAt: number
  /** The scanner's contents, as a `.bc125at` file. */
  text: string
  channelCount: number
  firmware: string | null
}

interface Schema extends DBSchema {
  workspace: { key: string; value: WorkspaceRecord }
  backups: { key: number; value: BackupRecord; indexes: { createdAt: number } }
}

let database: Promise<IDBPDatabase<Schema>> | null = null

export function db(): Promise<IDBPDatabase<Schema>> {
  database ??= openDB<Schema>('bc125at-web', 1, {
    upgrade(db) {
      db.createObjectStore('workspace')
      const backups = db.createObjectStore('backups', { keyPath: 'id', autoIncrement: true })
      backups.createIndex('createdAt', 'createdAt')
    },
  }).catch((error) => {
    database = null
    throw error
  })
  return database
}
