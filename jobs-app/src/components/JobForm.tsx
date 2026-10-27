import { useState } from 'react'
import { checkableSends } from '../lib/gmailReplies'
import { sameCompany } from '../lib/naming'
import { JOB_STATUSES, PRIORITIES, STATUS_LABELS, WORK_MODES, type ApplicationSend, type CV, type EmailReply, type Job, type JobDraft, type JobPriority, type JobStatus, type WorkMode } from '../types'
import { ReplyList } from './ReplyList'

type JobFormProps = {
  initial: JobDraft
  title: string
  busy: boolean
  error: string
  /** Outcome of a reply check, shown inside the dialog. */
  notice: string
  cvs: CV[]
  /** Company names already used anywhere in the workspace, one spelling per employer. */
  companySuggestions?: string[]
  /** Source labels to suggest: the standard list plus the user's own. */
  sourceSuggestions?: string[]
  /** Every other application, used to spot the same employer typed differently. */
  otherJobs?: Job[]
  existing: boolean
  googleConfigured: boolean
  sendHistoryPending: boolean
  sendHistory: ApplicationSend[]
  /** Messages already detected on the Gmail threads this application was sent on. */
  replies: EmailReply[]
  onCancel: () => void
  onSave: (draft: JobDraft) => Promise<void>
  onTailor: (draft: JobDraft) => Promise<void>
  onCalendar: (draft: JobDraft) => Promise<void>
  onSend: (draft: JobDraft) => Promise<void>
  onRetrySendHistory: () => Promise<void>
  /** Asks Gmail whether any thread this application was sent on has been answered. */
  onCheckReplies: () => Promise<void>
}

function mostCommon(values: string[]) {
  const counts = new Map<string, number>()
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1))
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0][0]
}

function withEmailDefaults(initial: JobDraft): JobDraft {
  return {
    ...initial,
    email_recipient: initial.email_recipient || initial.contact_email,
    email_subject: initial.email_subject || `Application for ${initial.role_title || '[role]'} at ${initial.company || '[company]'}`,
    email_body: initial.email_body || `Dear Hiring Manager,\n\nI'm writing to apply for the ${initial.role_title || '[role]'} position at ${initial.company || '[company]'}. Please find my CV attached.\n\n[Add one or two lines on why you're a strong fit.]\n\nKind regards,\nEugene Zherebetsky`,
  }
}

function sentAtLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function JobForm({ initial, title, busy, error, notice, cvs, companySuggestions = [], sourceSuggestions = [], otherJobs = [], existing, googleConfigured, sendHistoryPending, sendHistory, replies, onCancel, onSave, onTailor, onCalendar, onSend, onRetrySendHistory, onCheckReplies }: JobFormProps) {
  const [draft, setDraft] = useState<JobDraft>(() => withEmailDefaults(initial))
  const canCheckReplies = checkableSends(sendHistory).length > 0
  const sameEmployer = draft.company.trim().length > 1 ? otherJobs.filter((job) => sameCompany(job.company, draft.company)) : []
  const usualSpelling = sameEmployer.length ? mostCommon(sameEmployer.map((job) => job.company.trim())) : null

  function field<K extends keyof JobDraft>(key: K, value: JobDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="job-form-title">
        <div className="modal-header">
          <div><p className="eyebrow">Application record</p><h2 id="job-form-title">{title}</h2></div>
          <button className="icon-button" onClick={onCancel} aria-label="Close form">×</button>
        </div>
        <form className="job-form" onSubmit={(event) => { event.preventDefault(); void onSave(draft) }}>
          <h3 className="form-section-title full">Opportunity</h3>
          <label>Company<input value={draft.company} list="company-suggestions" autoComplete="off" onChange={(event) => field('company', event.target.value)} required />
            {sameEmployer.length > 0 && <small className="company-hint">Already tracked: {sameEmployer.slice(0, 3).map((job) => `${job.role_title} (${STATUS_LABELS[job.status]})`).join(', ')}{sameEmployer.length > 3 ? ` and ${sameEmployer.length - 3} more` : ''}.{usualSpelling && usualSpelling !== draft.company.trim() && <> <button type="button" className="link-button" onClick={() => field('company', usualSpelling)}>Use “{usualSpelling}”</button></>}</small>}
          </label>
          <datalist id="company-suggestions">{companySuggestions.map((name) => <option key={name} value={name} />)}</datalist>
          <label>Role title<input value={draft.role_title} onChange={(event) => field('role_title', event.target.value)} required /></label>
          <label>Status<select value={draft.status} onChange={(event) => field('status', event.target.value as JobStatus)}>{JOB_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</select></label>
          <label>Priority<select value={draft.priority} onChange={(event) => field('priority', event.target.value as JobPriority)}>{PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority[0].toUpperCase() + priority.slice(1)}</option>)}</select></label>
          <label>Work style<select value={draft.work_mode} onChange={(event) => field('work_mode', event.target.value as WorkMode)}>{WORK_MODES.map((mode) => <option key={mode} value={mode}>{mode === 'unspecified' ? 'Not specified' : mode[0].toUpperCase() + mode.slice(1)}</option>)}</select></label>
          <label>Location<input value={draft.location} onChange={(event) => field('location', event.target.value)} /></label>
          <label>Job link<input type="url" value={draft.job_url} onChange={(event) => field('job_url', event.target.value)} placeholder="https://" /></label>
          <label>Source<input value={draft.source} list="source-suggestions" autoComplete="off" onChange={(event) => field('source', event.target.value)} placeholder="LinkedIn, Referral…" /></label>
          <datalist id="source-suggestions">{sourceSuggestions.map((name) => <option key={name} value={name} />)}</datalist>
          <label>CV used<select value={draft.cv_id} onChange={(event) => field('cv_id', event.target.value)}><option value="">No CV linked</option>{cvs.map((cv) => <option key={cv.id} value={cv.id}>{cv.name}{cv.tailored_company ? ` — ${cv.tailored_company}` : ''}</option>)}</select></label>
          <label>Salary / package<input value={draft.salary_text} onChange={(event) => field('salary_text', event.target.value)} /></label>
          <label>Source reference<input value={draft.external_job_id} onChange={(event) => field('external_job_id', event.target.value)} placeholder="Optional job ID" /></label>
          <label className="full">Job description<textarea rows={6} value={draft.job_description} onChange={(event) => field('job_description', event.target.value)} /></label>

          <h3 className="form-section-title full">Progress and follow-up</h3>
          <label>Applied date<input type="date" value={draft.applied_at} onChange={(event) => field('applied_at', event.target.value)} /></label>
          <label>Next action<input value={draft.next_action} onChange={(event) => field('next_action', event.target.value)} placeholder="Follow up, prepare interview…" /></label>
          <label>Next action date and time<input type="datetime-local" value={draft.next_action_at} onChange={(event) => field('next_action_at', event.target.value)} /></label>
          <label>Contact name<input value={draft.contact_name} onChange={(event) => field('contact_name', event.target.value)} /></label>
          <label>Contact email<input type="email" value={draft.contact_email} onChange={(event) => field('contact_email', event.target.value)} /></label>
          <label className="full">Notes<textarea rows={5} value={draft.notes} onChange={(event) => field('notes', event.target.value)} /></label>

          <h3 className="form-section-title full">Email draft</h3>
          <label>Email recipient<input type="email" value={draft.email_recipient} onChange={(event) => field('email_recipient', event.target.value)} /></label>
          <label>Email subject<input value={draft.email_subject} onChange={(event) => field('email_subject', event.target.value)} /></label>
          <label className="full">Email message<textarea rows={6} value={draft.email_body} onChange={(event) => field('email_body', event.target.value)} /></label>

          <section className="ai-actions full" aria-label="CV matching and AI drafting">
            <div><strong>CV match and tailoring</strong><span>Compare your saved CV text with this job for free, then optionally create an AI-assisted CV and cover-letter draft.</span></div>
            <button className="button secondary" disabled={busy || !existing} type="button" onClick={(event) => { if (event.currentTarget.form?.reportValidity()) void onTailor(draft) }}>Open tailoring tool</button>
            {!existing && <small>Save the application once before opening the tailoring tool.</small>}
          </section>

          <section className="google-actions full" aria-label="Google actions">
            <div><strong>Google actions</strong><span>{googleConfigured ? 'Google will ask for Calendar and Gmail permission when needed. Access stays in this browser session.' : 'Add your public Google OAuth client ID in Settings to enable these actions.'}</span></div>
            <div className="button-row">
              <button className="button secondary" disabled={busy || !existing || !googleConfigured || !draft.next_action_at} type="button" onClick={() => void onCalendar(draft)}>Add to Google Calendar</button>
              <button className="button secondary" disabled={busy || !existing || !googleConfigured || sendHistoryPending} type="button" onClick={() => void onSend(draft)}>Send CV via Gmail</button>
              {sendHistoryPending && <button className="button secondary" disabled={busy} type="button" onClick={() => void onRetrySendHistory()}>Retry history sync</button>}
            </div>
            {!existing && <small>Save the application once before using Google actions.</small>}
            {sendHistoryPending && <small>The previous email was already sent. Synchronize its history before sending another message; retrying does not resend it.</small>}
          </section>

          {sendHistory.length > 0 && <section className="send-history full"><strong>Send history</strong>{sendHistory.map((send) => <div key={send.id} className={send.status === 'sent' ? 'sent' : 'failed'}><span>{send.status === 'sent' ? 'Sent' : 'Failed'} {sentAtLabel(send.sent_at)}</span><small>{send.recipient} · {send.subject}</small></div>)}</section>}

          {canCheckReplies && (
            <section className="replies-panel full" aria-label="Replies to this application">
              <div className="replies-panel-head">
                <strong>Replies</strong>
                <button className="button secondary" type="button" disabled={busy || !googleConfigured} onClick={() => void onCheckReplies()}>Check Gmail for replies</button>
              </div>
              {replies.length > 0
                ? <ReplyList replies={replies} />
                : <small>Nothing recorded yet. A check reads only the sender, subject and date of each message on the threads you sent, never its content.</small>}
              <small>The stage is never changed for you. Move this application on yourself if the conversation has progressed.</small>
            </section>
          )}

          {error && <p className="form-message error-text full" role="alert">{error}</p>}
          {notice && !error && <p className="form-message full" role="status">{notice}</p>}
          <div className="form-actions full">
            <button className="button secondary" type="button" onClick={onCancel}>Cancel</button>
            <button className="button primary" disabled={busy} type="submit">{busy ? 'Saving…' : 'Save application'}</button>
          </div>
        </form>
      </section>
    </div>
  )
}
