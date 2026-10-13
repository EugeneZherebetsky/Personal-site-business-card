import { useEffect, useState } from 'react'
import { formatDateTime } from '../lib/opportunities'
import { followUpDateInput, hasUnfilledPlaceholder, suggestedOutreach } from '../lib/outreach'
import {
  REPLY_STATUSES,
  REPLY_STATUS_LABELS,
  type CV,
  type Contact,
  type OutreachDraft,
  type EmailReply,
  type OutreachEmail,
  type ReplyStatus,
} from '../types'

export type OutreachOutcome = {
  reply_status: ReplyStatus
  follow_up_at: string
  notes: string
}

type OutreachFormProps = {
  initial: OutreachDraft
  /** Set when an already-sent message is open; its content is then read-only. */
  sent: OutreachEmail | null
  /** Set when a send attempt was made but its outcome is unknown. */
  inFlight: OutreachEmail | null
  title: string
  busy: boolean
  error: string
  cvs: CV[]
  contacts: Contact[]
  googleConfigured: boolean
  syncPending: boolean
  onCancel: () => void
  onSaveDraft: (draft: OutreachDraft) => Promise<void>
  onSend: (draft: OutreachDraft) => Promise<void>
  onUpdateOutcome: (email: OutreachEmail, outcome: OutreachOutcome) => Promise<void>
  onRetrySync: () => Promise<void>
  /** Resolves a message whose Gmail response was lost. */
  onResolveAttempt: (email: OutreachEmail, delivered: boolean) => Promise<void>
  /** Looks for the lost message in recent Sent mail. */
  onReconcileAttempt: (email: OutreachEmail) => Promise<void>
  /** Asks Gmail whether this thread has been answered. */
  onCheckReply: (email: OutreachEmail) => Promise<void>
  replies: EmailReply[]
}

