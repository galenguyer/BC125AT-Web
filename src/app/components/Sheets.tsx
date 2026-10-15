import { useEffect, useRef } from 'react'
import { usedChannelCount } from '../../kit/model/config'
import { progressFraction, writeSucceeded, type Progress } from '../../kit/sync/session'
import { stepsInSection, writeSections, type WritePlan } from '../../kit/sync/writePlan'
import { confirmWrite } from '../actions'
import { openPanel, useDialogs } from '../store/dialogs'
import { cancel, dismiss, useOperations } from '../store/operations'
import { modeAfterUse, useScanner } from '../store/scanner'
import { CheckCircleIcon, WarningIcon } from './Icons'

/**
 * A modal sheet. Return presses the `primary` button and Escape the `cancel` one; focus stays
 * inside while it's open.
 */
export function Modal({ children, wide, label, onEscape }: { children: React.ReactNode; wide?: boolean; label: string; onEscape?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const sheet = ref.current
    const first = sheet?.querySelector<HTMLElement>('[data-primary="true"]') ?? sheet?.querySelector<HTMLElement>('button, input, select')
    ;(first ?? sheet)?.focus()
    return () => previous?.focus?.({ preventScroll: true })
  }, [])
  return (
    <div className="backdrop">
      <div
        ref={ref}
        className={`sheet${wide ? ' wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && onEscape) {
            event.preventDefault()
            event.stopPropagation()
            onEscape()
          } else if (event.key === 'Tab') {
            const focusable = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, [tabindex="0"]') ?? [])]
            if (focusable.length === 0) return
            const index = focusable.indexOf(document.activeElement as HTMLElement)
            const next = event.shiftKey ? (index <= 0 ? focusable.length - 1 : index - 1) : index === focusable.length - 1 ? 0 : index + 1
            focusable[next].focus()
            event.preventDefault()
          }
          event.stopPropagation()
        }}
      >
        {children}
      </div>
    </div>
  )
}

function ProgressBar({ progress }: { progress: Progress }) {
  const percent = Math.round(progressFraction(progress) * 100)
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <div style={{ width: `${percent}%` }} />
    </div>
  )
}

function Buttons({ children }: { children: React.ReactNode }) {
  return <div className="sheet-buttons">{children}</div>
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** The differences by section, plus anything the scanner will store differently. */
function ChangeList({ plan, adjustments = true }: { plan: WritePlan; adjustments?: boolean }) {
  return (
    <div className="change-list" tabIndex={0} aria-label="Changes">
      {writeSections.map((section) => {
        const steps = stepsInSection(plan, section)
        if (steps.length === 0) return null
        return (
          <section key={section}>
            <h3>
              {section} ({steps.length})
            </h3>
            <ul>
              {steps.map((step) => (
                <li key={step.id}>
                  <div className="title">{step.title}</div>
                  <div className="detail">{step.detail}</div>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      {adjustments && plan.adjustments.length > 0 && (
        <section>
          <h3>The scanner will store these differently</h3>
          <ul>
            {plan.adjustments.map((a, i) => (
              <li key={i} className="adjustment">
                {a.title}: {a.detail}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/** Every stage of Read, Write and Compare (SPEC.md §7). */
export function OperationSheet() {
  const sheet = useOperations((s) => s.sheet)
  const mode = useScanner((s) => modeAfterUse(s))

  switch (sheet.kind) {
    case 'none':
      return null
    case 'reading':
      return (
        <Modal label="Reading from Scanner" onEscape={cancel}>
          <h2>Reading from Scanner</h2>
          <ProgressBar progress={sheet.progress} />
          <p className="note">The scanner shows “Remote Mode” while it’s being read. Don’t disconnect it.</p>
          <Buttons>
            <button type="button" className="button" onClick={cancel}>
              Cancel
            </button>
          </Buttons>
        </Modal>
      )
    case 'readFinished':
      return (
        <Modal label="Read finished" onEscape={dismiss}>
          <h2 className="success">
            <CheckCircleIcon /> Read {usedChannelCount(sheet.config)} channels
          </h2>
          {sheet.config.metadata.firmware && (
            <p className="note">
              {sheet.config.metadata.model ?? 'BC125AT'}, {sheet.config.metadata.firmware}
            </p>
          )}
          <p>{mode}</p>
          <Buttons>
            <button type="button" className="button primary" data-primary="true" onClick={dismiss}>
              Done
            </button>
          </Buttons>
        </Modal>
      )
    case 'readFailed':
      return (
        <Modal label="Couldn't read the scanner" onEscape={dismiss}>
          <h2 className="warning">
            <WarningIcon /> Couldn’t Read the Scanner
          </h2>
          <p>{sheet.message}</p>
          <Buttons>
            <button type="button" className="button primary" data-primary="true" onClick={dismiss}>
              OK
            </button>
          </Buttons>
        </Modal>
      )
    case 'checking':
      return (
        <Modal label="Checking the scanner" onEscape={cancel}>
          <h2>Checking the Scanner</h2>
          <ProgressBar progress={sheet.progress} />
          <p className="note">Reading what’s on the scanner now, to work out what needs to change.</p>
          <Buttons>
            <button type="button" className="button" onClick={cancel}>
              Cancel
            </button>
          </Buttons>
        </Modal>
      )
    case 'upToDate':
      return (
        <Modal label="Up to date" onEscape={dismiss}>
          <h2 className="success">
            <CheckCircleIcon /> The Scanner Is Up to Date
          </h2>
          <p>The scanner already holds everything in this document.</p>
          <p className="note">{mode}</p>
          <Buttons>
            <button type="button" className="button primary" data-primary="true" onClick={dismiss}>
              OK
            </button>
          </Buttons>
        </Modal>
      )
    case 'review': {
      const count = sheet.plan.steps.length
      return (
        <Modal wide label="Review changes" onEscape={cancel}>
          <h2>Write {plural(count, 'Change', 'Changes')} to the Scanner?</h2>
          <ChangeList plan={sheet.plan} />
          <p className="note">The scanner’s current contents are backed up first, so you can go back to them.</p>
          <Buttons>
            <button type="button" className="button" onClick={cancel}>
              Cancel
            </button>
            <button type="button" className="button primary" data-primary="true" onClick={() => void confirmWrite()}>
              Write {plural(count, 'Change', 'Changes')}
            </button>
          </Buttons>
        </Modal>
      )
    }
    case 'compared':
      return (
        <Modal wide label="Comparison" onEscape={dismiss}>
          <h2>The Scanner Differs in {plural(sheet.plan.steps.length, 'Place', 'Places')}</h2>
          <ChangeList plan={sheet.plan} />
          <p className="note">Each line shows the scanner’s value → this document’s. Nothing was written; use Write to Scanner to make the scanner match.</p>
          <Buttons>
            <button type="button" className="button primary" data-primary="true" onClick={dismiss}>
              Done
            </button>
          </Buttons>
        </Modal>
      )
    case 'writing':
      return (
        <Modal label="Writing" onEscape={cancel}>
          <h2>Writing {plural(sheet.plan.steps.length, 'Change', 'Changes')}</h2>
          <ProgressBar progress={sheet.progress} />
          <p className="note">After writing, the scanner is read back to check every change. Don’t disconnect it or close this tab.</p>
          <Buttons>
            <button type="button" className="button" onClick={cancel}>
              Cancel
            </button>
          </Buttons>
        </Modal>
      )
    case 'writeFinished': {
      const { report, plan, backup } = sheet
      return (
        <Modal wide label="Write finished" onEscape={dismiss}>
          {writeSucceeded(report) ? (
            <>
              <h2 className="success">
                <CheckCircleIcon /> Wrote {plural(report.written, 'Change', 'Changes')}
              </h2>
              <p>The scanner was read back and matches this document.</p>
              {plan.adjustments.length > 0 && (
                <p className="note">
                  {plural(plan.adjustments.length, 'value was', 'values were')} stored as the scanner allows, and the document was updated to match.
                </p>
              )}
              {report.storedDifferently.length > 0 && (
                <>
                  <p>The scanner stored {report.storedDifferently.length === 1 ? 'this frequency' : 'these frequencies'} differently than sent, and the document was updated to match:</p>
                  <div className="change-list" style={{ minHeight: 0 }}>
                    <ul>
                      {report.storedDifferently.map((a, i) => (
                        <li key={i} className="adjustment">
                          {a.title}: {a.detail}
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <h2 className="warning">
                <WarningIcon /> Some Changes Didn’t Take
              </h2>
              <div className="change-list">
                {report.failures.length > 0 && (
                  <section>
                    <h3>Rejected by the scanner</h3>
                    <ul>
                      {report.failures.map((failure) => (
                        <li key={failure.step.id}>
                          <div className="title">{failure.step.title}</div>
                          <div className="detail">{failure.reason}</div>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {report.mismatches.length > 0 && (
                  <section>
                    <h3>Still different after reading back</h3>
                    <ul>
                      {report.mismatches.map((step) => (
                        <li key={step.id}>
                          <div className="title">{step.title}</div>
                          <div className="detail">Scanner → document: {step.detail}</div>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
              <p className="note">
                Wrote {report.written} of {plan.steps.length}. The document wasn’t changed.
              </p>
            </>
          )}
          <p>{mode}</p>
          <Buttons>
            <button
              type="button"
              className="button"
              title={backup.name}
              onClick={() => {
                dismiss()
                openPanel('backups')
              }}
            >
              Show Backup
            </button>
            <button type="button" className="button primary" data-primary="true" onClick={dismiss}>
              Done
            </button>
          </Buttons>
        </Modal>
      )
    }
    case 'writeFailed':
      return (
        <Modal label="Couldn't write to the scanner" onEscape={dismiss}>
          <h2 className="warning">
            <WarningIcon /> Couldn’t Write to the Scanner
          </h2>
          <p>{sheet.message}</p>
          <Buttons>
            <button
              type="button"
              className="button"
              onClick={() => {
                dismiss()
                openPanel('backups')
              }}
            >
              Show Backups
            </button>
            <button type="button" className="button primary" data-primary="true" onClick={dismiss}>
              OK
            </button>
          </Buttons>
        </Modal>
      )
  }
}

/** Confirmations and alerts, one at a time. */
export function DialogHost() {
  const dialog = useDialogs((s) => s.dialogs[0])
  if (!dialog) return null
  const cancelButton = dialog.buttons.find((b) => b.cancel)
  return (
    <Modal key={dialog.id} label={dialog.title} onEscape={cancelButton ? () => dialog.resolve(cancelButton.value) : undefined}>
      <h2>{dialog.title}</h2>
      {dialog.message && <p>{dialog.message}</p>}
      <Buttons>
        {dialog.buttons.map((button, i) => (
          <span key={button.value} style={{ display: 'contents' }}>
            {button.destructive && !button.primary && i === 0 && dialog.buttons.length > 2 ? (
              <>
                <button type="button" className="button destructive" onClick={() => dialog.resolve(button.value)}>
                  {button.label}
                </button>
                <span className="spacer" />
              </>
            ) : (
              <button
                type="button"
                className={`button${button.primary ? ' primary' : ''}${button.destructive ? ' destructive' : ''}`}
                data-primary={button.primary ? 'true' : undefined}
                onClick={() => dialog.resolve(button.value)}
              >
                {button.label}
              </button>
            )}
          </span>
        ))}
      </Buttons>
    </Modal>
  )
}
