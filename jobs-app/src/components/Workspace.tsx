import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import type { RealtimeChannel, Session } from '@supabase/supabase-js'
import { cvToDraft, safeStorageFilename, validateCVFile } from '../lib/cvs'
import { buildRawEmail, clearGoogleAccess, createCalendarEvent, fetchGmailThread, fetchRecentSentMessages, forgetGoogleScope, GMAIL_METADATA_SCOPE, GoogleScopeError, hasGoogleAccess, isGoogleRefusal, isTerminalClientError, requestGoogleAccess, sendGmailMessage, validGoogleClientId } from '../lib/google'
import { checkableSends, findThreadReplies, matchLostSend, summarizeReplies, type ThreadCheckSummary } from '../lib/gmailReplies'
import {
  ACTIVE_STATUSES,
  downloadText,
  draftToPayload,
  formatDateTime,
  jobMatches,
  jobsToCsv,
  relativeDueLabel,
  toDraft,
} from '../lib/opportunities'
import { backupRows, parseBackup } from '../lib/backup'
import { NAV_GROUPS, NAV_ITEMS, activeNavView, viewTitle } from '../lib/navigation'
import { clearPending, pendingOutreachKey, pendingSendKey, readPendingOutreach, readPendingSend, storePending, type PendingOutreachRecord } from '../lib/pendingRecords'
import { blockDraftToPayload, blockToDraft } from '../lib/cvBuilder'
import { dueOutreachFollowUps, outreachDraftToPayload, outreachToDraft } from '../lib/outreach'
import {
  contactDraftToPayload,
  contactToDraft,
  interactionDraftToPayload,
  prepDraftToPayload,
  starStoryDraftToPayload,
  starStoryToDraft,
} from '../lib/networking'
import { cvEmailAttachment } from '../data/attachments'
import { insertApplicationSend, insertFailedSend, readApplicationSend } from '../data/applicationSends'
import { deleteContactRow, deleteInteractionRow, insertInteraction, listInteractions, saveContactRecord, updateContactStage } from '../data/contacts'
import { deleteCVBlockRow, saveCVBlockRecord } from '../data/cvBlocks'
import { recordEmailReplies } from '../data/emailReplies'
import { deleteCVRow, insertCVReturningVersion, insertCVRow, readCVVersion, removeCVFile, updateCVLocked, uploadCVFile, downloadCVFile } from '../data/cvs'
import { insertInterviewPrep, readInterviewPrep, readInterviewPrepForJob, updateInterviewPrep } from '../data/interviewPreps'
import { deleteJobRow, importJobRows, insertJobRow, linkJobCV, readJobVersion, saveJobRecord, updateJobLocked, updateJobReturningRow, updateJobVersioned } from '../data/jobs'
import { claimOutreachForSending, deleteOutreachRow, markOutreachReplied, markOutreachSent, persistOutreachForSend, readOutreachMessageId, releaseOutreachClaim, resolveOutreachAttempt, saveOutreachRecord, updateOutreachOutcome } from '../data/outreachEmails'
import { currentTimezone, defaultSettings, updateSettings, upsertSettings } from '../data/settings'
import { deleteStarStoryRow, saveStarStoryRecord } from '../data/starStories'
import type { SaveResult, VersionedRecord } from '../data/versioned'
import { fetchWorkspace, signOutWorkspace, subscribeToWorkspace, unsubscribeFromWorkspace } from '../data/workspace'
import {
  EMPTY_CONTACT,
  EMPTY_CV,
  EMPTY_CV_BLOCK,
  EMPTY_JOB,
  EMPTY_OUTREACH,
  EMPTY_STAR_STORY,
  type ApplicationSend,
  type AppView,
  type CV,
  type CVBlock,
  type CVBlockDraft,
  type CVDraft,
  type Contact,
  type ContactDraft,
  type ContactInteraction,
  type ContactStage,
  type EmailReply,
  type InteractionDraft,
  type InterviewPrep,
  type InterviewPrepDraft,
  type InterviewPrepSaveResult,
  type Job,
  type JobDraft,
  type JobStageEvent,
  type JobStatus,
  type OutreachDraft,
  type OutreachEmail,
  type SettingsDraft,
  type StarStory,
  type StarStoryDraft,
  type UserSettings,
  STATUS_LABELS,
} from '../types'
import { ApplicationsView } from './Applications'
import { BackupView } from './Backup'
import { BoardView } from './Board'
import { ContactForm } from './ContactForm'
import { ContactsView } from './Contacts'
import { CVBlockForm } from './CVBlockForm'
import { CVBuilder, type BuiltCV } from './CVBuilder'
import { CVForm } from './CVForm'
import { CVLibrary } from './CVLibrary'
import { InterviewPrepView } from './InterviewPrep'
import { JobForm } from './JobForm'
import { JobSearch } from './JobSearch'
import { OutreachView } from './Outreach'
import { OverviewView } from './Overview'
import { OutreachForm, type OutreachOutcome } from './OutreachForm'
import { RemindersView } from './Reminders'
import { SettingsView } from './Settings'
import { StarStoryForm } from './StarStoryForm'
import { StarStoryView } from './StarStoryView'
import type { JobSearchResult } from '../lib/jobSearch'
import { TailorCV } from './TailorCV'
import { tailoredCVText, type TailoringResult } from '../lib/tailoring'

type WorkspaceProps = { session: Session }

/**
 * Reading reply headers needs the Gmail metadata scope, which can be declined
 * on its own. A missing grant is caught before the call (`GoogleScopeError`);
 * a refusal from Gmail itself usually means the same thing.
 */
function gmailReadError(caught: unknown) {
  if (caught instanceof GoogleScopeError) return caught.message
  const message = caught instanceof Error ? caught.message : 'Gmail could not be reached.'
  if (isGoogleRefusal(caught) && (caught.status === 401 || caught.status === 403)) {
    return `${message} Checking Gmail needs the permission that reads message headers only. Try again and allow it when Google asks.`
  }
  return message
}

/** Explains automatic messages found on a thread, which never count as replies. */
function automatedNote(summary: ThreadCheckSummary) {
  const parts: string[] = []
  if (summary.bounces) parts.push(`${summary.bounces} delivery failure${summary.bounces === 1 ? '' : 's'}`)
  if (summary.autoReplies) parts.push(`${summary.autoReplies} automatic repl${summary.autoReplies === 1 ? 'y' : 'ies'}`)
  return parts.length ? ` Also found ${parts.join(' and ')}, which do not count as a reply.` : ''
}

