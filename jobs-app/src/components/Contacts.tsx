import { useMemo, useState } from 'react'
import { contactMatches } from '../lib/networking'
import { formatDateTime, relativeDueLabel } from '../lib/opportunities'
import {
  CONTACT_STAGES,
  CONTACT_STAGE_LABELS,
  RELATIONSHIP_LABELS,
  type Contact,
  type ContactStage,
  type Job,
} from '../types'

type ContactsViewProps = {
  contacts: Contact[]
  jobs: Job[]
  busy: boolean
  onAdd: () => void
  onEdit: (contact: Contact) => void
  onDelete: (contact: Contact) => Promise<void>
  onStage: (contact: Contact, stage: ContactStage) => Promise<void>
  /** Opens the speculative outreach log, which is kept out of the main menu. */
  onOpenOutreach?: () => void
}

export function ContactsView({ contacts, jobs, busy, onAdd, onEdit, onDelete, onStage, onOpenOutreach }: ContactsViewProps) {
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState<'all' | ContactStage>('all')
  const visibleContacts = useMemo(() => contacts.filter((contact) => contactMatches(contact, search, stageFilter)), [contacts, search, stageFilter])
  const stageCounts = useMemo(() => CONTACT_STAGES.map((stage) => ({ stage, count: contacts.filter((contact) => contact.pipeline_stage === stage).length })), [contacts])

  return (
    <section className="workspace-card">
      <div className="workspace-head">
        <div><p className="eyebrow">Relationships and referrals</p><h2>{contacts.length} contacts</h2></div>
        <div className="controls">
          <input aria-label="Search contacts" placeholder="Search name, company, role or notes" value={search} onChange={(event) => setSearch(event.target.value)} />
          <select aria-label="Filter by networking stage" value={stageFilter} onChange={(event) => setStageFilter(event.target.value as 'all' | ContactStage)}>
            <option value="all">All stages</option>
            {CONTACT_STAGES.map((stage) => <option key={stage} value={stage}>{CONTACT_STAGE_LABELS[stage]}</option>)}
          </select>
          {onOpenOutreach && <button className="button secondary" type="button" onClick={onOpenOutreach}>Outreach emails</button>}
        </div>
      </div>
      {contacts.length > 0 && (
        <div className="stage-summary" aria-label="Networking pipeline summary">
          {stageCounts.filter(({ count }) => count > 0).map(({ stage, count }) => (
            <button key={stage} className={stageFilter === stage ? 'stage-chip active' : 'stage-chip'} type="button" onClick={() => setStageFilter((current) => current === stage ? 'all' : stage)}>
              {CONTACT_STAGE_LABELS[stage]} <strong>{count}</strong>
            </button>
          ))}
        </div>
      )}
      {visibleContacts.length === 0 ? (
        <div className="empty-state">
          <strong>{contacts.length ? 'No matching contacts' : 'Build your network'}</strong>
          <span>{contacts.length ? 'Try a different search or stage.' : 'Recruiters, referrals, and timely follow-ups often produce better results than more cold applications.'}</span>
          {!contacts.length && <button className="button primary" onClick={onAdd}>Add your first contact</button>}
        </div>
      ) : (
        <div className="cv-grid">
          {visibleContacts.map((contact) => {
            const linkedJob = jobs.find((job) => job.id === contact.job_id)
            const latest = contact.last_interaction_at
            return (
              <article className="cv-card" key={contact.id}>
                <div className="cv-card-head">
                  <span className="cv-file-mark" aria-hidden="true">{contact.name.trim().charAt(0).toUpperCase() || '?'}</span>
                  <div><h3>{contact.name}</h3><p>{[contact.role_title, contact.company].filter(Boolean).join(' · ') || 'No company details yet'}</p></div>
                </div>
                <div className="badges">
                  <span className="tag">{RELATIONSHIP_LABELS[contact.relationship]}</span>
                  <span className="tag">{CONTACT_STAGE_LABELS[contact.pipeline_stage]}</span>
                </div>
                <div className="cv-meta">
                  <span>{latest ? `Last interaction ${formatDateTime(latest)}` : 'No interactions logged'}</span>
                  {linkedJob && <span>Linked to {linkedJob.role_title} · {linkedJob.company}</span>}
                </div>
                {contact.next_action_at && <div className="contact-next"><strong>{contact.next_action || 'Follow up'}</strong><em className={new Date(contact.next_action_at).getTime() < Date.now() ? 'overdue' : ''}>{relativeDueLabel(contact.next_action_at)}</em></div>}
                {(contact.email || contact.phone || contact.linkedin_url) && (
                  <div className="contact-links">
                    {contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
                    {contact.phone && <a href={`tel:${contact.phone}`}>{contact.phone}</a>}
                    {contact.linkedin_url && <a href={contact.linkedin_url} target="_blank" rel="noreferrer">Profile</a>}
                  </div>
                )}
                {contact.notes && <p className="cv-notes">{contact.notes.slice(0, 160)}{contact.notes.length > 160 ? '…' : ''}</p>}
                <label className="compact-select">Stage<select disabled={busy} value={contact.pipeline_stage} onChange={(event) => void onStage(contact, event.target.value as ContactStage)}>{CONTACT_STAGES.map((stage) => <option key={stage} value={stage}>{CONTACT_STAGE_LABELS[stage]}</option>)}</select></label>
                <div className="cv-actions">
                  <button className="button secondary" disabled={busy} onClick={() => onEdit(contact)}>Edit</button>
                  <button className="button danger" disabled={busy} onClick={() => void onDelete(contact)}>Delete</button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
