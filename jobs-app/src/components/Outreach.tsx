import { useMemo, useState } from 'react'
import { formatDateTime, relativeDueLabel } from '../lib/opportunities'
import { outreachMatches, outreachSummary, type OutreachFilter } from '../lib/outreach'
import { OUTREACH_STATUS_LABELS, REPLY_STATUS_LABELS, type OutreachEmail } from '../types'

type OutreachViewProps = {
  emails: OutreachEmail[]
  busy: boolean
  onCompose: () => void
  onOpen: (email: OutreachEmail) => void
  onDelete: (email: OutreachEmail) => Promise<void>
  /** Returns to Network, where this page is linked from. */
  onBack?: () => void
}

const FILTERS: Array<{ key: OutreachFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Drafts' },
  { key: 'sending', label: 'Outcome unknown' },
  { key: 'awaiting', label: 'Awaiting reply' },
  { key: 'replied', label: 'Replied' },
  { key: 'no_reply', label: 'No reply' },
]

export function OutreachView({ emails, busy, onCompose, onOpen, onDelete, onBack }: OutreachViewProps) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<OutreachFilter>('all')
  const summary = useMemo(() => outreachSummary(emails), [emails])
  const visible = useMemo(
    () => emails
      .filter((email) => outreachMatches(email, search, filter))
      .sort((left, right) => {
        const leftAt = left.sent_at ?? left.updated_at
        const rightAt = right.sent_at ?? right.updated_at
        return new Date(rightAt).getTime() - new Date(leftAt).getTime()
      }),
    [emails, filter, search],
  )

  return (
    <>
      <section className="metrics" aria-label="Outreach summary">
        <article><span>Emails sent</span><strong>{summary.sent}</strong><small className="metric-note">to {summary.companies} compan{summary.companies === 1 ? 'y' : 'ies'}</small></article>
        <article><span>Awaiting reply</span><strong>{summary.awaiting}</strong></article>
        <article><span>Replied</span><strong>{summary.replied}</strong><small className="metric-note">{summary.sent ? `${summary.replied} of ${summary.sent} sent` : 'no data yet'}</small></article>
        <article><span>Drafts</span><strong>{summary.drafts}</strong></article>
      </section>

      <section className="workspace-card">
        <div className="workspace-head">
          <div><p className="eyebrow">Speculative outreach</p><h2>{emails.length} message{emails.length === 1 ? '' : 's'}</h2></div>
          <div className="controls">
            {onBack && <button className="button ghost" type="button" onClick={onBack}>← Network</button>}
            <button className="button primary" onClick={onCompose}>+ Write to a company</button>
            <input aria-label="Search outreach" placeholder="Search company, person, subject or message" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
        </div>

        {emails.length > 0 && (
          <div className="stage-summary" aria-label="Filter outreach">
            {FILTERS.map((option) => (
              <button key={option.key} className={filter === option.key ? 'stage-chip active' : 'stage-chip'} type="button" onClick={() => setFilter(option.key)}>
                {option.label}
              </button>
            ))}
          </div>
        )}

        {visible.length === 0 ? (
          <div className="empty-state">
            <strong>{emails.length ? 'No matching messages' : 'Write to the companies you want, not only the ones advertising'}</strong>
            <span>{emails.length ? 'Try a different search or filter.' : 'Track every speculative email to a company leader here. The exact message you send is kept, so a follow-up months later can pick up precisely where you left off.'}</span>
            {!emails.length && <button className="button primary" onClick={onCompose}>Write your first message</button>}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Company and person</th><th>Message</th><th>State</th><th>Follow-up</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {visible.map((email) => (
                  <tr key={email.id}>
                    <td>
                      <strong>{email.company}</strong>
                      <span>{[email.recipient_name, email.recipient_role].filter(Boolean).join(' · ') || email.recipient_email}</span>
                    </td>
                    <td>
                      <strong>{email.subject}</strong>
                      <span>{email.status === 'sent' && email.sent_at ? `Sent ${formatDateTime(email.sent_at)}` : email.status === 'sending' ? `Send attempted ${email.send_attempted_at ? formatDateTime(email.send_attempted_at) : ''}` : `Draft, updated ${formatDateTime(email.updated_at)}`}</span>
                      {email.attachment_filename && <span className="sent-summary">Attached {email.attachment_filename}</span>}
                    </td>
                    <td>
                      <div className="badges">
                        <span className={`status status-${email.status === 'sent' ? 'applied' : email.status === 'sending' ? 'on_hold' : 'saved'}`}>{OUTREACH_STATUS_LABELS[email.status]}</span>
                        {email.status === 'sent' && <span className="tag">{REPLY_STATUS_LABELS[email.reply_status]}</span>}
                      </div>
                    </td>
                    <td>
                      {email.follow_up_at && email.reply_status !== 'replied'
                        ? <><strong>{formatDateTime(email.follow_up_at)}</strong><span className={new Date(email.follow_up_at).getTime() < Date.now() ? 'overdue' : ''}>{relativeDueLabel(email.follow_up_at)}</span></>
                        : <span>{email.reply_status === 'replied' ? 'Answered' : 'Not scheduled'}</span>}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button className="button secondary" onClick={() => onOpen(email)}>{email.status === 'sent' ? 'View email' : email.status === 'sending' ? 'Resolve outcome' : 'Edit draft'}</button>
                        <button className="button danger" disabled={busy || email.status === 'sending'} title={email.status === 'sending' ? 'Resolve whether this was delivered before deleting it.' : undefined} onClick={() => void onDelete(email)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