function localDateInput() {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function Workspace({ session }: WorkspaceProps) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [cvs, setCVs] = useState<CV[]>([])
  const [applicationSends, setApplicationSends] = useState<ApplicationSend[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [contactHistory, setContactHistory] = useState<ContactInteraction[]>([])
  const [starStories, setStarStories] = useState<StarStory[]>([])
  const [interviewPreps, setInterviewPreps] = useState<InterviewPrep[]>([])
  const [stageEvents, setStageEvents] = useState<JobStageEvent[]>([])
  const [cvBlocks, setCVBlocks] = useState<CVBlock[]>([])
  const [outreachEmails, setOutreachEmails] = useState<OutreachEmail[]>([])
  const [emailReplies, setEmailReplies] = useState<EmailReply[]>([])
  const [editingOutreach, setEditingOutreach] = useState<OutreachEmail | 'new' | null>(null)
  const [pendingOutreach, setPendingOutreach] = useState<PendingOutreachRecord | null>(() => readPendingOutreach(session.user.id))
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const [settingsPersisted, setSettingsPersisted] = useState(false)
  const [view, setView] = useState<AppView>('dashboard')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  /** Reply-check outcomes, shown inside the open dialog rather than behind it. */
  const [dialogNotice, setDialogNotice] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | JobStatus>('all')
  const [editing, setEditing] = useState<Job | 'new' | null>(null)
  const [editingCV, setEditingCV] = useState<CV | 'new' | null>(null)
  const [editingContact, setEditingContact] = useState<Contact | 'new' | null>(null)
  const [editingStar, setEditingStar] = useState<StarStory | 'new' | null>(null)
  const [viewingStar, setViewingStar] = useState<StarStory | null>(null)
  const [editingBlock, setEditingBlock] = useState<CVBlock | 'new' | null>(null)
  const [buildingCV, setBuildingCV] = useState(false)
  const [tailoringJob, setTailoringJob] = useState<Job | null>(null)
  const [googleConnected, setGoogleConnected] = useState(false)
  const [pendingSendHistory, setPendingSendHistory] = useState<ApplicationSend | null>(() => readPendingSend(session.user.id))
  const initialViewSet = useRef(false)

  function rememberPendingSend(record: ApplicationSend) {
    setPendingSendHistory(record)
    storePending(pendingSendKey(session.user.id), record)
  }

  function forgetPendingSend() {
    setPendingSendHistory(null)
    clearPending(pendingSendKey(session.user.id))
  }

  const loadWorkspace = useCallback(async () => {
    const loaded = await fetchWorkspace(session.user.id)

    if (loaded.jobs.error) setError(loaded.jobs.error.message)
    else setJobs((loaded.jobs.data ?? []) as Job[])

    if (loaded.cvs.error) setError(loaded.cvs.error.message)
    else setCVs((loaded.cvs.data ?? []) as CV[])

    if (loaded.sends.error) setError(loaded.sends.error.message)
    else setApplicationSends((loaded.sends.data ?? []) as ApplicationSend[])

    if (loaded.contacts.error) setError(loaded.contacts.error.message)
    else setContacts(loaded.contacts.data ?? [])

    if (loaded.stories.error) setError(loaded.stories.error.message)
    else setStarStories((loaded.stories.data ?? []) as StarStory[])

    if (loaded.preps.error) setError(loaded.preps.error.message)
    else setInterviewPreps((loaded.preps.data ?? []) as InterviewPrep[])

    if (loaded.stageEvents.error) setError(loaded.stageEvents.error.message)
    else setStageEvents(loaded.stageEvents.data ?? [])

    if (loaded.blocks.error) setError(loaded.blocks.error.message)
    else setCVBlocks((loaded.blocks.data ?? []) as CVBlock[])

    if (loaded.outreach.error) setError(loaded.outreach.error.message)
    else setOutreachEmails((loaded.outreach.data ?? []) as OutreachEmail[])

    if (loaded.replies.error) setError(loaded.replies.error.message)
    else setEmailReplies(loaded.replies.data ?? [])

    if (loaded.settings.error) {
      setError(loaded.settings.error.message)
      setSettings(defaultSettings(session.user.id))
      setSettingsPersisted(false)
    }
    else {
      const nextSettings = loaded.settings.data as UserSettings | null
      setSettings(nextSettings ?? defaultSettings(session.user.id))
      setSettingsPersisted(Boolean(nextSettings))
      if (!initialViewSet.current) {
        setView(nextSettings?.default_view ?? 'dashboard')
        initialViewSet.current = true
      }
    }
    setLoading(false)
  }, [session.user.id])

  const editingContactId = editingContact && editingContact !== 'new' ? editingContact.id : null
  const editingContactIdRef = useRef<string | null>(null)

  const loadContactHistory = useCallback(async (contactId: string) => {
    const { data, error: historyError } = await listInteractions(contactId)
    if (historyError) setError(historyError.message)
    else setContactHistory((data ?? []) as ContactInteraction[])
  }, [])

  useEffect(() => {
    editingContactIdRef.current = editingContactId
    if (!editingContactId) {
      setContactHistory([])
      return
    }
    void loadContactHistory(editingContactId)
  }, [editingContactId, loadContactHistory])

  const refreshNetworkingData = useCallback(() => {
    void loadWorkspace()
    const activeContactId = editingContactIdRef.current
    if (activeContactId) void loadContactHistory(activeContactId)
  }, [loadContactHistory, loadWorkspace])

  useEffect(() => {
    void loadWorkspace()
    let disposed = false
    let channel: RealtimeChannel | null = null

    async function subscribe() {
      const subscribed = await subscribeToWorkspace(session, {
        onChange: () => void loadWorkspace(),
        onNetworkingChange: refreshNetworkingData,
      })
      if (disposed) void unsubscribeFromWorkspace(subscribed)
      else channel = subscribed
    }

    void subscribe().catch(() => {
      if (!disposed) setError('Live synchronization could not connect. Your saved data is still available; reload to retry.')
    })
    return () => {
      disposed = true
      if (channel) void unsubscribeFromWorkspace(channel)
    }
  }, [loadWorkspace, refreshNetworkingData, session])

  useEffect(() => {
    setGoogleConnected(hasGoogleAccess(session.user.id, settings?.google_client_id))
  }, [session.user.id, settings?.google_client_id])

  // A dialog notice belongs to the record it was produced for.
  const editingJobId = editing && editing !== 'new' ? editing.id : null
  const editingOutreachId = editingOutreach && editingOutreach !== 'new' ? editingOutreach.id : null
  useEffect(() => {
    setDialogNotice('')
  }, [editingJobId, editingOutreachId])

  useEffect(() => {
    if (pendingSendHistory && applicationSends.some((send) => send.id === pendingSendHistory.id)) forgetPendingSend()
  }, [applicationSends, pendingSendHistory])

  useEffect(() => {
    if (!settings?.reminders_enabled || !('Notification' in window) || Notification.permission !== 'granted') return
    const reminderLeadMilliseconds = settings.reminder_lead_hours * 3_600_000

    function notifyOnce(key: string, title: string, body: string) {
      const now = Date.now()
      return (dueAtValue: string) => {
        const dueAt = new Date(dueAtValue).getTime()
        if (dueAt > now + reminderLeadMilliseconds || dueAt < now - 7 * 86_400_000) return
        if (localStorage.getItem(key)) return
        new Notification(title, { body })
        localStorage.setItem(key, '1')
      }
    }

    function showDueNotifications() {
      jobs.forEach((job) => {
        if (!job.next_action_at || !ACTIVE_STATUSES.includes(job.status)) return
        notifyOnce(
          `opportunity-desk-notified:${job.id}:${job.next_action_at}`,
          job.next_action || 'Application follow-up',
          `${job.role_title} at ${job.company} · ${relativeDueLabel(job.next_action_at)}`,
        )(job.next_action_at)
      })
      contacts.forEach((contact) => {
        if (!contact.next_action_at || contact.pipeline_stage === 'closed') return
        notifyOnce(
          `opportunity-desk-notified:contact:${contact.id}:${contact.next_action_at}`,
          contact.next_action || 'Networking follow-up',
          `${contact.name}${contact.company ? ` · ${contact.company}` : ''} · ${relativeDueLabel(contact.next_action_at)}`,
        )(contact.next_action_at)
      })
      outreachEmails.forEach((email) => {
        if (!email.follow_up_at || email.status !== 'sent' || email.reply_status === 'replied') return
        notifyOnce(
          `opportunity-desk-notified:outreach:${email.id}:${email.follow_up_at}`,
          'Outreach follow-up',
          `${email.company}${email.recipient_name ? ` · ${email.recipient_name}` : ''} · ${relativeDueLabel(email.follow_up_at)}`,
        )(email.follow_up_at)
      })
    }

    showDueNotifications()
    const timer = window.setInterval(showDueNotifications, 60_000)
    return () => window.clearInterval(timer)
  }, [contacts, jobs, outreachEmails, settings])

  const visibleJobs = useMemo(() => jobs.filter((job) => jobMatches(job, search, filter)), [filter, jobs, search])
  const reminders = useMemo(() => jobs
    .filter((job) => job.next_action_at && ACTIVE_STATUSES.includes(job.status))
    .sort((left, right) => new Date(left.next_action_at!).getTime() - new Date(right.next_action_at!).getTime()), [jobs])
  const outreachReminders = useMemo(() => dueOutreachFollowUps(outreachEmails), [outreachEmails])
  const contactReminders = useMemo(() => contacts
    .filter((contact) => contact.next_action_at && contact.pipeline_stage !== 'closed')
    .sort((left, right) => new Date(left.next_action_at!).getTime() - new Date(right.next_action_at!).getTime()), [contacts])

  const counts = useMemo(() => ({
    active: jobs.filter((job) => ACTIVE_STATUSES.includes(job.status)).length,
    interviews: jobs.filter((job) => ['phone_screen', 'interviewing', 'assessment', 'final_round'].includes(job.status)).length,
    offers: jobs.filter((job) => job.status === 'offer').length,
  }), [jobs])

  /**
   * Runs an optimistic-locked save and reports its outcome the same way for
   * every record: closed on success, kept open with a refreshed baseline when
   * another device changed it, kept open when it was deleted.
   */
  async function persistRecord<T extends VersionedRecord>(
    save: () => Promise<SaveResult<T>>,
    closeEditor: (record: T | null) => void,
    noun: string,
    savedNotice: string,
  ) {
    setBusy(true)
    setError('')
    setNotice('')
    const result = await save()
    if (result.kind === 'error') setError(result.message)
    else {
      if (result.kind === 'deleted') setError(`This ${noun} was deleted on another device. Your unsaved edits remain open.`)
      else if (result.kind === 'conflict') {
        closeEditor(result.record)
        setError(`This ${noun} changed on another device. Your edits remain open. Review them, then save again.`)
      }
      else {
        closeEditor(null)
        setNotice(savedNotice)
      }
      await loadWorkspace()
    }
    setBusy(false)
  }

  /** Deletes a record the user confirmed, at the version they were looking at. */
  async function removeRecord(options: {
    confirm: string
    run: () => PromiseLike<{ data: unknown; error: { message: string } | null }>
    conflict: string
    deleted: string | (() => Promise<string>)
  }) {
    if (!window.confirm(options.confirm)) return
    setBusy(true)
    setError('')
    setNotice('')
    const { data, error: deleteError } = await options.run()
    if (deleteError) setError(deleteError.message)
    else if (!data) setError(options.conflict)
    else setNotice(typeof options.deleted === 'string' ? options.deleted : await options.deleted())
    await loadWorkspace()
    setBusy(false)
  }

  async function saveJob(draft: JobDraft) {
    if (!editing) return
    await persistRecord(
      () => saveJobRecord(editing, draftToPayload(draft), session.user.id),
      setEditing,
      'application',
      'Application saved and synchronized.',
    )
  }

  async function saveAndOpenTailoring(draft: JobDraft) {
    if (!editing || editing === 'new') return
    if (!draft.company.trim() || !draft.role_title.trim()) {
      setError('Add the company and role title before opening the tailoring tool.')
      return
    }
    const recordBeingEdited = editing
    setBusy(true)
    setError('')
    setNotice('')
    const { data, error: updateError } = await updateJobReturningRow(recordBeingEdited, draftToPayload(draft))
    if (updateError) setError(updateError.message)
    else if (!data) {
      const { data: latest } = await readJobVersion(recordBeingEdited.id)
      if (latest) setEditing({ ...recordBeingEdited, version: latest.version })
      setError(latest ? 'This application changed on another device. Your edits remain open. Review them, then try again.' : 'This application was deleted on another device. Your edits remain open.')
      await loadWorkspace()
    }
    else {
      setEditing(null)
      setTailoringJob(data as Job)
      await loadWorkspace()
    }
    setBusy(false)
  }

  async function saveTailoredCV(sourceCV: CV, result: TailoringResult) {
    if (!tailoringJob) return
    const job = tailoringJob
    const cvId = crypto.randomUUID()
    const plainText = tailoredCVText(result, sourceCV.plain_text ?? '')
    setBusy(true)
    setError('')
    setNotice('')
    const { error: insertError } = await insertCVRow(session.user.id, cvId, {
      name: `${job.company} — ${job.role_title}`,
      target_role: job.role_title,
      notes: `AI-assisted draft based on ${sourceCV.name}. Review every claim before use.`,
      plain_text: plainText,
      tailored_company: job.company,
      storage_path: null,
      original_filename: null,
      mime_type: 'text/plain',
      size_bytes: new Blob([plainText]).size,
      data: {
        ai_tailoring: {
          model: result.model,
          generation_id: result.generation_id,
          job_id: job.id,
          source_cv_id: sourceCV.id,
          generated_at: new Date().toISOString(),
        },
      },
    })
    if (insertError) {
      setError(insertError.message)
      setBusy(false)
      return
    }

    const { data: linked, error: linkError } = await linkJobCV(job, cvId)
    if (linkError) setError(`The CV was saved, but could not be linked: ${linkError.message}`)
    else if (!linked) setError('The CV was saved, but this application changed on another device. Open it and link the new CV manually.')
    else {
      setTailoringJob(null)
      setNotice('Tailored CV saved, linked to the application, and synchronized.')
    }
    await loadWorkspace()
    setBusy(false)
  }

  async function useTailoredCoverLetter(result: TailoringResult) {
    if (!tailoringJob) return
    const job = tailoringJob
    setBusy(true)
    setError('')
    setNotice('')
    const { data, error: updateError } = await updateJobReturningRow(job, { email_body: result.cover_letter })
    if (updateError) setError(updateError.message)
    else if (!data) setError('This application changed on another device. Reload the tailoring tool and try again so no newer edits are overwritten.')
    else {
      setTailoringJob(data as Job)
      setNotice('Cover letter saved in the application email draft and synchronized.')
    }
    await loadWorkspace()
    setBusy(false)
  }

  async function changeStatus(job: Job, status: JobStatus) {
    if (status === job.status) return
    setBusy(true)
    setError('')
    setNotice('')
    const { data, error: updateError } = await updateJobLocked(job, { status })
    if (updateError) setError(updateError.message)
    else if (!data) setError('This application changed on another device. The latest version has been loaded; please try the move again.')
    else setNotice(`${job.role_title} at ${job.company} moved to ${STATUS_LABELS[status]}.`)
    await loadWorkspace()
    setBusy(false)
  }

  async function deleteJob(job: Job) {
    if (pendingSendHistory?.job_id === job.id) {
      setError('Synchronize the pending Gmail send history before deleting this application.')
      return
    }
    if (!window.confirm(`Delete ${job.role_title} at ${job.company}? This cannot be undone.`)) return
    setBusy(true)
    const { error: deleteError } = await deleteJobRow(job)
    if (deleteError) setError(deleteError.message)
    else {
      setNotice('Application deleted.')
      await loadWorkspace()
    }
    setBusy(false)
  }

  async function saveContact(draft: ContactDraft) {
    if (!editingContact) return
    await persistRecord(
      () => saveContactRecord(editingContact, contactDraftToPayload(draft), session.user.id),
      setEditingContact,
      'contact',
      'Contact saved and synchronized.',
    )
  }

  function deleteContact(contact: Contact) {
    return removeRecord({
      confirm: `Delete ${contact.name}? Their logged interactions are removed too. This cannot be undone.`,
      run: () => deleteContactRow(contact),
      conflict: 'This contact changed or was deleted on another device. The latest list has been loaded; please review it and try again.',
      deleted: 'Contact deleted.',
    })
  }

  async function changeContactStage(contact: Contact, stage: ContactStage) {
    if (stage === contact.pipeline_stage) return
    setBusy(true)
    setError('')
    const { data, error: updateError } = await updateContactStage(contact, stage)
    if (updateError) setError(updateError.message)
    else if (!data) setError('This contact changed on another device. The latest version has been loaded; please try the move again.')
    await loadWorkspace()
    setBusy(false)
  }

  async function logInteraction(draft: InteractionDraft): Promise<boolean> {
    if (!editingContact || editingContact === 'new') return false
    const contactId = editingContact.id
    setBusy(true)
    setError('')
    setNotice('')
    const { error: insertError } = await insertInteraction(session.user.id, interactionDraftToPayload(draft, contactId))
    const logged = !insertError
    if (insertError) setError(`${insertError.message} Your interaction note is kept so you can retry.`)
    else {
      setNotice('Interaction logged and synchronized.')
      await loadContactHistory(contactId)
    }
    await loadWorkspace()
    setBusy(false)
    return logged
  }

  async function deleteInteraction(interaction: ContactInteraction) {
    if (!window.confirm('Remove this interaction note? This cannot be undone.')) return
    setBusy(true)
    setError('')
    const { data, error: deleteError } = await deleteInteractionRow(interaction)
    if (deleteError) setError(deleteError.message)
    else if (!data) setError('This interaction changed or was removed on another device. The latest history has been loaded.')
    await loadContactHistory(interaction.contact_id)
    await loadWorkspace()
    setBusy(false)
  }

  async function saveStarStory(draft: StarStoryDraft) {
    if (!editingStar) return
    await persistRecord(
      () => saveStarStoryRecord(editingStar, starStoryDraftToPayload(draft), session.user.id),
      setEditingStar,
      'story',
      'STAR story saved and synchronized.',
    )
  }

  function rememberPendingOutreach(record: PendingOutreachRecord) {
    setPendingOutreach(record)
    storePending(pendingOutreachKey(session.user.id), record)
  }

  function forgetPendingOutreach() {
    setPendingOutreach(null)
    clearPending(pendingOutreachKey(session.user.id))
  }

  /** Marks an outreach row as sent. Used by the send path and by its retry. */
  async function recordOutreachSent(record: PendingOutreachRecord) {
    const { data, error: updateError } = await markOutreachSent(record.outreach_id, record)
    if (updateError) throw updateError
    if (!data) {
      // Already recorded, by an earlier retry or another device.
      const { data: existing, error: lookupError } = await readOutreachMessageId(record.outreach_id)
      if (lookupError) throw lookupError
      if (!existing || existing.provider_message_id !== record.provider_message_id) {
        throw new Error('The outreach record could not be updated to match the sent message.')
      }
    }
  }

  async function saveOutreachDraft(draft: OutreachDraft) {
    if (!editingOutreach) return
    await persistRecord(
      () => saveOutreachRecord(editingOutreach, outreachDraftToPayload(draft), session.user.id),
      setEditingOutreach,
      'message',
      'Outreach draft saved and synchronized.',
    )
  }

  /**
   * Persists the draft, sends it through Gmail, then records the result. The
   * row always exists before Gmail is called, so a failure after sending can
   * be finished by updating that row rather than by sending a second message.
   */
  async function sendOutreach(draft: OutreachDraft) {
    if (!editingOutreach) return
    if (pendingOutreach) {
      setError('Finish recording the previous sent message before sending another. Retrying the record does not resend it.')
      return
    }
    const recordBeingEdited = editingOutreach
    setBusy(true)
    setError('')
    setNotice('')
    const payload = outreachDraftToPayload(draft)
    // Tracks whether the attempt was committed, which decides whether a
    // failure leaves the outcome genuinely unknown.
    let inFlight = false

    try {
      const saved = await persistOutreachForSend(recordBeingEdited, payload, session.user.id)
      if (saved.error) throw saved.error
      if (!saved.data) throw new Error('This message changed on another device. Reload it, review the text, then send again.')
      const outreachId = saved.data.id as string
      const savedVersion = saved.data.version as number

      const cv = payload.cv_id ? cvs.find((candidate) => candidate.id === payload.cv_id) : undefined
      if (payload.cv_id && !cv) throw new Error('The selected CV is no longer available. Choose another before sending.')

      // Everything that can fail without delivering anything happens first, so
      // the window in which the outcome is unknowable is only the Gmail call.
      const token = await requestGoogleAccess(session.user.id, googleClientId())
      setGoogleConnected(true)
      const attachment = cv ? await cvEmailAttachment(cv) : null
      const raw = buildRawEmail(payload.recipient_email, payload.subject, payload.body, attachment)

      // The attempt is committed before Gmail is called. If the response is
      // lost the row stays in `sending`, which freezes its content on every
      // device and refuses a second send until the outcome is recorded.
      const attemptedAt = new Date().toISOString()
      const { data: claimed, error: claimError } = await claimOutreachForSending(outreachId, savedVersion, attemptedAt)
      if (claimError) throw claimError
      if (!claimed) throw new Error('This message changed, or is already being sent, on another device. Reload it, review the text, then send again.')
      inFlight = true

      let gmailMessage: { id: string; threadId?: string }
      try {
        gmailMessage = await sendGmailMessage(token, raw)
      }
      catch (sendError) {
        if (isTerminalClientError(sendError)) {
          // Gmail rejected the request outright, so nothing was delivered and
          // the message can safely go back to being an editable draft. A
          // server-side failure is deliberately excluded: Gmail can fail after
          // accepting a message, and reverting would invite a duplicate.
          await releaseOutreachClaim(outreachId)
          inFlight = false
        }
        throw sendError
      }

      const record: PendingOutreachRecord = {
        outreach_id: outreachId,
        provider_message_id: gmailMessage.id,
        provider_thread_id: gmailMessage.threadId ?? null,
        attachment_filename: attachment?.filename ?? null,
        sent_at: new Date().toISOString(),
      }
      rememberPendingOutreach(record)
      try {
        await recordOutreachSent(record)
        forgetPendingOutreach()
        setEditingOutreach(null)
        setNotice(`Email sent to ${payload.recipient_email} and saved exactly as delivered.`)
      }
      catch {
        setError('Gmail sent the email, but its record could not be updated. Use “Retry record sync”; it will not send the message again.')
      }
      await loadWorkspace()
    }
    catch (caught) {
      setGoogleConnected(hasGoogleAccess(session.user.id, settings?.google_client_id))
      const message = caught instanceof Error ? caught.message : 'The outreach email could not be sent.'
      setError(isGoogleRefusal(caught) || !inFlight
        ? message
        : `${message} Gmail may still have delivered this message, so it is held with an unknown outcome. Check your Sent folder and record the result rather than sending again.`)
      await loadWorkspace()
    }
    finally {
      setBusy(false)
    }
  }

  /**
   * Resolves a message whose Gmail response was lost, on the user's own word.
   * `reconcileOutreachAttempt` can look in Sent mail instead; this manual path
   * remains for when that permission is not granted or the attempt is old.
   */
  async function resolveOutreachAttemptOutcome(email: OutreachEmail, delivered: boolean) {
    const question = delivered
      ? `Confirm the email to ${email.recipient_email} was delivered? It will be recorded as sent, without a Gmail message id.`
      : `Confirm the email to ${email.recipient_email} was NOT delivered? It returns to a draft you can edit and send. Sending again when it did arrive would deliver a duplicate.`
    if (!window.confirm(question)) return
    setBusy(true)
    setError('')
    setNotice('')
    const payload = delivered
      ? {
          status: 'sent' as const,
          sent_at: email.send_attempted_at ?? new Date().toISOString(),
          data: { ...email.data, delivery_confirmed_manually: true },
        }
      : { status: 'draft' as const, send_attempt_id: null, send_attempted_at: null }
    const { data, error: updateError } = await resolveOutreachAttempt(email.id, payload)
    if (updateError) setError(updateError.message)
    else if (!data) setError('This message was already resolved on another device. The latest version has been loaded.')
    else {
      setEditingOutreach(null)
      setNotice(delivered ? 'Recorded as sent. Its content stays exactly as written.' : 'Returned to draft. Review it before sending again.')
    }
    await loadWorkspace()
    setBusy(false)
  }

  async function retryOutreachSync() {
    if (!pendingOutreach) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await recordOutreachSent(pendingOutreach)
      forgetPendingOutreach()
      setEditingOutreach(null)
      setNotice('The sent email is now recorded. No second message was sent.')
      await loadWorkspace()
    }
    catch (caught) {
      setError(`The email was already sent, but its record still could not be updated. Retry when the connection is stable. ${caught instanceof Error ? caught.message : ''}`.trim())
    }
    finally {
      setBusy(false)
    }
  }

  async function updateOutcome(email: OutreachEmail, outcome: OutreachOutcome) {
    setBusy(true)
    setError('')
    setNotice('')
    const { data, error: updateError } = await updateOutreachOutcome(email, {
      reply_status: outcome.reply_status,
      replied_at: outcome.reply_status === 'replied' ? (email.replied_at ?? new Date().toISOString()) : null,
      follow_up_at: outcome.follow_up_at ? new Date(outcome.follow_up_at).toISOString() : null,
      notes: outcome.notes.trim() || null,
    })
    if (updateError) setError(updateError.message)
    else if (!data) setError('This message changed on another device. The latest version has been loaded; review it and save again.')
    else {
      setEditingOutreach(null)
      setNotice('Outreach outcome saved and synchronized.')
    }
    await loadWorkspace()
    setBusy(false)
  }

  /** Starts a Gmail read: clears messages and asks for a token. */
  async function beginGmailRead() {
    setBusy(true)
    setError('')
    setNotice('')
    setDialogNotice('')
    // A cached token without header access is not reused, so a check after
    // declining that permission asks Google again rather than failing with 403.
    const token = await requestGoogleAccess(session.user.id, googleClientId(), { needs: [GMAIL_METADATA_SCOPE] })
    setGoogleConnected(true)
    return token
  }

  async function failGmailRead(caught: unknown) {
    // Gmail refusing a read means this token cannot do it; ask again next time.
    if (isGoogleRefusal(caught) && caught.status === 403) forgetGoogleScope(GMAIL_METADATA_SCOPE)
    setGoogleConnected(hasGoogleAccess(session.user.id, settings?.google_client_id))
    setError(gmailReadError(caught))
    await loadWorkspace()
  }

  /**
   * Asks Gmail whether one outreach thread has been answered. Per thread and
   * user-triggered, never a background sweep of the mailbox. Only a person
   * answering marks the message replied; automatic replies and bounces are
   * recorded and reported but leave the follow-up in place.
   */
  async function checkOutreachReply(email: OutreachEmail) {
    if (!email.provider_thread_id) {
      setError('This message has no Gmail thread recorded, so its replies cannot be checked.')
      return
    }
    try {
      const token = await beginGmailRead()
      const thread = await fetchGmailThread(token, email.provider_thread_id)
      if (!thread) {
        setDialogNotice('That Gmail thread no longer exists in your mailbox.')
        await loadWorkspace()
        return
      }
      const replies = findThreadReplies(thread.messages ?? [], email.sent_at ?? email.created_at)
      if (replies.length) {
        const { error: recordError } = await recordEmailReplies(session.user.id, 'outreach', email.id, replies)
        if (recordError) throw recordError
      }
      const summary = summarizeReplies(replies)
      const note = automatedNote(summary)
      const reply = summary.firstReply

      if (!reply) {
        if (summary.bounces) {
          setError(`Gmail reported a delivery failure on this thread, so the message probably never arrived. Check the address before following up.${summary.autoReplies ? ' An automatic reply was also found.' : ''}`)
        }
        else {
          setDialogNotice(`No reply yet. Checked ${formatDateTime(new Date().toISOString())}.${note}`)
        }
      }
      else {
        const found = `Reply from ${reply.from_address} on ${formatDateTime(reply.received_at)}.`
        if (email.reply_status === 'replied') setDialogNotice(`${found} It was already marked as replied.${note}`)
        else {
          const { data: updated, error: markError } = await markOutreachReplied(email, reply.received_at)
          if (markError) setError(`${found} Marking it as replied failed: ${markError.message}`)
          else if (!updated) setError(`${found} It changed on another device, so it was not marked as replied. Reopen it and set the reply yourself.`)
          else {
            // The open editor holds a snapshot and this write moved the row
            // on; replacing it keeps the version current for the next save.
            setEditingOutreach(updated as OutreachEmail)
            setDialogNotice(`${found} Marked as replied, so it no longer appears in follow-ups.${note}`)
          }
        }
      }
      await loadWorkspace()
    }
    catch (caught) {
      await failGmailRead(caught)
    }
    finally {
      setBusy(false)
    }
  }

  /**
   * Looks for a message whose send response was lost among recent Sent mail,
   * so an unknown outcome need not be settled by hand. A match is confirmed
   * by the user before it is recorded, because recording freezes the row.
   */
  async function reconcileOutreachAttempt(email: OutreachEmail) {
    if (!email.send_attempted_at) {
      setError('This message has no recorded send attempt to look for.')
      return
    }
    try {
      const token = await beginGmailRead()
      const match = matchLostSend(await fetchRecentSentMessages(token), {
        recipient: email.recipient_email,
        subject: email.subject,
        attemptedAtIso: email.send_attempted_at,
      })
      if (!match) {
        setDialogNotice('No matching message in your recent Sent mail around the time of the attempt, so it probably never went. Return it to draft if you agree, or check Gmail yourself if the attempt was long ago.')
        await loadWorkspace()
        return
      }
      const sentAt = match.internalDate ? new Date(Number(match.internalDate)) : null
      const sentAtIso = sentAt && Number.isFinite(sentAt.getTime()) ? sentAt.toISOString() : email.send_attempted_at
      if (!window.confirm(`Found a message to ${email.recipient_email} with this subject, sent ${formatDateTime(sentAtIso)}. Record this attempt as delivered? Its content can no longer be changed afterwards.`)) return
      await recordOutreachSent({
        outreach_id: email.id,
        provider_message_id: match.id,
        provider_thread_id: match.threadId ?? null,
        attachment_filename: email.attachment_filename,
        sent_at: sentAtIso,
      })
      if (pendingOutreach?.outreach_id === email.id) forgetPendingOutreach()
      setEditingOutreach(null)
      setNotice('Found in your Sent mail and recorded as sent, with its Gmail thread attached so replies can be checked.')
      await loadWorkspace()
    }
    catch (caught) {
      await failGmailRead(caught)
    }
    finally {
      setBusy(false)
    }
  }

  async function deleteOutreach(email: OutreachEmail) {
    if (pendingOutreach?.outreach_id === email.id) {
      setError('Finish recording this sent message before deleting it.')
      return
    }
    // While the outcome is unknown this row is the only thing preventing the
    // same message being written and sent a second time.
    if (email.status === 'sending') {
      setError('This message may already have been delivered. Record whether it was sent, or return it to draft, before deleting it.')
      return
    }
    await removeRecord({
      confirm: email.status === 'sent'
        ? `Delete the record of the email sent to ${email.recipient_email}? The message itself stays in Gmail, but this copy of what you sent cannot be recovered.`
        : `Delete this draft to ${email.company}? This cannot be undone.`,
      run: () => deleteOutreachRow(email),
      conflict: 'This message changed or was deleted on another device. The latest list has been loaded.',
      deleted: 'Outreach record deleted.',
    })
  }

  async function saveCVBlock(draft: CVBlockDraft) {
    if (!editingBlock) return
    await persistRecord(
      () => saveCVBlockRecord(editingBlock, blockDraftToPayload(draft), session.user.id),
      setEditingBlock,
      'block',
      'CV block saved and synchronized.',
    )
  }

  function deleteCVBlock(block: CVBlock) {
    return removeRecord({
      confirm: `Delete the block “${block.title}”? This cannot be undone. CVs already built from it keep their text.`,
      run: () => deleteCVBlockRow(block),
      conflict: 'This block changed or was deleted on another device. The latest list has been loaded.',
      deleted: 'CV block deleted.',
    })
  }

  async function saveBuiltCV(built: BuiltCV) {
    const cvId = crypto.randomUUID()
    setBusy(true)
    setError('')
    setNotice('')
    const { error: insertError } = await insertCVRow(session.user.id, cvId, {
      name: built.name,
      target_role: built.job?.role_title ?? null,
      notes: 'Assembled in the CV builder from saved blocks and STAR stories. Review before sending.',
      plain_text: built.text,
      tailored_company: built.job?.company ?? null,
      storage_path: null,
      original_filename: null,
      mime_type: 'text/plain',
      size_bytes: new Blob([built.text]).size,
      data: {
        built_from_blocks: {
          job_id: built.job?.id ?? null,
          built_at: new Date().toISOString(),
        },
      },
    })
    if (insertError) {
      setError(insertError.message)
      setBusy(false)
      return
    }

    // The CV now exists. Every path below closes the builder so that a failed
    // link cannot be retried as a whole save, which would insert a second
    // identical CV under a fresh id. Linking is recoverable from the
    // application's own "CV used" selector.
    setBuildingCV(false)

    if (!built.job || !built.linkToJob) {
      setNotice('CV built and saved to your library.')
      await loadWorkspace()
      setBusy(false)
      return
    }

    const { data: linked, error: linkError } = await linkJobCV(built.job, cvId)

    const linkTarget = `${built.job.role_title} at ${built.job.company}`
    if (linkError) setError(`“${built.name}” was saved to your CV library, but linking it to ${linkTarget} failed: ${linkError.message} Open that application and choose it under “CV used”. Do not build it again.`)
    else if (!linked) setError(`“${built.name}” was saved to your CV library, but ${linkTarget} changed on another device, so it was not linked. Open that application and choose the CV under “CV used”. Do not build it again.`)
    else setNotice('CV built, saved to your library, and linked to the application.')

    await loadWorkspace()
    setBusy(false)
  }

  function deleteStarStory(story: StarStory) {
    return removeRecord({
      confirm: `Delete “${story.title}”? This cannot be undone.`,
      run: () => deleteStarStoryRow(story),
      conflict: 'This story changed or was deleted on another device. The latest library has been loaded.',
      deleted: 'STAR story deleted.',
    })
  }

  // Returns the next optimistic-lock baseline for the preparation panel: the
  // saved row on success, the latest row after a conflict (so a reviewed
  // second save can proceed), { prep: null } when the record no longer exists,
  // or null on failures that should keep the previous baseline.
  async function saveInterviewPrep(job: Job, existingPrep: InterviewPrep | null, draft: InterviewPrepDraft): Promise<InterviewPrepSaveResult> {
    setBusy(true)
    setError('')
    setNotice('')
    let result: InterviewPrepSaveResult = null
    const payload = prepDraftToPayload(draft)
    if (existingPrep) {
      const { data, error: updateError } = await updateInterviewPrep(existingPrep, payload)
      if (updateError) setError(updateError.message)
      else if (!data) {
        const { data: latest, error: latestError } = await readInterviewPrep(existingPrep.id)
        if (latestError) setError(latestError.message)
        else if (!latest) {
          result = { prep: null }
          setError('This preparation was removed on another device. Your edits remain open; saving again will recreate it.')
        } else {
          result = { prep: latest as InterviewPrep }
          setError('This preparation changed on another device. Your edits remain open. Review them, then save again.')
        }
      }
      else {
        result = { prep: data as InterviewPrep }
        setNotice('Interview preparation saved and synchronized.')
      }
    } else {
      const { data, error: insertError } = await insertInterviewPrep(session.user.id, job.id, payload)
      if (insertError?.code === '23505') {
        const { data: latest, error: latestError } = await readInterviewPrepForJob(job.id)
        if (latestError) setError(latestError.message)
        else {
          result = { prep: (latest as InterviewPrep | null) ?? null }
          setError('Preparation for this interview was started on another device. Your edits remain open. Review them, then save again.')
        }
      }
      else if (insertError) setError(insertError.message)
      else if (!data) setError('The preparation could not be saved. Please try again.')
      else {
        result = { prep: data as InterviewPrep }
        setNotice('Interview preparation saved and synchronized.')
      }
    }
    await loadWorkspace()
    setBusy(false)
    return result
  }

  async function saveSettings(draft: SettingsDraft) {
    setBusy(true)
    setError('')
    const clientId = draft.google_client_id.trim()
    if (clientId && !validGoogleClientId(clientId)) {
      setError('The Google client ID must end in .apps.googleusercontent.com and match the ID from Google Cloud.')
      setBusy(false)
      return
    }
    const payload = { ...draft, google_client_id: clientId || null }
    const result = settingsPersisted && settings
      ? await updateSettings(session.user.id, settings.version, payload)
      : await upsertSettings(session.user.id, payload)

    if (result.error) setError(result.error.message)
    else if (!result.data) setError('Your settings changed on another device. The latest version has been loaded; review it and save again.')
    else {
      setSettings(result.data as UserSettings)
      setSettingsPersisted(true)
      setNotice('Settings saved and synchronized.')
    }
    await loadWorkspace()
    setBusy(false)
  }

  async function connectGoogle(clientId: string) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      // Asking for header access too means reconnecting after declining it
      // prompts again instead of returning the cached token.
      await requestGoogleAccess(session.user.id, clientId, { needs: [GMAIL_METADATA_SCOPE] })
      setGoogleConnected(true)
      setNotice('Google is connected for this browser session. Save Settings to synchronize the public client ID.')
    }
    catch (caught) {
      if (caught instanceof GoogleScopeError) {
        setGoogleConnected(true)
        setNotice('Google is connected for Calendar and sending. Reply checking was not allowed; select Connect Google again to allow it.')
      }
      else {
        setGoogleConnected(false)
        setError(caught instanceof Error ? caught.message : 'Google could not be connected.')
      }
    }
    finally {
      setBusy(false)
    }
  }

  function googleClientId() {
    const clientId = settings?.google_client_id?.trim() ?? ''
    if (!clientId) throw new Error('Add and save your Google OAuth client ID in Settings first.')
    return clientId
  }

  async function addToGoogleCalendar(draft: JobDraft) {
    if (!editing || editing === 'new') return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const token = await requestGoogleAccess(session.user.id, googleClientId())
      setGoogleConnected(true)
      await createCalendarEvent(token, draft, settings?.timezone || currentTimezone())
      setNotice('The follow-up was added to your primary Google Calendar. Save the application separately if you changed its fields.')
    }
    catch (caught) {
      setGoogleConnected(hasGoogleAccess(session.user.id, settings?.google_client_id))
      setError(caught instanceof Error ? caught.message : 'The calendar event could not be created.')
    }
    finally {
      setBusy(false)
    }
  }

  /**
   * Checks every Gmail thread an application was sent on. Replies are shown,
   * but the application stage is never changed automatically.
   */
  async function checkJobReplies(job: Job) {
    const threads = checkableSends(applicationSends.filter((send) => send.job_id === job.id))
    if (!threads.length) {
      setError('No Gmail thread was recorded for this application, so replies cannot be checked.')
      return
    }
    try {
      const token = await beginGmailRead()
      const found: ReturnType<typeof findThreadReplies> = []
      for (const { send, threadId } of threads) {
        const thread = await fetchGmailThread(token, threadId)
        if (!thread) continue
        const replies = findThreadReplies(thread.messages ?? [], send.sent_at)
        if (!replies.length) continue
        const { error: recordError } = await recordEmailReplies(session.user.id, 'job', job.id, replies)
        if (recordError) throw recordError
        found.push(...replies)
      }
      const summary = summarizeReplies(found)
      const where = threads.length === 1 ? 'that thread' : 'those threads'
      if (summary.replies) {
        setDialogNotice(`${summary.replies} repl${summary.replies === 1 ? 'y' : 'ies'} found. Review them and move the application on yourself if it has progressed.${automatedNote(summary)}`)
      }
      else if (summary.bounces) {
        setError(`Gmail reported a delivery failure on ${where}, so the application probably never arrived. Check the address before following up.`)
      }
      else setDialogNotice(`No replies on ${where} yet.${automatedNote(summary)}`)
      await loadWorkspace()
    }
    catch (caught) {
      await failGmailRead(caught)
    }
    finally {
      setBusy(false)
    }
  }

  async function recordFailedSend(job: Job, draft: JobDraft, cv: CV | undefined, message: string) {
    await insertFailedSend({
      user_id: session.user.id,
      job_id: job.id,
      cv_id: cv?.id ?? null,
      recipient: draft.email_recipient.trim(),
      subject: draft.email_subject.trim(),
      provider: 'gmail',
      status: 'failed',
      details: { error: message.slice(0, 300), cv_name: cv?.name ?? null },
    })
  }

  async function synchronizeSuccessfulSend(record: ApplicationSend) {
    const { error: historyError } = await insertApplicationSend(record)
    if (!historyError) return
    if (historyError.code !== '23505') throw historyError

    const { data: existing, error: lookupError } = await readApplicationSend(record.id, session.user.id)
    if (lookupError) throw lookupError
    if (!existing || existing.provider_message_id !== record.provider_message_id) throw historyError
  }

  async function retrySendHistory() {
    if (!pendingSendHistory) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await synchronizeSuccessfulSend(pendingSendHistory)
      forgetPendingSend()
      setNotice('The existing Gmail message is now recorded in synchronized send history. No second email was sent.')
      await loadWorkspace()
    }
    catch (caught) {
      setError(`The email was already sent, but its history still could not synchronize. Retry again when the connection is stable. ${caught instanceof Error ? caught.message : ''}`.trim())
    }
    finally {
      setBusy(false)
    }
  }

  async function sendApplicationEmail(draft: JobDraft) {
    if (!editing || editing === 'new') return
    if (pendingSendHistory) {
      setError('Synchronize the previous Gmail send history before sending another email. Retrying history will not send a second message.')
      return
    }
    const job = editing
    const recipient = draft.email_recipient.trim()
    const subject = draft.email_subject.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      setError('Enter a valid email recipient before sending.')
      return
    }
    if (!subject) {
      setError('Enter an email subject before sending.')
      return
    }
    const cv = draft.cv_id ? cvs.find((candidate) => candidate.id === draft.cv_id) : undefined
    if (draft.cv_id && !cv) {
      setError('The selected CV is no longer available. Reload the application and choose another CV.')
      return
    }
    const attachmentDescription = cv ? ` with “${cv.name}” attached` : ' without a CV attachment'
    if (!window.confirm(`Send this email to ${recipient}${attachmentDescription}? It will be sent from the Google account you authorize.`)) return

    setBusy(true)
    setError('')
    setNotice('')
    try {
      const token = await requestGoogleAccess(session.user.id, googleClientId())
      setGoogleConnected(true)
      const attachment = cv ? await cvEmailAttachment(cv) : null
      let gmailMessage: { id: string; threadId?: string }
      try {
        gmailMessage = await sendGmailMessage(token, buildRawEmail(recipient, subject, draft.email_body, attachment))
      }
      catch (sendError) {
        const message = sendError instanceof Error ? sendError.message : 'Gmail could not send the message.'
        await recordFailedSend(job, draft, cv, message)
        throw sendError
      }

      const historyRecord: ApplicationSend = {
        id: crypto.randomUUID(),
        user_id: session.user.id,
        job_id: job.id,
        cv_id: cv?.id ?? null,
        sent_at: new Date().toISOString(),
        recipient,
        subject,
        provider: 'gmail',
        provider_message_id: gmailMessage.id,
        status: 'sent',
        details: {
          thread_id: gmailMessage.threadId ?? null,
          cv_name: cv?.name ?? null,
          attachment_filename: attachment?.filename ?? null,
        },
      }
      rememberPendingSend(historyRecord)
      let historySynchronized = false
      try {
        await synchronizeSuccessfulSend(historyRecord)
        forgetPendingSend()
        historySynchronized = true
      }
      catch {
        // Keep the exact Gmail message ID in the retry queue; never resend the email.
      }

      const sentDraft: JobDraft = {
        ...draft,
        status: draft.status === 'saved' ? 'applied' : draft.status,
        applied_at: draft.applied_at || localDateInput(),
        email_recipient: recipient,
        email_subject: subject,
      }
      const { data: updatedJob, error: updateError } = await updateJobVersioned(job, draftToPayload(sentDraft))

      const warnings: string[] = []
      if (!historySynchronized) warnings.push('send history is waiting for you to retry synchronization')
      if (updateError) warnings.push('the application record could not be updated')
      else if (!updatedJob) warnings.push('the application changed on another device and was not overwritten')
      setEditing(null)
      setNotice(`Email sent through Gmail${warnings.length ? `, but ${warnings.join(' and ')}` : ' and recorded in send history'}.`)
      await loadWorkspace()
    }
    catch (caught) {
      setGoogleConnected(hasGoogleAccess(session.user.id, settings?.google_client_id))
      setError(caught instanceof Error ? caught.message : 'The application email could not be sent.')
      await loadWorkspace()
    }
    finally {
      setBusy(false)
    }
  }

  function exportJson() {
    const backup = { opportunityDeskVersion: 1, exportedAt: new Date().toISOString(), jobs }
    downloadText(`opportunity-desk-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backup, null, 2), 'application/json')
  }

  function exportCsv() {
    downloadText(`opportunity-desk-${new Date().toISOString().slice(0, 10)}.csv`, jobsToCsv(jobs), 'text/csv;charset=utf-8')
  }

  async function importJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const parsed = parseBackup(await file.text())
      const importDescription = parsed.isLegacyBackup ? 'The older backup will be converted and added as new synchronized records.' : 'Matching records will be updated.'
      if (!window.confirm(`Import ${parsed.jobs.length} applications? ${importDescription}`)) return

      const rows = backupRows(parsed, session.user.id, cvs)
      const { error: importError } = await importJobRows(rows, parsed.isLegacyBackup)
      if (importError) throw importError
      setNotice(`${rows.length} applications imported and synchronized.`)
      await loadWorkspace()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The backup could not be imported.')
    } finally {
      setBusy(false)
    }
  }

  async function saveCV(draft: CVDraft, file: File | null) {
    if (!editingCV) return
    const recordBeingEdited = editingCV
    const cvId = recordBeingEdited === 'new' ? crypto.randomUUID() : recordBeingEdited.id
    let uploadedPath: string | null = null
    let uploadCompleted = false
    setBusy(true)
    setError('')
    setNotice('')

    try {
      let plainText = draft.plain_text.trim() || null
      let filePayload: Pick<CV, 'storage_path' | 'original_filename' | 'mime_type' | 'size_bytes'> | Record<string, never> = {}

      if (file) {
        const { extension, mimeType } = validateCVFile(file)
        if (extension === 'txt' && !plainText) plainText = (await file.text()).trim() || null
        uploadedPath = `${session.user.id}/${cvId}/${crypto.randomUUID()}-${safeStorageFilename(file.name)}`
        const { error: uploadError } = await uploadCVFile(uploadedPath, file, mimeType)
        if (uploadError) throw uploadError
        uploadCompleted = true
        filePayload = {
          storage_path: uploadedPath,
          original_filename: file.name,
          mime_type: mimeType,
          size_bytes: file.size,
        }
      }

      const payload = {
        name: draft.name.trim(),
        target_role: draft.target_role.trim() || null,
        notes: draft.notes.trim() || null,
        plain_text: plainText,
        tailored_company: draft.tailored_company.trim() || null,
        ...filePayload,
      }
      const result = recordBeingEdited === 'new'
        ? await insertCVReturningVersion(session.user.id, cvId, payload)
        : await updateCVLocked(recordBeingEdited, payload)

      if (result.error) throw result.error
      if (!result.data && recordBeingEdited !== 'new') {
        if (uploadedPath && uploadCompleted) {
          await removeCVFile(uploadedPath)
          uploadedPath = null
          uploadCompleted = false
        }
        const { data: latest, error: latestError } = await readCVVersion(recordBeingEdited.id)
        if (latestError) throw latestError
        if (!latest) setError('This CV was deleted on another device. Your unsaved edits remain open.')
        else {
          setEditingCV({ ...recordBeingEdited, version: latest.version })
          setError('This CV changed on another device. Your edits remain open. Review them, then save again.')
        }
        await loadWorkspace()
        return
      }

      let cleanupWarning = ''
      if (recordBeingEdited !== 'new' && uploadedPath && recordBeingEdited.storage_path && recordBeingEdited.storage_path !== uploadedPath) {
        const { error: cleanupError } = await removeCVFile(recordBeingEdited.storage_path)
        if (cleanupError) cleanupWarning = ' The older file could not be removed automatically.'
      }
      uploadedPath = null
      uploadCompleted = false
      setEditingCV(null)
      setNotice(`CV saved and synchronized.${cleanupWarning}`)
      await loadWorkspace()
    } catch (caught) {
      if (uploadedPath && uploadCompleted) await removeCVFile(uploadedPath)
      setError(caught instanceof Error ? caught.message : 'The CV could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  async function downloadCV(cv: CV) {
    if (!cv.storage_path) {
      setError('This is a text-only CV and has no file to download.')
      return
    }
    setBusy(true)
    setError('')
    const { data, error: downloadError } = await downloadCVFile(cv.storage_path)
    if (downloadError) setError(downloadError.message)
    else {
      const url = URL.createObjectURL(data)
      const link = document.createElement('a')
      link.href = url
      link.download = cv.original_filename || `${safeStorageFilename(cv.name)}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice('CV download started.')
    }
    setBusy(false)
  }

  async function changeJobCV(job: Job, cvId: string | null) {
    if (cvId === job.cv_id) return
    if (cvId && !cvs.some((cv) => cv.id === cvId)) {
      setError('That CV is no longer available. The latest library has been loaded.')
      await loadWorkspace()
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    const { data, error: updateError } = await linkJobCV(job, cvId)
    if (updateError) setError(updateError.message)
    else if (!data) setError('This application changed on another device. The latest version has been loaded; please link the CV again.')
    else setNotice(cvId ? 'CV linked to the application and synchronized.' : 'CV link removed from the application.')
    await loadWorkspace()
    setBusy(false)
  }

  async function saveSearchResult(result: JobSearchResult) {
    const alreadySaved = jobs.some((job) =>
      (job.source === result.sourceLabel && job.external_job_id === result.externalId)
      || job.job_url === result.url,
    )
    if (alreadySaved) {
      setNotice('This vacancy is already saved in your tracker.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    const payload = draftToPayload({
      ...EMPTY_JOB,
      company: result.company,
      role_title: result.title,
      status: 'saved',
      work_mode: result.remote ? 'remote' : 'unspecified',
      location: result.location,
      job_url: result.url,
      source: result.sourceLabel,
      salary_text: result.salary,
      next_action: 'Review listing and decide whether to apply',
      job_description: result.description,
      external_job_id: result.externalId,
    })
    const { data, error: insertError } = await insertJobRow(session.user.id, payload)

    if (insertError?.code === '23505') setNotice('This vacancy was already saved on another device.')
    else if (insertError) setError(insertError.message)
    else if (!data) setError('The vacancy could not be saved. Please try again.')
    else setNotice(`${result.title} at ${result.company} was saved to your tracker.`)
    await loadWorkspace()
    setBusy(false)
  }

  function deleteCV(cv: CV) {
    const linkedApplications = jobs.filter((job) => job.cv_id === cv.id).length
    const linkWarning = linkedApplications ? ` ${linkedApplications} linked application${linkedApplications === 1 ? '' : 's'} will keep their records but lose this CV link.` : ''
    return removeRecord({
      confirm: `Delete ${cv.name}? This removes its saved file and cannot be undone.${linkWarning}`,
      run: () => deleteCVRow(cv),
      conflict: 'This CV changed or was deleted on another device. The latest library has been loaded; please review it and try again.',
      deleted: async () => {
        if (!cv.storage_path) return 'CV deleted.'
        const { error: cleanupError } = await removeCVFile(cv.storage_path)
        return cleanupError
          ? 'CV deleted. Its database record was deleted, but the stored file could not be cleaned up automatically.'
          : 'CV deleted.'
      },
    })
  }

  async function enableNotifications() {
    if (!('Notification' in window)) {
      setError('This browser does not support desktop notifications.')
      return
    }
    const permission = await Notification.requestPermission()
    setNotice(permission === 'granted' ? 'Browser reminders are enabled on this device.' : 'Notification permission was not granted.')
  }

  async function signOut() {
    clearGoogleAccess()
    setGoogleConnected(false)
    await signOutWorkspace()
  }

  const openEditor = (job: Job) => { setError(''); setEditing(job) }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><span className="brand-mark small">EZ</span><div><strong>Opportunity Desk</strong><span>Career workspace</span></div></div>
        <nav aria-label="Main navigation">
          {NAV_GROUPS.map((group) => (
            <div className="nav-group" key={group}>
              <p className="nav-group-label">{group}</p>
              {NAV_ITEMS.filter((item) => item.group === group).map((item) => (
                <button key={item.view} className={activeNavView(view) === item.view ? 'nav-item active' : 'nav-item'} aria-current={view === item.view ? 'page' : undefined} onClick={() => setView(item.view)}>
                  <span aria-hidden="true">{item.symbol}</span>{item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-account"><span>{session.user.email}</span><span>{googleConnected ? 'Google connected' : settings?.google_client_id ? 'Google ready' : 'Google not configured'}</span><button className="button ghost" onClick={() => void signOut()}>Sign out</button></div>
      </aside>

      <div className="workspace-shell">
        <header className="mobile-topbar"><strong>Opportunity Desk</strong><button className="button ghost" onClick={() => void signOut()}>Sign out</button></header>
        <div className="mobile-nav" aria-label="Mobile navigation">{NAV_ITEMS.map((item) => <button key={item.view} className={activeNavView(view) === item.view ? 'active' : ''} aria-current={view === item.view ? 'page' : undefined} onClick={() => setView(item.view)}>{item.label}</button>)}</div>
        <main className="dashboard">
          <section className="page-head">
            <div><p className="eyebrow">Private synchronized workspace</p><h1>{viewTitle(view)}</h1></div>
            <button className="button primary add-button" onClick={() => { setError(''); if (view === 'cvs') setEditingCV('new'); else if (view === 'contacts') setEditingContact('new'); else if (view === 'outreach') setEditingOutreach('new'); else if (view === 'interviews') setEditingStar('new'); else setEditing('new') }}>{view === 'cvs' ? '+ Add CV' : view === 'contacts' ? '+ Add contact' : view === 'outreach' ? '+ Write to a company' : view === 'interviews' ? '+ Add STAR story' : '+ Add application'}</button>
          </section>

          {pendingSendHistory && <div className="sync-retry-banner" role="alert"><span><strong>Email already sent; history pending</strong>The Gmail message to {pendingSendHistory.recipient} is saved in this browser for retry. This action records that same message and will not send it again.</span><button className="button secondary" disabled={busy} onClick={() => void retrySendHistory()}>{busy ? 'Retrying...' : 'Retry history sync'}</button></div>}
          {error && <div className="error-banner" role="alert">{error}</div>}
          {notice && <div className="notice-banner" role="status">{notice}</div>}
          {loading ? <div className="workspace-card empty-state">Loading your workspace…</div> : (
            <>
              {view === 'dashboard' && <OverviewView jobs={jobs} cvs={cvs} stageEvents={stageEvents} counts={counts} jobReminders={reminders} contactReminders={contactReminders} onEditJob={openEditor} onEditContact={(contact) => { setError(''); setEditingContact(contact) }} onOpenBoard={() => setView('board')} onOpenReminders={() => setView('reminders')} />}
              {view === 'board' && <BoardView jobs={jobs} cvs={cvs} busy={busy} onEdit={openEditor} onStatus={changeStatus} onCV={changeJobCV} />}
              {view === 'applications' && <ApplicationsView jobs={visibleJobs} cvs={cvs} sends={applicationSends} total={jobs.length} search={search} filter={filter} busy={busy} onSearch={setSearch} onFilter={setFilter} onEdit={openEditor} onTailor={(job) => { setError(''); setNotice(''); setTailoringJob(job) }} onDelete={deleteJob} onDownloadCV={downloadCV} />}
              {view === 'reminders' && <RemindersView jobs={reminders} contacts={contactReminders} outreach={outreachReminders} onEdit={openEditor} onEditContact={(contact) => { setError(''); setEditingContact(contact) }} onOpenOutreach={(email) => { setError(''); setEditingOutreach(email) }} onEnable={enableNotifications} />}
              {view === 'outreach' && <OutreachView onBack={() => setView('contacts')} emails={outreachEmails} busy={busy} onCompose={() => { setError(''); setNotice(''); setEditingOutreach('new') }} onOpen={(email) => { setError(''); setNotice(''); setEditingOutreach(email) }} onDelete={deleteOutreach} />}
              {view === 'contacts' && <ContactsView onOpenOutreach={() => setView('outreach')} contacts={contacts} jobs={jobs} busy={busy} onAdd={() => { setError(''); setEditingContact('new') }} onEdit={(contact) => { setError(''); setEditingContact(contact) }} onDelete={deleteContact} onStage={changeContactStage} />}
              {view === 'interviews' && <InterviewPrepView jobs={jobs} preps={interviewPreps} stories={starStories} busy={busy} onSavePrep={saveInterviewPrep} onAddStory={() => { setError(''); setEditingStar('new') }} onViewStory={(story) => { setError(''); setViewingStar(story) }} onEditStory={(story) => { setError(''); setEditingStar(story) }} onDeleteStory={deleteStarStory} />}
              {view === 'backup' && <BackupView jobs={jobs} busy={busy} onJson={exportJson} onCsv={exportCsv} onImport={importJson} />}
              {view === 'settings' && settings && <SettingsView settings={settings} busy={busy} googleConnected={googleConnected} onSave={saveSettings} onConnectGoogle={connectGoogle} onEnableNotifications={enableNotifications} />}
              {view === 'cvs' && <CVLibrary cvs={cvs} blocks={cvBlocks} busy={busy} onAdd={() => { setError(''); setEditingCV('new') }} onEdit={(cv) => { setError(''); setEditingCV(cv) }} onDownload={downloadCV} onDelete={deleteCV} onBuild={() => { setError(''); setNotice(''); setBuildingCV(true) }} onAddBlock={() => { setError(''); setEditingBlock('new') }} onEditBlock={(block) => { setError(''); setEditingBlock(block) }} onDeleteBlock={deleteCVBlock} />}
              {view === 'search' && <JobSearch jobs={jobs} busy={busy} onSave={saveSearchResult} />}
            </>
          )}
        </main>
      </div>

      {editing && <JobForm initial={editing === 'new' ? EMPTY_JOB : toDraft(editing)} title={editing === 'new' ? 'Add an opportunity' : 'Update application'} busy={busy} error={error} notice={dialogNotice} cvs={cvs} existing={editing !== 'new'} googleConfigured={Boolean(settings?.google_client_id)} sendHistoryPending={Boolean(pendingSendHistory)} sendHistory={editing === 'new' ? [] : applicationSends.filter((send) => send.job_id === editing.id)} onCancel={() => { setError(''); setEditing(null) }} onSave={saveJob} onTailor={saveAndOpenTailoring} onCalendar={addToGoogleCalendar} onSend={sendApplicationEmail} onRetrySendHistory={retrySendHistory} replies={editing === 'new' ? [] : emailReplies.filter((reply) => reply.source_type === 'job' && reply.source_id === editing.id)} onCheckReplies={() => checkJobReplies(editing as Job)} />}
      {editingContact && <ContactForm initial={editingContact === 'new' ? EMPTY_CONTACT : contactToDraft(editingContact)} title={editingContact === 'new' ? 'Add a contact' : 'Update contact'} busy={busy} error={error} jobs={jobs} existing={editingContact !== 'new'} interactions={editingContact === 'new' ? [] : contactHistory} onCancel={() => { setError(''); setEditingContact(null) }} onSave={saveContact} onLogInteraction={logInteraction} onDeleteInteraction={deleteInteraction} />}
      {editingStar && <StarStoryForm initial={editingStar === 'new' ? EMPTY_STAR_STORY : starStoryToDraft(editingStar)} title={editingStar === 'new' ? 'Add a STAR story' : 'Update STAR story'} busy={busy} error={error} onCancel={() => { setError(''); setEditingStar(null) }} onSave={saveStarStory} />}
      {viewingStar && !editingStar && <StarStoryView story={starStories.find((story) => story.id === viewingStar.id) ?? viewingStar} onClose={() => setViewingStar(null)} onEdit={(story) => { setViewingStar(null); setError(''); setEditingStar(story) }} />}
      {editingOutreach && <OutreachForm
        initial={editingOutreach === 'new' ? EMPTY_OUTREACH : outreachToDraft(editingOutreach)}
        sent={editingOutreach !== 'new' && editingOutreach.status === 'sent' ? editingOutreach : null}
        inFlight={editingOutreach !== 'new' && editingOutreach.status === 'sending' ? editingOutreach : null}
        title={editingOutreach === 'new' ? 'Write to a company' : editingOutreach.status === 'sent' ? 'Email as sent' : editingOutreach.status === 'sending' ? 'Send outcome unknown' : 'Outreach draft'}
        busy={busy}
        error={error}
        notice={dialogNotice}
        cvs={cvs}
        contacts={contacts}
        googleConfigured={Boolean(settings?.google_client_id)}
        syncPending={Boolean(pendingOutreach) && (editingOutreach === 'new' || pendingOutreach?.outreach_id === editingOutreach.id)}
        onCancel={() => { setError(''); setEditingOutreach(null) }}
        onSaveDraft={saveOutreachDraft}
        onSend={sendOutreach}
        onUpdateOutcome={updateOutcome}
        onRetrySync={retryOutreachSync}
        onResolveAttempt={resolveOutreachAttemptOutcome}
        onReconcileAttempt={reconcileOutreachAttempt}
        onCheckReply={checkOutreachReply}
        replies={editingOutreach === 'new' ? [] : emailReplies.filter((reply) => reply.source_type === 'outreach' && reply.source_id === editingOutreach.id)}
      />}
      {editingBlock && <CVBlockForm initial={editingBlock === 'new' ? EMPTY_CV_BLOCK : blockToDraft(editingBlock)} title={editingBlock === 'new' ? 'Add a CV block' : 'Update CV block'} busy={busy} error={error} onCancel={() => { setError(''); setEditingBlock(null) }} onSave={saveCVBlock} />}
      {buildingCV && <CVBuilder jobs={jobs} blocks={cvBlocks} stories={starStories} busy={busy} error={error} notice={notice} onClose={() => { setError(''); setBuildingCV(false) }} onSave={saveBuiltCV} />}
      {editingCV && <CVForm initial={editingCV === 'new' ? EMPTY_CV : cvToDraft(editingCV)} title={editingCV === 'new' ? 'Add a CV' : 'Update CV'} existingFilename={editingCV === 'new' ? null : editingCV.original_filename || (editingCV.storage_path ? 'Stored file' : null)} busy={busy} error={error} onCancel={() => { setError(''); setEditingCV(null) }} onSave={saveCV} />}
      {tailoringJob && <TailorCV job={tailoringJob} cvs={cvs} busy={busy} actionError={error} actionNotice={notice} onClose={() => { setError(''); setTailoringJob(null) }} onSaveCV={saveTailoredCV} onUseCoverLetter={useTailoredCoverLetter} />}
    </div>
  )
}
