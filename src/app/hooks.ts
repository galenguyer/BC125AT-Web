import { useEffect, useState } from 'react'
import type { ScannerConfig } from '../kit/model/config'
import { validateConfig, type ValidationIssue } from '../kit/model/validation'
import { useDocument } from './store/document'
import { usePrefs } from './store/prefs'

let cache: { config: ScannerConfig; duplicates: boolean; issues: ValidationIssue[] } | null = null

/** Every issue in the document, recomputed only when the configuration changes. */
export function issuesFor(config: ScannerConfig, duplicates: boolean): ValidationIssue[] {
  if (cache && cache.config === config && cache.duplicates === duplicates) return cache.issues
  const issues = validateConfig(config, { duplicateFrequencies: duplicates })
  cache = { config, duplicates, issues }
  return issues
}

export function useIssues(): ValidationIssue[] {
  const config = useDocument((s) => s.config)
  const duplicates = usePrefs((s) => s.duplicateWarnings)
  return issuesFor(config, duplicates)
}

/** Re-renders every `ms`, for "3 s ago". */
export function useTicker(ms: number) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), ms)
    return () => clearInterval(timer)
  }, [ms])
}

export function relativeTime(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (seconds < 60) return `${seconds} s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  return `${Math.round(minutes / 60)} h ago`
}