export function OutreachForm({
  initial, sent, inFlight, title, busy, error, cvs, contacts, googleConfigured, syncPending, replies,
  onCancel, onSaveDraft, onSend, onUpdateOutcome, onRetrySync, onResolveAttempt, onReconcileAttempt, onCheckReply,
}: OutreachFormProps) {
  const [draft, setDraft] = useState<OutreachDraft>(initial)
  const [replyStatus, setReplyStatus] = useState<ReplyStatus>(sent?.reply_status ?? 'awaiting')
  const [validationError, setValidationError] = useState('')
  const readOnly = Boolean(sent) || Boolean(inFlight)

  useEffect(() => {
    if (sent?.reply_status) {
      setReplyStatus(sent.reply_status)
    }
  }, [sent?.reply_status])

  function field<K extends keyof OutreachDraft>(key: K, value: OutreachDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function prefill() {
    const suggestion = suggestedOutreach(draft.company, draft.recipient_name)
    setDraft((current) => ({
      ...current,
      subject: current.subject.trim() || suggestion.subject,
      body: current.body.trim() || suggestion.body,
      follow_up_at: current.follow_up_at || followUpDateInput(),
    }))
  }

  function applyContact(contactId: string) {
    const contact = contacts.find((candidate) => candidate.id === contactId)
    setDraft((current) => ({
      ...current,
      contact_id: contactId,
      company: contact?.company?.trim() || current.company,
      recipient_name: contact?.name ?? current.recipient_name,
      recipient_role: contact?.role_title ?? current.recipient_role,
      recipient_email: contact?.email ?? current.recipient_email,
    }))
  }

  function validate() {
    if (!draft.company.trim()) return 'Add the company you are writing to.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.recipient_email.trim())) return 'Add a valid recipient email address.'
    if (!draft.subject.trim()) return 'Add a subject line.'
    if (!draft.body.trim()) return 'Write the message before saving it.'
    return ''
  }

  async function saveDraft() {
    const problem = validate()
    setValidationError(problem)
    if (!problem) await onSaveDraft(draft)
  }

  async function send() {
    const problem = validate()
    setValidationError(problem)
    if (problem) return
    if (hasUnfilledPlaceholder(draft.body) && !window.confirm('The message still contains bracketed placeholder text. Send it anyway?')) return
    const cv = cvs.find((candidate) => candidate.id === draft.cv_id)
    const attachment = cv ? ` with "${cv.name}" attached` : ' without a CV attachment'
    if (!window.confirm(`Send this email to ${draft.recipient_email.trim()}${attachment}? It will be sent from the Google account you authorize.`)) return
    await onSend(draft)
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel() }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="outreach-form-title">
        <header className="modal-header">
          <div><p className="eyebrow">Speculative outreach</p><h2 id="outreach-form-title">{title}</h2></div>
          <button className="icon-button" type="button" aria-label="Close" disabled={busy} onClick={onCancel}>×</button>
        </header>

        <form className="job-form" onSubmit={(event) => { event.preventDefault(); if (!readOnly) void saveDraft() }}>
          {sent && (
            <div className="outreach-sent-banner full">
              <strong>Sent {sent.sent_at ? formatDateTime(sent.sent_at) : ''}</strong>
              <span>This is the message exactly as it was delivered, so its content can no longer be changed. Record what happened next below.</span>
            </div>
          )}

          {inFlight && (
            <div className="outreach-unknown-banner full" role="alert">
              <strong>Outcome unknown — do not send again yet</strong>
              <span>
                Gmail was asked to send this message {inFlight.send_attempted_at ? `at ${formatDateTime(inFlight.send_attempted_at)}` : ''}, but the reply never arrived, so it may or may not have been delivered. Its text is locked until the outcome is known. Let Opportunity Desk look through your recent Sent mail for “{inFlight.subject}”, or check yourself and record which happened.
              </span>
              <div className="button-row">
                <button className="button primary" type="button" disabled={busy || !googleConfigured} onClick={() => void onReconcileAttempt(inFlight)}>Check Gmail for me</button>
                <button className="button secondary" type="button" disabled={busy} onClick={() => void onResolveAttempt(inFlight, true)}>It is in Sent — record as sent</button>
                <button className="button secondary" type="button" disabled={busy} onClick={() => void onResolveAttempt(inFlight, false)}>Not in Sent — return to draft</button>
              </div>
            </div>
          )}

          <h3 className="form-section-title full">Who you wrote to</h3>
          {!readOnly && (
            <label className="full">Use a saved contact
              <select value={draft.contact_id} onChange={(event) => applyContact(event.target.value)}>
                <option value="">Not linked to a contact</option>
                {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}{contact.company ? ` · ${contact.company}` : ''}</option>)}
              </select>
              <small>Selecting one fills the fields below and keeps this message in that person's history.</small>
            </label>
          )}
          <label>Company<input required value={draft.company} disabled={readOnly} onChange={(event) => field('company', event.target.value)} /></label>
          <label>Their name<input value={draft.recipient_name} placeholder="Dana Lead" disabled={readOnly} onChange={(event) => field('recipient_name', event.target.value)} /></label>
          <label>Their role<input value={draft.recipient_role} placeholder="IT Director" disabled={readOnly} onChange={(event) => field('recipient_role', event.target.value)} /></label>
          <label>Their email<input type="email" required value={draft.recipient_email} disabled={readOnly} onChange={(event) => field('recipient_email', event.target.value)} /></label>

          <h3 className="form-section-title full">The message</h3>
          {!readOnly && (
            <div className="outreach-compose-actions full">
              <button className="button ghost" type="button" onClick={prefill}>Start from a suggested message</button>
              <small>It leaves bracketed gaps on purpose. A speculative email that never says why this company reads as a circular.</small>
            </div>
          )}
          <label>Subject<input required value={draft.subject} disabled={readOnly} onChange={(event) => field('subject', event.target.value)} /></label>
          <label>CV attached
            <select value={draft.cv_id} disabled={readOnly} onChange={(event) => field('cv_id', event.target.value)}>
              <option value="">No CV attached</option>
              {cvs.map((cv) => <option key={cv.id} value={cv.id}>{cv.name}</option>)}
            </select>
            {readOnly && sent?.attachment_filename && <small>Sent as {sent.attachment_filename}</small>}
          </label>
          <label className="full">Message<textarea className="outreach-body" required rows={16} value={draft.body} disabled={readOnly} onChange={(event) => field('body', event.target.value)} /></label>

          {!inFlight && <h3 className="form-section-title full">What happened next</h3>}
          {inFlight ? null : sent ? (
            <>
              <label>Reply
                <select value={replyStatus} onChange={(event) => setReplyStatus(event.target.value as ReplyStatus)}>
                  {REPLY_STATUSES.map((status) => <option key={status} value={status}>{REPLY_STATUS_LABELS[status]}</option>)}
                </select>
              </label>
              <label>Follow up on<input type="datetime-local" value={draft.follow_up_at} onChange={(event) => field('follow_up_at', event.target.value)} /><small>Appears in Reminders and in the daily email digest.</small></label>
              <label className="full">Notes<textarea rows={3} value={draft.notes} placeholder="What they said, who they referred you to, when to try again." onChange={(event) => field('notes', event.target.value)} /></label>
              <section className="outreach-replies full">
                <div className="outreach-replies-head">
                  <strong>Replies on this thread</strong>
                  <button className="button secondary" type="button" disabled={busy || !googleConfigured || !sent.provider_thread_id} onClick={() => void onCheckReply(sent)}>Check Gmail for a reply</button>
                </div>
                {replies.length === 0
                  ? <p className="compact-empty">{sent.provider_thread_id ? 'None recorded yet. Checking reads only the sender, subject and date, never the message itself.' : 'No Gmail thread was recorded for this message, so replies cannot be checked automatically.'}</p>
                  : <ul className="interaction-list">{replies.map((reply) => (
                      <li key={reply.id}>
                        <span><strong>{reply.from_address ?? 'Unknown sender'}</strong> · {formatDateTime(reply.received_at)}</span>
                        <p>{reply.subject || 'No subject'}</p>
                      </li>
                    ))}</ul>}
              </section>
            </>
          ) : (
            <>
              <label>Follow up on<input type="datetime-local" value={draft.follow_up_at} onChange={(event) => field('follow_up_at', event.target.value)} /><small>Most replies to speculative emails come from the follow-up, not the first message.</small></label>
              <label className="full">Notes<textarea rows={3} value={draft.notes} placeholder="Why this company, where you found them, anything to remember." onChange={(event) => field('notes', event.target.value)} /></label>
            </>
          )}

          {syncPending && (
            <div className="sync-retry-banner full" role="alert">
              <span><strong>Email already sent; record pending</strong>Gmail accepted this message but its record could not be updated. Retrying records the existing message and will not send it again.</span>
              <button className="button secondary" type="button" disabled={busy} onClick={() => void onRetrySync()}>Retry record sync</button>
            </div>
          )}

          {(validationError || error) && <p className="form-message error-text full" role="alert">{validationError || error}</p>}

          <div className="form-actions full">
            <button className="button secondary" type="button" disabled={busy} onClick={onCancel}>Close</button>
            {inFlight ? null : sent ? (
              <button className="button primary" type="button" disabled={busy} onClick={() => void onUpdateOutcome(sent, { reply_status: replyStatus, follow_up_at: draft.follow_up_at, notes: draft.notes })}>{busy ? 'Saving…' : 'Save outcome'}</button>
            ) : (
              <>
                <button className="button secondary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</button>
                <button className="button primary" type="button" disabled={busy || !googleConfigured || syncPending} onClick={() => void send()}>Send through Gmail</button>
              </>
            )}
          </div>
          {!readOnly && !googleConfigured && <small className="full">Add your Google OAuth client ID in Settings to send from here. You can still save the draft.</small>}
        </form>
      </section>
    </div>
  )
}
