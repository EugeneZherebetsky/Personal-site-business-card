import { useState } from 'react'
import { toLocalDateTimeInput } from '../lib/opportunities'
import {
  CONTACT_RELATIONSHIPS,
  CONTACT_STAGES,
  CONTACT_STAGE_LABELS,
  INTERACTION_CHANNELS,
  INTERACTION_CHANNEL_LABELS,
  RELATIONSHIP_LABELS,
  type ContactDraft,
  type ContactInteraction,
  type ContactRelationship,
  type ContactStage,
  type InteractionChannel,
  type InteractionDraft,
  type Job,
} from '../types'

type ContactFormProps = {
  initial: ContactDraft
  title: string
  busy: boolean
  error: string
  jobs: Job[]
  /** Company names already used in the workspace, offered as suggestions. */
  companySuggestions?: string[]
  existing: boolean
  interactions: ContactInteraction[]
  onCancel: () => void
  onSave: (draft: ContactDraft) => Promise<void>
  onLogInteraction: (draft: InteractionDraft) => Promise<boolean>
  onDeleteInteraction: (interaction: ContactInteraction) => Promise<void>
}

function interactionLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function ContactForm({ initial, title, busy, error, jobs, companySuggestions = [], existing, interactions, onCancel, onSave, onLogInteraction, onDeleteInteraction }: ContactFormProps) {
  const [draft, setDraft] = useState<ContactDraft>(initial)
  const [interactionDraft, setInteractionDraft] = useState<InteractionDraft>({ occurred_at: toLocalDateTimeInput(new Date().toISOString()), channel: 'email', summary: '' })
  const [interactionError, setInteractionError] = useState('')

  function field<K extends keyof ContactDraft>(key: K, value: ContactDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  async function logInteraction() {
    setInteractionError('')
    if (!interactionDraft.summary.trim()) {
      setInteractionError('Describe the interaction before logging it.')
      return
    }
    const logged = await onLogInteraction(interactionDraft)
    if (logged) setInteractionDraft((current) => ({ ...current, summary: '' }))
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel() }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="contact-form-title">
        <header className="modal-header">
          <div><p className="eyebrow">Networking tracker</p><h2 id="contact-form-title">{title}</h2></div>
          <button className="icon-button" type="button" aria-label="Close form" disabled={busy} onClick={onCancel}>×</button>
        </header>
        <form className="job-form" onSubmit={(event) => { event.preventDefault(); void onSave(draft) }}>
          <h3 className="form-section-title full">Person</h3>
          <label>Name<input required autoFocus value={draft.name} onChange={(event) => field('name', event.target.value)} /></label>
          <label>Relationship<select value={draft.relationship} onChange={(event) => field('relationship', event.target.value as ContactRelationship)}>{CONTACT_RELATIONSHIPS.map((relationship) => <option key={relationship} value={relationship}>{RELATIONSHIP_LABELS[relationship]}</option>)}</select></label>
          <label>Company<input value={draft.company} list="contact-company-suggestions" autoComplete="off" onChange={(event) => field('company', event.target.value)} /></label>
          <datalist id="contact-company-suggestions">{companySuggestions.map((name) => <option key={name} value={name} />)}</datalist>
          <label>Role<input value={draft.role_title} onChange={(event) => field('role_title', event.target.value)} placeholder="Talent partner, engineering manager…" /></label>
          <label>Email<input type="email" value={draft.email} onChange={(event) => field('email', event.target.value)} /></label>
          <label>Phone<input value={draft.phone} onChange={(event) => field('phone', event.target.value)} /></label>
          <label className="full">LinkedIn or profile link<input type="url" value={draft.linkedin_url} onChange={(event) => field('linkedin_url', event.target.value)} placeholder="https://www.linkedin.com/in/…" /></label>

          <h3 className="form-section-title full">Networking pipeline</h3>
          <label>Stage<select value={draft.pipeline_stage} onChange={(event) => field('pipeline_stage', event.target.value as ContactStage)}>{CONTACT_STAGES.map((stage) => <option key={stage} value={stage}>{CONTACT_STAGE_LABELS[stage]}</option>)}</select></label>
          <label>Linked opportunity<select value={draft.job_id} onChange={(event) => field('job_id', event.target.value)}><option value="">No opportunity linked</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.role_title} · {job.company}</option>)}</select></label>
          <label>Next action<input value={draft.next_action} onChange={(event) => field('next_action', event.target.value)} placeholder="Send thank-you note, follow up…" /></label>
          <label>Next action date and time<input type="datetime-local" value={draft.next_action_at} onChange={(event) => field('next_action_at', event.target.value)} /></label>
          <label className="full">Notes<textarea rows={4} value={draft.notes} onChange={(event) => field('notes', event.target.value)} placeholder="How you met, shared interests, promises made…" /></label>

          <section className="interaction-log full" aria-label="Interaction history">
            <h3 className="form-section-title">Interaction history</h3>
            {existing ? (
              <>
                <div className="interaction-add">
                  <label>Channel<select value={interactionDraft.channel} onChange={(event) => setInteractionDraft({ ...interactionDraft, channel: event.target.value as InteractionChannel })}>{INTERACTION_CHANNELS.map((channel) => <option key={channel} value={channel}>{INTERACTION_CHANNEL_LABELS[channel]}</option>)}</select></label>
                  <label>When<input type="datetime-local" value={interactionDraft.occurred_at} onChange={(event) => setInteractionDraft({ ...interactionDraft, occurred_at: event.target.value })} /></label>
                  <label className="interaction-summary">What happened<input value={interactionDraft.summary} onChange={(event) => setInteractionDraft({ ...interactionDraft, summary: event.target.value })} placeholder="Call about the platform role; they will introduce me to the team lead." /></label>
                  <button className="button secondary" type="button" disabled={busy} onClick={() => void logInteraction()}>Log interaction</button>
                </div>
                {interactionError && <p className="form-message error-text" role="alert">{interactionError}</p>}
                {interactions.length === 0 ? <p className="compact-empty">No interactions are logged yet.</p> : (
                  <ul className="interaction-list">
                    {interactions.map((interaction) => (
                      <li key={interaction.id}>
                        <span><strong>{INTERACTION_CHANNEL_LABELS[interaction.channel]}</strong> · {interactionLabel(interaction.occurred_at)}</span>
                        <p>{interaction.summary}</p>
                        <button className="button ghost" type="button" disabled={busy} onClick={() => void onDeleteInteraction(interaction)}>Remove</button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : <p className="compact-empty">Save the contact once to start logging interactions.</p>}
          </section>

          {error && <p className="form-message error-text full" role="alert">{error}</p>}
          <div className="form-actions full">
            <button className="button secondary" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
            <button className="button primary" disabled={busy} type="submit">{busy ? 'Saving…' : 'Save contact'}</button>
          </div>
        </form>
      </section>
    </div>
  )
}
