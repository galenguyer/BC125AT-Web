import { usedChannelCount, type ScannerConfig } from '../../kit/model/config'
import { encodeNative } from '../../kit/formats/native'
import { db, type BackupRecord } from './db'
import { usePrefs } from './prefs'

const two = (n: number) => String(n).padStart(2, '0')

/** `Scanner backup 2026-10-15 at 14.03.22`, as the macOS app names them. */
export function backupName(date: Date): string {
  return `Scanner backup ${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} at ${two(date.getHours())}.${two(date.getMinutes())}.${two(date.getSeconds())}`
}

/**
 * Saves the scanner's contents before a write (SPEC.md §7.3). Throws if it can't, so the write
 * doesn't go ahead. Keeps the newest backups, as many as Preferences says.
 */
export async function saveBackup(config: ScannerConfig): Promise<BackupRecord> {
  const now = new Date()
  const backup: BackupRecord = {
    name: backupName(now),
    createdAt: now.getTime(),
    text: encodeNative(config),
    channelCount: usedChannelCount(config),
    firmware: config.metadata.firmware,
  }
  const database = await db()
  backup.id = await database.add('backups', backup)
  await prune(usePrefs.getState().backupRetention)
  return backup
}

/** Newest first. */
export async function listBackups(): Promise<BackupRecord[]> {
  const all = await (await db()).getAllFromIndex('backups', 'createdAt')
  return all.reverse()
}

export async function deleteBackup(id: number) {
  await (await db()).delete('backups', id)
}

export async function prune(keep: number) {
  const backups = await listBackups()
  const database = await db()
  for (const old of backups.slice(keep)) if (old.id !== undefined) await database.delete('backups', old.id)
}
