import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import type { RealtimeChannel, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { cvToDraft, formatFileSize, safeStorageFilename, validateCVFile } from '../lib/cvs'
import { blobToBase64, buildRawEmail, clearGoogleAccess, createCalendarEvent, fetchGmailAddress, fetchGmailThread, fetchRecentSentMessages, hasGoogleAccess, isGoogleRefusal, isTerminalClientError, requestGoogleAccess, sendGmailMessage, validGoogleClientId, type EmailAttachment } from '../lib/google'
import { findThreadReplies, matchLostSend, type DetectedReply } from '../lib/gmailReplies'
import {
  ACTIVE_STATUSES,
  BOARD_COLUMNS,
  downloadText,
  draftToPayload,
  formatDateTime,
  isJobStatus,
  isPriority,
  isWorkMode,
  jobMatches,
  jobsToCsv,
  relativeDueLabel,
  toLocalDateTimeInput,
  toDraft,
} from '../lib/opportunities'
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
import {
  APP_VIEWS,
  CV_BLOCK_TYPE_LABELS,
  EMPTY_CONTACT,
  EMPTY_CV,
  EMPTY_CV_BLOCK,
  EMPTY_JOB,
  EMPTY_OUTREACH,
  EMPTY_STAR_STORY,
  JOB_STATUSES,
  STATUS_LABELS,
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
  type DefaultView,
  type InteractionDraft,
  type InterviewPrep,
  type InterviewPrepDraft,
  type InterviewPrepSaveResult,
  type Job,
  type JobDraft,
  type EmailReply,
  type JobStageEvent,
  type JobStatus,
  type OutreachDraft,
  type OutreachEmail,
  type SettingsDraft,
  type StarStory,
  type StarStoryDraft,
  type UserSettings,
} from '../types'
import { AnalyticsView } from './Analytics'
import { ContactForm } from './ContactForm'
import { ContactsView } from './Contacts'
import { CVBlockForm } from './CVBlockForm'
import { CVBuilder, type BuiltCV } from './CVBuilder'
import { CVForm } from './CVForm'
import { InterviewPrepView } from './InterviewPrep'
import { JobForm } from './JobForm'
import { JobSearch } from './JobSearch'
import { OutreachView } from './Outreach'
import { OutreachForm, type OutreachOutcome } from './OutreachForm'
import { StarStoryForm } from './StarStoryForm'
import { StarStoryView } from './StarStoryView'
import type { JobSearchResult } from '../lib/jobSearch'
import { TailorCV } from './TailorCV'
import { tailoredCVText, type TailoringResult } from '../lib/tailoring'

const NAV_ITEMS: Array<{ view: AppView; label: string; symbol: string }> = [
  { view: 'dashboard', label: 'Dashboard', symbol: '◫' },
  { view: 'board', label: 'Board', symbol: '▦' },
  { view: 'applications', label: 'Applications', symbol: '≡' },
  { view: 'reminders', label: 'Reminders', symbol: '◷' },
  { view: 'contacts', label: 'Network', symbol: '◎' },
  { view: 'outreach', label: 'Outreach', symbol: '✉' },
  { view: 'interviews', label: 'Interviews', symbol: '✦' },
  { view: 'analytics', label: 'Analytics', symbol: '◔' },
  { view: 'cvs', label: 'CV library', symbol: '▤' },
  { view: 'search', label: 'Find jobs', symbol: '⌕' },
  { view: 'backup', label: 'Backup', symbol: '⇅' },
  { view: 'settings', label: 'Settings', symbol: '⚙' },
]

function currentTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function localDateInput() {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function defaultSettings(userId: string): UserSettings {
  const now = new Date().toISOString()
  return {
    user_id: userId,
    default_view: 'dashboard',
    reminders_enabled: true,
    reminder_lead_hours: 24,
    timezone: currentTimezone(),
    google_client_id: null,
    email_reminders_enabled: false,
    email_reminder_hour: 8,
    created_at: now,
    updated_at: now,
    version: 1,
  }
}

function viewTitle(view: AppView) {
  return NAV_ITEMS.find((item) => item.view === view)?.label ?? 'Opportunity Desk'
}

function legacyStatus(value: unknown): JobStatus {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  const statuses: Record<string, JobStatus> = {
    wishlist: 'saved',
    saved: 'saved',
    applied: 'applied',
    'phone screen': 'phone_screen',
    interview: 'interviewing',
    interviewing: 'interviewing',
    assessment: 'assessment',
    'final round': 'final_round',
    offer: 'offer',
    accepted: 'accepted',
    rejected: 'rejected',
    withdrawn: 'withdrawn',
    'on hold': 'on_hold',
    closed: 'closed',
  }
  return statuses[normalized] ?? 'saved'
}

function legacyWorkMode(value: unknown): JobDraft['work_mode'] {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (normalized === 'remote' || normalized === 'hybrid') return normalized
  if (normalized === 'on-site' || normalized === 'onsite') return 'onsite'
  return 'unspecified'
}

function legacyPriority(value: unknown): JobDraft['priority'] {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return isPriority(normalized) ? normalized : 'medium'
}

function JobBadges({ job }: { job: Job }) {
  return (
    <div className="badges">
      <span className={`status status-${job.status}`}>{STATUS_LABELS[job.status]}</span>
      <span className={`priority priority-${job.priority}`}>{job.priority}</span>
      {job.work_mode !== 'unspecified' && <span className="tag">{job.work_mode}</span>}
    </div>
  )
}

type WorkspaceProps = { session: Session }

const PENDING_SEND_PREFIX = 'opportunity-desk:pending-gmail-history:'
const PENDING_OUTREACH_PREFIX = 'opportunity-desk:pending-outreach-record:'

/** A Gmail message that was accepted but whose outreach row was not updated. */
type PendingOutreachRecord = {
  outreach_id: string
  provider_message_id: string
  provider_thread_id: string | null
  attachment_filename: string | null
  sent_at: string
}

function pendingOutreachKey(userId: string) {
  return `${PENDING_OUTREACH_PREFIX}${userId}`
}

function readPendingOutreach(userId: string): PendingOutreachRecord | null {
  try {
    const raw = localStorage.getItem(pendingOutreachKey(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PendingOutreachRecord>
    if (!parsed.outreach_id || !parsed.provider_message_id || !parsed.sent_at) return null
    return parsed as PendingOutreachRecord
  }
  catch {
    return null
  }
}

function pendingSendStorageKey(userId: string) {
  return `${PENDING_SEND_PREFIX}${userId}`
}

// The API caps every request at its configured max_rows (1000), so stage
// history must be paged; a single capped ascending query would permanently
// hide the newest events once an account exceeds the cap.
async function fetchAllStageEvents(): Promise<{ data: JobStageEvent[] | null; error: { message: string } | null }> {
  const pageSize = 1000
  const events: JobStageEvent[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('job_stage_events')
      .select('*')
      .order('occurred_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) return { data: null, error }
    const page = (data ?? []) as JobStageEvent[]
    events.push(...page)
    if (page.length < pageSize) return { data: events, error: null }
  }
}

function readPendingSend(userId: string): ApplicationSend | null {
  try {
    const raw = localStorage.getItem(pendingSendStorageKey(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ApplicationSend>
    if (parsed.user_id !== userId || parsed.status !== 'sent' || parsed.provider !== 'gmail' || !parsed.id || !parsed.job_id || !parsed.provider_message_id || !parsed.recipient || !parsed.subject || !parsed.sent_at || !parsed.details || typeof parsed.details !== 'object') return null
    return parsed as ApplicationSend
  }
  catch {
    return null
  }
}

/**
 * Reading reply headers needs the Gmail metadata scope, which connections made
 * before this feature never granted, so a refusal usually means the permission
 * is missing rather than that something is broken.
 */
function gmailReadError(caught: unknown) {
  const message = caught instanceof Error ? caught.message : 'Gmail could not be reached.'
  if (isGoogleRefusal(caught) && (caught.status === 403 || caught.status === 401)) {
    return `${message} Checking replies needs one extra Gmail permission that reads message headers only. Open Settings, select Connect Google, approve it, then try again.`
  }
  return message
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
  const [editingOutreach, setEditingOutreach] = useState<OutreachEmail | 'new' | null>(null)
  const [pendingOutreach, setPendingOutreach] = useState<PendingOutreachRecord | null>(() => readPendingOutreach(session.user.id))
  const [emailReplies, setEmailReplies] = useState<EmailReply[]>([])
  const gmailAddressRef = useRef<{ token: string; address: string } | null>(null)
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const [settingsPersisted, setSettingsPersisted] = useState(false)
  const [view, setView] = useState<AppView>('dashboard')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
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
    try {
      localStorage.setItem(pendingSendStorageKey(session.user.id), JSON.stringify(record))
    }
    catch {
      // The in-memory retry remains available when browser storage is unavailable.
    }
  }

  function forgetPendingSend() {
    setPendingSendHistory(null)
    try {
      localStorage.removeItem(pendingSendStorageKey(session.user.id))
    }
    catch {
      // Nothing else is required when browser storage is unavailable.
    }
  }

  const loadWorkspace = useCallback(async () => {
    const [jobsResult, cvsResult, settingsResult, sendsResult, contactsResult, storiesResult, prepsResult, stageEventsResult, blocksResult, outreachResult, repliesResult] = await Promise.all([
      supabase.from('jobs').select('*').order('updated_at', { ascending: false }),
      supabase.from('cvs').select('*').order('updated_at', { ascending: false }),
      supabase.from('user_settings').select('*').eq('user_id', session.user.id).maybeSingle(),
      supabase.from('application_sends').select('*').order('sent_at', { ascending: false }).limit(500),
      supabase.from('contacts').select('*, contact_interactions(occurred_at)')
        .order('updated_at', { ascending: false })
        .order('occurred_at', { referencedTable: 'contact_interactions', ascending: false })
        .limit(1, { referencedTable: 'contact_interactions' }),
      supabase.from('star_stories').select('*').order('updated_at', { ascending: false }),
      supabase.from('interview_preps').select('*'),
      fetchAllStageEvents(),
      supabase.from('cv_blocks').select('*').order('block_type', { ascending: true }).order('sort_order', { ascending: true }),
      supabase.from('outreach_emails').select('*').order('updated_at', { ascending: false }).limit(1000),
      supabase.from('email_replies').select('*').order('received_at', { ascending: false }).limit(1000),
    ])

    if (jobsResult.error) setError(jobsResult.error.message)
    else setJobs((jobsResult.data ?? []) as Job[])

    if (cvsResult.error) setError(cvsResult.error.message)
    else setCVs((cvsResult.data ?? []) as CV[])

    if (sendsResult.error) setError(sendsResult.error.message)
    else setApplicationSends((sendsResult.data ?? []) as ApplicationSend[])

    if (contactsResult.error) setError(contactsResult.error.message)
    else {
      const contactRows = (contactsResult.data ?? []) as Array<Omit<Contact, 'last_interaction_at'> & { contact_interactions?: Array<{ occurred_at: string }> }>
      setContacts(contactRows.map(({ contact_interactions: latestInteraction, ...contact }) => ({
        ...contact,
        last_interaction_at: latestInteraction?.[0]?.occurred_at ?? null,
      })))
    }

    if (storiesResult.error) setError(storiesResult.error.message)
    else setStarStories((storiesResult.data ?? []) as StarStory[])

    if (prepsResult.error) setError(prepsResult.error.message)
    else setInterviewPreps((prepsResult.data ?? []) as InterviewPrep[])

    if (stageEventsResult.error) setError(stageEventsResult.error.message)
    else setStageEvents(stageEventsResult.data ?? [])

    if (blocksResult.error) setError(blocksResult.error.message)
    else setCVBlocks((blocksResult.data ?? []) as CVBlock[])

    if (outreachResult.error) setError(outreachResult.error.message)
    else setOutreachEmails((outreachResult.data ?? []) as OutreachEmail[])

    if (repliesResult.error) setError(repliesResult.error.message)
    else setEmailReplies((repliesResult.data ?? []) as EmailReply[])

    if (settingsResult.error) {
      setError(settingsResult.error.message)
      setSettings(defaultSettings(session.user.id))
      setSettingsPersisted(false)
    }
    else {
      const nextSettings = settingsResult.data as UserSettings | null
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
    const { data, error: historyError } = await supabase
      .from('contact_interactions')
      .select('*')
      .eq('contact_id', contactId)
      .order('occurred_at', { ascending: false })
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
      await supabase.realtime.setAuth(session.access_token)
      if (disposed) return
      channel = supabase
        .channel(`opportunity-desk:${session.user.id}`, { config: { private: true } })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: `user_id=eq.${session.user.id}` }, () => void loadWorkspace())
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'cvs', filter: `user_id=eq.${session.user.id}` }, () => void loadWorkspace())
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'cvs', filter: `user_id=eq.${session.user.id}` }, () => void loadWorkspace())
        .on('broadcast', { event: 'cv_deleted' }, () => void loadWorkspace())
        .on('broadcast', { event: 'record_deleted' }, () => refreshNetworkingData())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'user_settings', filter: `user_id=eq.${session.user.id}` }, () => void loadWorkspace())
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'application_sends', filter: `user_id=eq.${session.user.id}` }, () => void loadWorkspace())
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'contacts', filter: `user_id=eq.${session.user.id}` }, () => void loadWorkspace())
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'contacts', filter: `user_id=eq.${session.user.id}` }, () => void loadWorkspace())
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'contact_interactions', filter: `user_id=eq.${session.user.id}` }, () => refreshNetworkingData())
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'contact_interactions', filter: `user_id=eq.${session.user.id}` }, () => refreshNetworkingData())
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'star_stories', filter: `user_id=eq.${session.user.id}` }, () => void loadWorkspace())
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'star_stories', filter: `user_id=eq.${session.user.id}` }, () => void loadWorkspace())
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'interview_preps', filter: `user_id=eq.${session.user.id}` }, () => void loadWorkspace())
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'interview_preps', filter: `user_id=eq.${session.user.id}` }, () => void loadWorkspace())
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'job_stage_events', filter: `user_id=eq.${session.user.id}` }, () => void loadWorkspace())
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'cv_blocks', filter: `user_id=eq.${session.user.id}` }, () => void loadWorkspace())
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'cv_blocks', filter: `user_id=eq.${session.user.id}` }, () => void loadWorkspace())
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'outreach_emails', filter: `user_id=eq.${session.user.id}` }, () => void loadWorkspace())
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'outreach_emails', filter: `user_id=eq.${session.user.id}` }, () => void loadWorkspace())
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'email_replies', filter: `user_id=eq.${session.user.id}` }, () => void loadWorkspace())
        .subscribe()
    }

    void subscribe().catch(() => {
      if (!disposed) setError('Live synchronization could not connect. Your saved data is still available; reload to retry.')
    })
    return () => {
      disposed = true
      if (channel) void supabase.removeChannel(channel)
    }
  }, [loadWorkspace, refreshNetworkingData, session.access_token, session.user.id])

  useEffect(() => {
    setGoogleConnected(hasGoogleAccess(session.user.id, settings?.google_client_id))
  }, [session.user.id, settings?.google_client_id])

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
    followUps: reminders.filter((job) => new Date(job.next_action_at!).getTime() <= Date.now() + 7 * 86_400_000).length,
  }), [jobs, reminders])

  async function saveJob(draft: JobDraft) {
    if (!editing) return
    const recordBeingEdited = editing
    setBusy(true)
    setError('')
    setNotice('')
    const payload = draftToPayload(draft)
    const result = recordBeingEdited === 'new'
      ? await supabase.from('jobs').insert({ ...payload, user_id: session.user.id }).select('id, version').maybeSingle()
      : await supabase.from('jobs').update(payload).eq('id', recordBeingEdited.id).eq('version', recordBeingEdited.version).select('id, version').maybeSingle()

    if (result.error) setError(result.error.message)
    else if (!result.data && recordBeingEdited !== 'new') {
      const { data: latest, error: latestError } = await supabase.from('jobs').select('version').eq('id', recordBeingEdited.id).maybeSingle()
      if (latestError) setError(latestError.message)
      else if (!latest) setError('This application was deleted on another device. Your unsaved edits remain open.')
      else {
        setEditing({ ...recordBeingEdited, version: latest.version })
        setError('This application changed on another device. Your edits remain open. Review them, then save again.')
      }
      await loadWorkspace()
    } else {
      setEditing(null)
      setNotice('Application saved and synchronized.')
      await loadWorkspace()
    }
    setBusy(false)
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
    const { data, error: updateError } = await supabase
      .from('jobs')
      .update(draftToPayload(draft))
      .eq('id', recordBeingEdited.id)
      .eq('version', recordBeingEdited.version)
      .select('*')
      .maybeSingle()
    if (updateError) setError(updateError.message)
    else if (!data) {
      const { data: latest } = await supabase.from('jobs').select('version').eq('id', recordBeingEdited.id).maybeSingle()
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
    const { error: insertError } = await supabase.from('cvs').insert({
      id: cvId,
      user_id: session.user.id,
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

    const { data: linked, error: linkError } = await supabase
      .from('jobs')
      .update({ cv_id: cvId })
      .eq('id', job.id)
      .eq('version', job.version)
      .select('id')
      .maybeSingle()
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
    const { data, error: updateError } = await supabase
      .from('jobs')
      .update({ email_body: result.cover_letter })
      .eq('id', job.id)
      .eq('version', job.version)
      .select('*')
      .maybeSingle()
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
    const { data, error: updateError } = await supabase
      .from('jobs')
      .update({ status })
      .eq('id', job.id)
      .eq('version', job.version)
      .select('id')
      .maybeSingle()
    if (updateError) setError(updateError.message)
    else if (!data) setError('This application changed on another device. The latest version has been loaded; please try the move again.')
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
    const { error: deleteError } = await supabase.from('jobs').delete().eq('id', job.id)
    if (deleteError) setError(deleteError.message)
    else {
      setNotice('Application deleted.')
      await loadWorkspace()
    }
    setBusy(false)
  }

  async function saveContact(draft: ContactDraft) {
    if (!editingContact) return
    const recordBeingEdited = editingContact
    setBusy(true)
    setError('')
    setNotice('')
    const payload = contactDraftToPayload(draft)
    const result = recordBeingEdited === 'new'
      ? await supabase.from('contacts').insert({ ...payload, user_id: session.user.id }).select('id, version').maybeSingle()
      : await supabase.from('contacts').update(payload).eq('id', recordBeingEdited.id).eq('version', recordBeingEdited.version).select('id, version').maybeSingle()

    if (result.error) setError(result.error.message)
    else if (!result.data && recordBeingEdited !== 'new') {
      const { data: latest, error: latestError } = await supabase.from('contacts').select('version').eq('id', recordBeingEdited.id).maybeSingle()
      if (latestError) setError(latestError.message)
      else if (!latest) setError('This contact was deleted on another device. Your unsaved edits remain open.')
      else {
        setEditingContact({ ...recordBeingEdited, version: latest.version })
        setError('This contact changed on another device. Your edits remain open. Review them, then save again.')
      }
      await loadWorkspace()
    } else {
      setEditingContact(null)
      setNotice('Contact saved and synchronized.')
      await loadWorkspace()
    }
    setBusy(false)
  }

  async function deleteContact(contact: Contact) {
    if (!window.confirm(`Delete ${contact.name}? Their logged interactions are removed too. This cannot be undone.`)) return
    setBusy(true)
    setError('')
    setNotice('')
    const { data, error: deleteError } = await supabase.from('contacts').delete().eq('id', contact.id).eq('version', contact.version).select('id').maybeSingle()
    if (deleteError) setError(deleteError.message)
    else if (!data) setError('This contact changed or was deleted on another device. The latest list has been loaded; please review it and try again.')
    else setNotice('Contact deleted.')
    await loadWorkspace()
    setBusy(false)
  }

  async function changeContactStage(contact: Contact, stage: ContactStage) {
    if (stage === contact.pipeline_stage) return
    setBusy(true)
    setError('')
    const { data, error: updateError } = await supabase
      .from('contacts')
      .update({ pipeline_stage: stage })
      .eq('id', contact.id)
      .eq('version', contact.version)
      .select('id')
      .maybeSingle()
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
    const { error: insertError } = await supabase
      .from('contact_interactions')
      .insert({ ...interactionDraftToPayload(draft, contactId), user_id: session.user.id })
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
    const { data, error: deleteError } = await supabase.from('contact_interactions').delete().eq('id', interaction.id).eq('version', interaction.version).select('id').maybeSingle()
    if (deleteError) setError(deleteError.message)
    else if (!data) setError('This interaction changed or was removed on another device. The latest history has been loaded.')
    await loadContactHistory(interaction.contact_id)
    await loadWorkspace()
    setBusy(false)
  }

  async function saveStarStory(draft: StarStoryDraft) {
    if (!editingStar) return
    const recordBeingEdited = editingStar
    setBusy(true)
    setError('')
    setNotice('')
    const payload = starStoryDraftToPayload(draft)
    const result = recordBeingEdited === 'new'
      ? await supabase.from('star_stories').insert({ ...payload, user_id: session.user.id }).select('id, version').maybeSingle()
      : await supabase.from('star_stories').update(payload).eq('id', recordBeingEdited.id).eq('version', recordBeingEdited.version).select('id, version').maybeSingle()

    if (result.error) setError(result.error.message)
    else if (!result.data && recordBeingEdited !== 'new') {
      const { data: latest, error: latestError } = await supabase.from('star_stories').select('version').eq('id', recordBeingEdited.id).maybeSingle()
      if (latestError) setError(latestError.message)
      else if (!latest) setError('This story was deleted on another device. Your unsaved edits remain open.')
      else {
        setEditingStar({ ...recordBeingEdited, version: latest.version })
        setError('This story changed on another device. Your edits remain open. Review them, then save again.')
      }
      await loadWorkspace()
    } else {
      setEditingStar(null)
      setNotice('STAR story saved and synchronized.')
      await loadWorkspace()
    }
    setBusy(false)
  }

  function rememberPendingOutreach(record: PendingOutreachRecord) {
    setPendingOutreach(record)
    try {
      localStorage.setItem(pendingOutreachKey(session.user.id), JSON.stringify(record))
    }
    catch {
      // The in-memory retry remains available when browser storage is unavailable.
    }
  }

  function forgetPendingOutreach() {
    setPendingOutreach(null)
    try {
      localStorage.removeItem(pendingOutreachKey(session.user.id))
    }
    catch {
      // Nothing else is required when browser storage is unavailable.
    }
  }

  /** Marks an outreach row as sent. Used by the send path and by its retry. */
  async function recordOutreachSent(record: PendingOutreachRecord) {
    const { data, error: updateError } = await supabase
      .from('outreach_emails')
      .update({
        status: 'sent',
        sent_at: record.sent_at,
        provider_message_id: record.provider_message_id,
        provider_thread_id: record.provider_thread_id,
        attachment_filename: record.attachment_filename,
      })
      .eq('id', record.outreach_id)
      .eq('status', 'sending')
      .select('id')
      .maybeSingle()
    if (updateError) throw updateError
    if (!data) {
      // Already recorded, by an earlier retry or another device.
      const { data: existing, error: lookupError } = await supabase
        .from('outreach_emails')
        .select('id, provider_message_id')
        .eq('id', record.outreach_id)
        .maybeSingle()
      if (lookupError) throw lookupError
      if (!existing || existing.provider_message_id !== record.provider_message_id) {
        throw new Error('The outreach record could not be updated to match the sent message.')
      }
    }
  }

  /**
   * The signed-in mailbox address, cached against the access token that
   * produced it. Reconnecting Google can authorize a different account, and a
   * stale address would make that account's own outbound mail look like a
   * reply from a stranger.
   */
  async function gmailAddress(token: string) {
    if (gmailAddressRef.current?.token !== token) {
      gmailAddressRef.current = { token, address: await fetchGmailAddress(token) }
    }
    return gmailAddressRef.current.address
  }

  /** Stores detected replies. Duplicates are ignored, so checking is repeatable. */
  async function recordReplies(sourceType: 'job' | 'outreach', sourceId: string, replies: DetectedReply[]) {
    if (!replies.length) return
    const { error: insertError } = await supabase
      .from('email_replies')
      .upsert(
        replies.map((reply) => ({ ...reply, user_id: session.user.id, source_type: sourceType, source_id: sourceId })),
        { onConflict: 'user_id,provider_message_id', ignoreDuplicates: true },
      )
    if (insertError) throw insertError
  }

  /**
   * Asks Gmail whether one thread has been answered. Deliberately per-thread
   * and user-triggered rather than a background mailbox sweep.
   */
  async function checkOutreachReply(email: OutreachEmail) {
    if (!email.provider_thread_id) {
      setError('This message has no Gmail thread recorded, so its replies cannot be checked. It was probably recorded as sent by hand.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const token = await requestGoogleAccess(session.user.id, googleClientId())
      setGoogleConnected(true)
      const address = await gmailAddress(token)
      const thread = await fetchGmailThread(token, email.provider_thread_id)
      if (!thread) {
        setNotice('That Gmail thread no longer exists in your mailbox.')
      }
      else {
        const replies = findThreadReplies(thread.messages ?? [], address, email.sent_at ?? email.created_at)
        if (!replies.length) {
          setNotice(`No reply on that thread yet. Checked ${formatDateTime(new Date().toISOString())}.`)
        }
        else {
          await recordReplies('outreach', email.id, replies)
          const first = replies[0]
          const found = `Reply found from ${first.from_address} on ${formatDateTime(first.received_at)}.`
          if (email.reply_status === 'replied') {
            setNotice(`${found} It was already marked as replied.`)
          }
          else {
            const { data: updated, error: markError } = await supabase
              .from('outreach_emails')
              .update({ reply_status: 'replied', replied_at: first.received_at })
              .eq('id', email.id)
              .eq('version', email.version)
              .select('*')
              .maybeSingle()
            if (markError) setError(`${found} Marking it as replied failed: ${markError.message}`)
            else if (!updated) setError(`${found} It changed on another device, so it was not marked as replied. Reopen it and set the reply state yourself.`)
            else {
              // The open editor holds a snapshot, and this write moved the row
              // on. Replacing it keeps the version current so the next save is
              // not rejected as a conflict.
              setEditingOutreach(updated as OutreachEmail)
              setNotice(`${found} Marked as replied, so it stops appearing in follow-ups.`)
            }
          }
        }
      }
      await loadWorkspace()
    }
    catch (caught) {
      setGoogleConnected(hasGoogleAccess(session.user.id, settings?.google_client_id))
      setError(gmailReadError(caught))
      await loadWorkspace()
    }
    finally {
      setBusy(false)
    }
  }

  /**
   * Finds a message whose send response was lost by looking through recent
   * sent mail, so an unknown outcome no longer has to be resolved by hand.
   */
  async function reconcileOutreachAttempt(email: OutreachEmail) {
    if (!email.send_attempted_at) {
      setError('This message has no recorded send attempt to reconcile.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const token = await requestGoogleAccess(session.user.id, googleClientId())
      setGoogleConnected(true)
      const recent = await fetchRecentSentMessages(token)
      const match = matchLostSend(recent, {
        recipient: email.recipient_email,
        subject: email.subject,
        attemptedAtIso: email.send_attempted_at,
      })
      if (!match) {
        setNotice('No matching message in your recent Sent mail around the time of the attempt, so it probably never went. Return it to draft if you agree, or check Gmail yourself if the attempt was long ago.')
      }
      else {
        const sentAtEpoch = Number(match.internalDate)
        const matchedAt = Number.isFinite(sentAtEpoch) ? formatDateTime(new Date(sentAtEpoch).toISOString()) : 'an unknown time'
        // Recording this is effectively permanent: the row freezes once sent.
        if (!window.confirm(`Found a message to ${email.recipient_email} with this subject, sent at ${matchedAt}. Record this attempt as delivered? Its content can no longer be changed afterwards.`)) {
          setBusy(false)
          return
        }
        await recordOutreachSent({
          outreach_id: email.id,
          provider_message_id: match.id,
          provider_thread_id: match.threadId ?? null,
          attachment_filename: email.attachment_filename,
          sent_at: Number.isFinite(sentAtEpoch) ? new Date(sentAtEpoch).toISOString() : email.send_attempted_at,
        })
        forgetPendingOutreach()
        setEditingOutreach(null)
        setNotice('Found in your Sent mail and recorded as sent, with its Gmail thread attached for reply checking.')
      }
      await loadWorkspace()
    }
    catch (caught) {
      setGoogleConnected(hasGoogleAccess(session.user.id, settings?.google_client_id))
      setError(gmailReadError(caught))
      await loadWorkspace()
    }
    finally {
      setBusy(false)
    }
  }

  /** Checks every Gmail thread this application was sent on. */
  async function checkJobReplies(job: Job) {
    const threads = applicationSends
      .filter((send) => send.job_id === job.id && send.status === 'sent')
      .map((send) => ({ send, threadId: typeof send.details?.thread_id === 'string' ? send.details.thread_id : '' }))
      .filter((entry) => entry.threadId)
    if (!threads.length) {
      setError('No Gmail thread was recorded for this application, so replies cannot be checked.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const token = await requestGoogleAccess(session.user.id, googleClientId())
      setGoogleConnected(true)
      const address = await gmailAddress(token)
      let found = 0
      for (const { send, threadId } of threads) {
        const thread = await fetchGmailThread(token, threadId)
        if (!thread) continue
        const replies = findThreadReplies(thread.messages ?? [], address, send.sent_at)
        await recordReplies('job', job.id, replies)
        found += replies.length
      }
      setNotice(found
        ? `${found} repl${found === 1 ? 'y' : 'ies'} found. Review them and change the application stage yourself if it has moved on.`
        : `No replies on ${threads.length === 1 ? 'that thread' : 'those threads'} yet.`)
      await loadWorkspace()
    }
    catch (caught) {
      setGoogleConnected(hasGoogleAccess(session.user.id, settings?.google_client_id))
      setError(gmailReadError(caught))
      await loadWorkspace()
    }
    finally {
      setBusy(false)
    }
  }

  async function saveOutreachDraft(draft: OutreachDraft) {
    if (!editingOutreach) return
    const recordBeingEdited = editingOutreach
    setBusy(true)
    setError('')
    setNotice('')
    const payload = outreachDraftToPayload(draft)
    const result = recordBeingEdited === 'new'
      ? await supabase.from('outreach_emails').insert({ ...payload, user_id: session.user.id, status: 'draft' }).select('id, version').maybeSingle()
      : await supabase.from('outreach_emails').update(payload).eq('id', recordBeingEdited.id).eq('version', recordBeingEdited.version).select('id, version').maybeSingle()

    if (result.error) setError(result.error.message)
    else if (!result.data && recordBeingEdited !== 'new') {
      const { data: latest, error: latestError } = await supabase.from('outreach_emails').select('version').eq('id', recordBeingEdited.id).maybeSingle()
      if (latestError) setError(latestError.message)
      else if (!latest) setError('This message was deleted on another device. Your unsaved edits remain open.')
      else {
        setEditingOutreach({ ...recordBeingEdited, version: latest.version })
        setError('This message changed on another device. Your edits remain open. Review them, then save again.')
      }
      await loadWorkspace()
    } else {
      setEditingOutreach(null)
      setNotice('Outreach draft saved and synchronized.')
      await loadWorkspace()
    }
    setBusy(false)
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
      const saved = recordBeingEdited === 'new'
        ? await supabase.from('outreach_emails').insert({ ...payload, user_id: session.user.id, status: 'draft' }).select('id, version').maybeSingle()
        : await supabase.from('outreach_emails').update(payload).eq('id', recordBeingEdited.id).eq('version', recordBeingEdited.version).select('id, version').maybeSingle()
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
      const { data: claimed, error: claimError } = await supabase
        .from('outreach_emails')
        .update({ status: 'sending', send_attempt_id: crypto.randomUUID(), send_attempted_at: attemptedAt })
        .eq('id', outreachId)
        .eq('status', 'draft')
        // The raw MIME was built from the payload this client just wrote, so
        // the claim must match that exact version. Without it a concurrent
        // edit would be frozen as the delivered message while the older text
        // is what actually left the mailbox.
        .eq('version', savedVersion)
        .select('id')
        .maybeSingle()
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
          await supabase
            .from('outreach_emails')
            .update({ status: 'draft', send_attempt_id: null, send_attempted_at: null })
            .eq('id', outreachId)
            .eq('status', 'sending')
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
   * Resolves a message whose Gmail response was lost. The user checks their
   * own Sent folder, because the app holds only the send scope and cannot
   * read the mailbox to find out.
   */
  async function resolveOutreachAttempt(email: OutreachEmail, delivered: boolean) {
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
    const { data, error: updateError } = await supabase
      .from('outreach_emails')
      .update(payload)
      .eq('id', email.id)
      .eq('status', 'sending')
      .select('id')
      .maybeSingle()
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

  async function updateOutreachOutcome(email: OutreachEmail, outcome: OutreachOutcome) {
    setBusy(true)
    setError('')
    setNotice('')
    const { data, error: updateError } = await supabase
      .from('outreach_emails')
      .update({
        reply_status: outcome.reply_status,
        replied_at: outcome.reply_status === 'replied' ? (email.replied_at ?? new Date().toISOString()) : null,
        follow_up_at: outcome.follow_up_at ? new Date(outcome.follow_up_at).toISOString() : null,
        notes: outcome.notes.trim() || null,
      })
      .eq('id', email.id)
      .eq('version', email.version)
      .select('id')
      .maybeSingle()
    if (updateError) setError(updateError.message)
    else if (!data) setError('This message changed on another device. The latest version has been loaded; review it and save again.')
    else {
      setEditingOutreach(null)
      setNotice('Outreach outcome saved and synchronized.')
    }
    await loadWorkspace()
    setBusy(false)
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
    const warning = email.status === 'sent'
      ? `Delete the record of the email sent to ${email.recipient_email}? The message itself stays in Gmail, but this copy of what you sent cannot be recovered.`
      : `Delete this draft to ${email.company}? This cannot be undone.`
    if (!window.confirm(warning)) return
    setBusy(true)
    setError('')
    setNotice('')
    const { data, error: deleteError } = await supabase.from('outreach_emails').delete().eq('id', email.id).eq('version', email.version).select('id').maybeSingle()
    if (deleteError) setError(deleteError.message)
    else if (!data) setError('This message changed or was deleted on another device. The latest list has been loaded.')
    else setNotice('Outreach record deleted.')
    await loadWorkspace()
    setBusy(false)
  }

  async function saveCVBlock(draft: CVBlockDraft) {
    if (!editingBlock) return
    const recordBeingEdited = editingBlock
    setBusy(true)
    setError('')
    setNotice('')
    const payload = blockDraftToPayload(draft)
    const result = recordBeingEdited === 'new'
      ? await supabase.from('cv_blocks').insert({ ...payload, user_id: session.user.id }).select('id, version').maybeSingle()
      : await supabase.from('cv_blocks').update(payload).eq('id', recordBeingEdited.id).eq('version', recordBeingEdited.version).select('id, version').maybeSingle()

    if (result.error) setError(result.error.message)
    else if (!result.data && recordBeingEdited !== 'new') {
      const { data: latest, error: latestError } = await supabase.from('cv_blocks').select('version').eq('id', recordBeingEdited.id).maybeSingle()
      if (latestError) setError(latestError.message)
      else if (!latest) setError('This block was deleted on another device. Your unsaved edits remain open.')
      else {
        setEditingBlock({ ...recordBeingEdited, version: latest.version })
        setError('This block changed on another device. Your edits remain open. Review them, then save again.')
      }
      await loadWorkspace()
    } else {
      setEditingBlock(null)
      setNotice('CV block saved and synchronized.')
      await loadWorkspace()
    }
    setBusy(false)
  }

  async function deleteCVBlock(block: CVBlock) {
    if (!window.confirm(`Delete the block “${block.title}”? This cannot be undone. CVs already built from it keep their text.`)) return
    setBusy(true)
    setError('')
    setNotice('')
    const { data, error: deleteError } = await supabase.from('cv_blocks').delete().eq('id', block.id).eq('version', block.version).select('id').maybeSingle()
    if (deleteError) setError(deleteError.message)
    else if (!data) setError('This block changed or was deleted on another device. The latest list has been loaded.')
    else setNotice('CV block deleted.')
    await loadWorkspace()
    setBusy(false)
  }

  async function saveBuiltCV(built: BuiltCV) {
    const cvId = crypto.randomUUID()
    setBusy(true)
    setError('')
    setNotice('')
    const { error: insertError } = await supabase.from('cvs').insert({
      id: cvId,
      user_id: session.user.id,
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

    const { data: linked, error: linkError } = await supabase
      .from('jobs')
      .update({ cv_id: cvId })
      .eq('id', built.job.id)
      .eq('version', built.job.version)
      .select('id')
      .maybeSingle()

    const linkTarget = `${built.job.role_title} at ${built.job.company}`
    if (linkError) setError(`“${built.name}” was saved to your CV library, but linking it to ${linkTarget} failed: ${linkError.message} Open that application and choose it under “CV used”. Do not build it again.`)
    else if (!linked) setError(`“${built.name}” was saved to your CV library, but ${linkTarget} changed on another device, so it was not linked. Open that application and choose the CV under “CV used”. Do not build it again.`)
    else setNotice('CV built, saved to your library, and linked to the application.')

    await loadWorkspace()
    setBusy(false)
  }

  async function deleteStarStory(story: StarStory) {
    if (!window.confirm(`Delete “${story.title}”? This cannot be undone.`)) return
    setBusy(true)
    setError('')
    setNotice('')
    const { data, error: deleteError } = await supabase.from('star_stories').delete().eq('id', story.id).eq('version', story.version).select('id').maybeSingle()
    if (deleteError) setError(deleteError.message)
    else if (!data) setError('This story changed or was deleted on another device. The latest library has been loaded.')
    else setNotice('STAR story deleted.')
    await loadWorkspace()
    setBusy(false)
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
      const { data, error: updateError } = await supabase
        .from('interview_preps')
        .update(payload)
        .eq('id', existingPrep.id)
        .eq('version', existingPrep.version)
        .select('*')
        .maybeSingle()
      if (updateError) setError(updateError.message)
      else if (!data) {
        const { data: latest, error: latestError } = await supabase.from('interview_preps').select('*').eq('id', existingPrep.id).maybeSingle()
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
      const { data, error: insertError } = await supabase
        .from('interview_preps')
        .insert({ ...payload, user_id: session.user.id, job_id: job.id })
        .select('*')
        .maybeSingle()
      if (insertError?.code === '23505') {
        const { data: latest, error: latestError } = await supabase.from('interview_preps').select('*').eq('job_id', job.id).maybeSingle()
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
    const googleClientId = draft.google_client_id.trim()
    if (googleClientId && !validGoogleClientId(googleClientId)) {
      setError('The Google client ID must end in .apps.googleusercontent.com and match the ID from Google Cloud.')
      setBusy(false)
      return
    }
    const payload = { ...draft, google_client_id: googleClientId || null }
    const basePayload = { ...payload, user_id: session.user.id }
    const result = settingsPersisted && settings
      ? await supabase.from('user_settings').update(payload).eq('user_id', session.user.id).eq('version', settings.version).select('*').maybeSingle()
      : await supabase.from('user_settings').upsert(basePayload, { onConflict: 'user_id' }).select('*').maybeSingle()

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
      await requestGoogleAccess(session.user.id, clientId)
      setGoogleConnected(true)
      setNotice('Google is connected for this browser session. Save Settings to synchronize the public client ID.')
    }
    catch (caught) {
      setGoogleConnected(false)
      setError(caught instanceof Error ? caught.message : 'Google could not be connected.')
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

  async function cvEmailAttachment(cv: CV): Promise<EmailAttachment> {
    if (cv.storage_path) {
      const { data, error: downloadError } = await supabase.storage.from('cvs').download(cv.storage_path)
      if (downloadError) throw downloadError
      return {
        filename: safeStorageFilename(cv.original_filename || `${cv.name}.pdf`),
        mimeType: cv.mime_type || data.type || 'application/octet-stream',
        base64: await blobToBase64(data),
      }
    }
    if (!cv.plain_text) throw new Error('The selected CV has no file or text to attach.')
    const textFile = new Blob([cv.plain_text], { type: 'text/plain;charset=utf-8' })
    return {
      filename: `${safeStorageFilename(cv.name)}.txt`,
      mimeType: 'text/plain',
      base64: await blobToBase64(textFile),
    }
  }

  async function recordFailedSend(job: Job, draft: JobDraft, cv: CV | undefined, message: string) {
    await supabase.from('application_sends').insert({
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
    const { error: historyError } = await supabase.from('application_sends').insert(record)
    if (!historyError) return
    if (historyError.code !== '23505') throw historyError

    const { data: existing, error: lookupError } = await supabase
      .from('application_sends')
      .select('id, provider_message_id')
      .eq('id', record.id)
      .eq('user_id', session.user.id)
      .maybeSingle()
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
      const { data: updatedJob, error: updateError } = await supabase
        .from('jobs')
        .update(draftToPayload(sentDraft))
        .eq('id', job.id)
        .eq('version', job.version)
        .select('id, version')
        .maybeSingle()

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
      const parsed = JSON.parse(await file.text()) as { opportunityDeskVersion?: unknown; jobs?: unknown }
      if (!Array.isArray(parsed.jobs) || (parsed.opportunityDeskVersion !== undefined && parsed.opportunityDeskVersion !== 1)) {
        throw new Error('This is not a recognized Opportunity Desk backup.')
      }
      if (parsed.jobs.length > 1000) throw new Error('This backup is too large to import safely in one step.')
      const isLegacyBackup = parsed.opportunityDeskVersion === undefined
      const importDescription = isLegacyBackup ? 'The older backup will be converted and added as new synchronized records.' : 'Matching records will be updated.'
      if (!window.confirm(`Import ${parsed.jobs.length} applications? ${importDescription}`)) return

      const rows = parsed.jobs.map((candidate) => {
        if (!candidate || typeof candidate !== 'object') throw new Error('The backup contains an invalid application.')
        if (isLegacyBackup) {
          const legacy = candidate as Record<string, unknown>
          if (typeof legacy.company !== 'string' || !legacy.company.trim()) throw new Error('The older backup contains an application without a company.')
          const legacyDraft: JobDraft = {
            ...EMPTY_JOB,
            company: legacy.company,
            role_title: typeof legacy.role === 'string' && legacy.role.trim() ? legacy.role : 'Role not specified',
            status: legacyStatus(legacy.status),
            priority: legacyPriority(legacy.priority),
            work_mode: legacyWorkMode(legacy.mode),
            location: typeof legacy.location === 'string' ? legacy.location : '',
            job_url: typeof legacy.url === 'string' ? legacy.url : '',
            source: typeof legacy.source === 'string' ? legacy.source : '',
            salary_text: typeof legacy.salary === 'string' ? legacy.salary : '',
            contact_name: typeof legacy.contact === 'string' ? legacy.contact : '',
            contact_email: typeof legacy.email === 'string' ? legacy.email : '',
            applied_at: typeof legacy.applied === 'string' ? legacy.applied : '',
            next_action: typeof legacy.next === 'string' ? legacy.next : '',
            next_action_at: typeof legacy.nextDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(legacy.nextDate) ? `${legacy.nextDate}T09:00` : '',
            job_description: typeof legacy.jobDesc === 'string' ? legacy.jobDesc : '',
            notes: typeof legacy.notes === 'string' ? legacy.notes : '',
            email_recipient: typeof legacy.sendto === 'string' ? legacy.sendto : (typeof legacy.email === 'string' ? legacy.email : ''),
            email_subject: typeof legacy.emailSubject === 'string' ? legacy.emailSubject : '',
            email_body: typeof legacy.emailBody === 'string' ? legacy.emailBody : '',
          }
          return { user_id: session.user.id, ...draftToPayload(legacyDraft) }
        }

        const job = candidate as Partial<Job>
        if (!job.id || !job.company || !job.role_title || !isJobStatus(job.status) || !isPriority(job.priority) || !isWorkMode(job.work_mode)) throw new Error('The backup contains an incomplete application.')
        return {
          id: job.id,
          user_id: session.user.id,
          ...draftToPayload({
            ...EMPTY_JOB,
            company: job.company,
            role_title: job.role_title,
            status: job.status,
            priority: job.priority,
            work_mode: job.work_mode,
            location: job.location ?? '',
            job_url: job.job_url ?? '',
            source: job.source ?? '',
            salary_text: job.salary_text ?? '',
            contact_name: job.contact_name ?? '',
            contact_email: job.contact_email ?? '',
            applied_at: job.applied_at ?? '',
            next_action: job.next_action ?? '',
            next_action_at: toLocalDateTimeInput(job.next_action_at ?? null),
            job_description: job.job_description ?? '',
            notes: job.notes ?? '',
            external_job_id: job.external_job_id ?? '',
            email_recipient: job.email_recipient ?? '',
            email_subject: job.email_subject ?? '',
            email_body: job.email_body ?? '',
            cv_id: job.cv_id && cvs.some((cv) => cv.id === job.cv_id) ? job.cv_id : '',
          }),
          data: job.data ?? {},
        }
      })

      const importQuery = isLegacyBackup
        ? supabase.from('jobs').insert(rows)
        : supabase.from('jobs').upsert(rows, { onConflict: 'id' })
      const { error: importError } = await importQuery
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
        const { error: uploadError } = await supabase.storage.from('cvs').upload(uploadedPath, file, {
          cacheControl: '3600',
          contentType: mimeType,
          upsert: false,
        })
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
        ? await supabase.from('cvs').insert({ id: cvId, user_id: session.user.id, data: {}, ...payload }).select('id, version').maybeSingle()
        : await supabase.from('cvs').update(payload).eq('id', recordBeingEdited.id).eq('version', recordBeingEdited.version).select('id, version').maybeSingle()

      if (result.error) throw result.error
      if (!result.data && recordBeingEdited !== 'new') {
        if (uploadedPath && uploadCompleted) {
          await supabase.storage.from('cvs').remove([uploadedPath])
          uploadedPath = null
          uploadCompleted = false
        }
        const { data: latest, error: latestError } = await supabase.from('cvs').select('version').eq('id', recordBeingEdited.id).maybeSingle()
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
        const { error: cleanupError } = await supabase.storage.from('cvs').remove([recordBeingEdited.storage_path])
        if (cleanupError) cleanupWarning = ' The older file could not be removed automatically.'
      }
      uploadedPath = null
      uploadCompleted = false
      setEditingCV(null)
      setNotice(`CV saved and synchronized.${cleanupWarning}`)
      await loadWorkspace()
    } catch (caught) {
      if (uploadedPath && uploadCompleted) await supabase.storage.from('cvs').remove([uploadedPath])
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
    const { data, error: downloadError } = await supabase.storage.from('cvs').download(cv.storage_path)
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
    const { data, error: updateError } = await supabase
      .from('jobs')
      .update({ cv_id: cvId })
      .eq('id', job.id)
      .eq('version', job.version)
      .select('id')
      .maybeSingle()
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
    const { data, error: insertError } = await supabase
      .from('jobs')
      .insert({ ...payload, user_id: session.user.id })
      .select('id')
      .maybeSingle()

    if (insertError?.code === '23505') setNotice('This vacancy was already saved on another device.')
    else if (insertError) setError(insertError.message)
    else if (!data) setError('The vacancy could not be saved. Please try again.')
    else setNotice(`${result.title} at ${result.company} was saved to your tracker.`)
    await loadWorkspace()
    setBusy(false)
  }

  async function deleteCV(cv: CV) {
    const linkedApplications = jobs.filter((job) => job.cv_id === cv.id).length
    const linkWarning = linkedApplications ? ` ${linkedApplications} linked application${linkedApplications === 1 ? '' : 's'} will keep their records but lose this CV link.` : ''
    if (!window.confirm(`Delete ${cv.name}? This removes its saved file and cannot be undone.${linkWarning}`)) return
    setBusy(true)
    setError('')
    setNotice('')
    const { data, error: deleteError } = await supabase.from('cvs').delete().eq('id', cv.id).eq('version', cv.version).select('id').maybeSingle()
    if (deleteError) setError(deleteError.message)
    else if (!data) setError('This CV changed or was deleted on another device. The latest library has been loaded; please review it and try again.')
    else {
      let cleanupWarning = ''
      if (cv.storage_path) {
        const { error: cleanupError } = await supabase.storage.from('cvs').remove([cv.storage_path])
        if (cleanupError) cleanupWarning = ' Its database record was deleted, but the stored file could not be cleaned up automatically.'
      }
      setNotice(`CV deleted.${cleanupWarning}`)
    }
    await loadWorkspace()
    setBusy(false)
  }

  async function enableNotifications() {
    if (!('Notification' in window)) {
      setError('This browser does not support desktop notifications.')
      return
    }
    const permission = await Notification.requestPermission()
    setNotice(permission === 'granted' ? 'Browser reminders are enabled on this device.' : 'Notification permission was not granted.')
  }

  async function signOutWorkspace() {
    clearGoogleAccess()
    setGoogleConnected(false)
    await supabase.auth.signOut()
  }

  const openEditor = (job: Job) => { setError(''); setEditing(job) }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><span className="brand-mark small">EZ</span><div><strong>Opportunity Desk</strong><span>Career workspace</span></div></div>
        <nav aria-label="Main navigation">
          {NAV_ITEMS.map((item) => (
            <button key={item.view} className={view === item.view ? 'nav-item active' : 'nav-item'} onClick={() => setView(item.view)}>
              <span aria-hidden="true">{item.symbol}</span>{item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-account"><span>{session.user.email}</span><span>{googleConnected ? 'Google connected' : settings?.google_client_id ? 'Google ready' : 'Google not configured'}</span><button className="button ghost" onClick={() => void signOutWorkspace()}>Sign out</button></div>
      </aside>

      <div className="workspace-shell">
        <header className="mobile-topbar"><strong>Opportunity Desk</strong><button className="button ghost" onClick={() => void signOutWorkspace()}>Sign out</button></header>
        <div className="mobile-nav" aria-label="Mobile navigation">{NAV_ITEMS.map((item) => <button key={item.view} className={view === item.view ? 'active' : ''} onClick={() => setView(item.view)}>{item.label}</button>)}</div>
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
              {view === 'dashboard' && <DashboardView jobs={jobs} counts={counts} reminders={reminders} onEdit={openEditor} onViewAll={() => setView('applications')} />}
              {view === 'board' && <BoardView jobs={jobs} cvs={cvs} busy={busy} onEdit={openEditor} onStatus={changeStatus} onCV={changeJobCV} />}
              {view === 'applications' && <ApplicationsView jobs={visibleJobs} cvs={cvs} sends={applicationSends} total={jobs.length} search={search} filter={filter} busy={busy} onSearch={setSearch} onFilter={setFilter} onEdit={openEditor} onTailor={(job) => { setError(''); setNotice(''); setTailoringJob(job) }} onDelete={deleteJob} onDownloadCV={downloadCV} />}
              {view === 'reminders' && <RemindersView jobs={reminders} contacts={contactReminders} outreach={outreachReminders} onEdit={openEditor} onEditContact={(contact) => { setError(''); setEditingContact(contact) }} onOpenOutreach={(email) => { setError(''); setEditingOutreach(email) }} onEnable={enableNotifications} />}
              {view === 'outreach' && <OutreachView emails={outreachEmails} busy={busy} onCompose={() => { setError(''); setNotice(''); setEditingOutreach('new') }} onOpen={(email) => { setError(''); setNotice(''); setEditingOutreach(email) }} onDelete={deleteOutreach} />}
              {view === 'contacts' && <ContactsView contacts={contacts} jobs={jobs} busy={busy} onAdd={() => { setError(''); setEditingContact('new') }} onEdit={(contact) => { setError(''); setEditingContact(contact) }} onDelete={deleteContact} onStage={changeContactStage} />}
              {view === 'interviews' && <InterviewPrepView jobs={jobs} preps={interviewPreps} stories={starStories} busy={busy} onSavePrep={saveInterviewPrep} onAddStory={() => { setError(''); setEditingStar('new') }} onViewStory={(story) => { setError(''); setViewingStar(story) }} onEditStory={(story) => { setError(''); setEditingStar(story) }} onDeleteStory={deleteStarStory} />}
              {view === 'analytics' && <AnalyticsView jobs={jobs} contacts={contacts} cvs={cvs} stageEvents={stageEvents} />}
              {view === 'backup' && <BackupView jobs={jobs} busy={busy} onJson={exportJson} onCsv={exportCsv} onImport={importJson} />}
              {view === 'settings' && settings && <SettingsView settings={settings} busy={busy} googleConnected={googleConnected} onSave={saveSettings} onConnectGoogle={connectGoogle} onEnableNotifications={enableNotifications} />}
              {view === 'cvs' && <CVLibrary cvs={cvs} blocks={cvBlocks} busy={busy} onAdd={() => { setError(''); setEditingCV('new') }} onEdit={(cv) => { setError(''); setEditingCV(cv) }} onDownload={downloadCV} onDelete={deleteCV} onBuild={() => { setError(''); setNotice(''); setBuildingCV(true) }} onAddBlock={() => { setError(''); setEditingBlock('new') }} onEditBlock={(block) => { setError(''); setEditingBlock(block) }} onDeleteBlock={deleteCVBlock} />}
              {view === 'search' && <JobSearch jobs={jobs} busy={busy} onSave={saveSearchResult} />}
            </>
          )}
        </main>
      </div>

      {editing && <JobForm initial={editing === 'new' ? EMPTY_JOB : toDraft(editing)} title={editing === 'new' ? 'Add an opportunity' : 'Update application'} busy={busy} error={error} cvs={cvs} existing={editing !== 'new'} googleConfigured={Boolean(settings?.google_client_id)} sendHistoryPending={Boolean(pendingSendHistory)} sendHistory={editing === 'new' ? [] : applicationSends.filter((send) => send.job_id === editing.id)} onCancel={() => { setError(''); setEditing(null) }} onSave={saveJob} onTailor={saveAndOpenTailoring} onCalendar={addToGoogleCalendar} onSend={sendApplicationEmail} onRetrySendHistory={retrySendHistory} replies={editing === 'new' ? [] : emailReplies.filter((reply) => reply.source_type === 'job' && reply.source_id === editing.id)} onCheckReplies={() => checkJobReplies(editing as Job)} />}
      {editingContact && <ContactForm initial={editingContact === 'new' ? EMPTY_CONTACT : contactToDraft(editingContact)} title={editingContact === 'new' ? 'Add a contact' : 'Update contact'} busy={busy} error={error} jobs={jobs} existing={editingContact !== 'new'} interactions={editingContact === 'new' ? [] : contactHistory} onCancel={() => { setError(''); setEditingContact(null) }} onSave={saveContact} onLogInteraction={logInteraction} onDeleteInteraction={deleteInteraction} />}
      {editingStar && <StarStoryForm initial={editingStar === 'new' ? EMPTY_STAR_STORY : starStoryToDraft(editingStar)} title={editingStar === 'new' ? 'Add a STAR story' : 'Update STAR story'} busy={busy} error={error} onCancel={() => { setError(''); setEditingStar(null) }} onSave={saveStarStory} />}
      {viewingStar && !editingStar && <StarStoryView story={starStories.find((story) => story.id === viewingStar.id) ?? viewingStar} onClose={() => setViewingStar(null)} onEdit={(story) => { setViewingStar(null); setError(''); setEditingStar(story) }} />}
      {editingOutreach && <OutreachForm
        key={editingOutreach === 'new' ? 'new' : editingOutreach.id}
        initial={editingOutreach === 'new' ? EMPTY_OUTREACH : outreachToDraft(editingOutreach)}
        sent={editingOutreach !== 'new' && editingOutreach.status === 'sent' ? editingOutreach : null}
        inFlight={editingOutreach !== 'new' && editingOutreach.status === 'sending' ? editingOutreach : null}
        title={editingOutreach === 'new' ? 'Write to a company' : editingOutreach.status === 'sent' ? 'Email as sent' : editingOutreach.status === 'sending' ? 'Send outcome unknown' : 'Outreach draft'}
        busy={busy}
        error={error}
        cvs={cvs}
        contacts={contacts}
        googleConfigured={Boolean(settings?.google_client_id)}
        syncPending={Boolean(pendingOutreach) && (editingOutreach === 'new' || pendingOutreach?.outreach_id === editingOutreach.id)}
        onCancel={() => { setError(''); setEditingOutreach(null) }}
        onSaveDraft={saveOutreachDraft}
        onSend={sendOutreach}
        onUpdateOutcome={updateOutreachOutcome}
        onRetrySync={retryOutreachSync}
        onResolveAttempt={resolveOutreachAttempt}
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

function DashboardView({ jobs, counts, reminders, onEdit, onViewAll }: { jobs: Job[]; counts: { active: number; interviews: number; offers: number; followUps: number }; reminders: Job[]; onEdit: (job: Job) => void; onViewAll: () => void }) {
  const maximum = Math.max(1, ...JOB_STATUSES.map((status) => jobs.filter((job) => job.status === status).length))
  return (
    <>
      <section className="metrics" aria-label="Application summary">
        <article><span>Active pipeline</span><strong>{counts.active}</strong></article>
        <article><span>Interview stages</span><strong>{counts.interviews}</strong></article>
        <article><span>Offers</span><strong>{counts.offers}</strong></article>
        <article><span>Actions this week</span><strong>{counts.followUps}</strong></article>
      </section>
      <div className="dashboard-grid">
        <section className="workspace-card panel">
          <div className="panel-head"><div><p className="eyebrow">Pipeline</p><h2>Stage overview</h2></div><button className="button ghost" onClick={onViewAll}>View all</button></div>
          <div className="pipeline-chart">{JOB_STATUSES.filter((status) => jobs.some((job) => job.status === status)).map((status) => { const count = jobs.filter((job) => job.status === status).length; return <div className="pipeline-row" key={status}><span>{STATUS_LABELS[status]}</span><div><i style={{ width: `${(count / maximum) * 100}%` }} /></div><strong>{count}</strong></div> })}{jobs.length === 0 && <div className="compact-empty">Add an application to see your pipeline.</div>}</div>
        </section>
        <section className="workspace-card panel">
          <div className="panel-head"><div><p className="eyebrow">Needs attention</p><h2>Next actions</h2></div></div>
          <div className="attention-list">{reminders.slice(0, 5).map((job) => <button key={job.id} onClick={() => onEdit(job)}><span><strong>{job.next_action || 'Follow up'}</strong><small>{job.role_title} · {job.company}</small></span><em className={new Date(job.next_action_at!).getTime() < Date.now() ? 'overdue' : ''}>{relativeDueLabel(job.next_action_at!)}</em></button>)}{reminders.length === 0 && <div className="compact-empty">No follow-ups are scheduled.</div>}</div>
        </section>
      </div>
    </>
  )
}

function BoardView({ jobs, cvs, busy, onEdit, onStatus, onCV }: { jobs: Job[]; cvs: CV[]; busy: boolean; onEdit: (job: Job) => void; onStatus: (job: Job, status: JobStatus) => Promise<void>; onCV: (job: Job, cvId: string | null) => Promise<void> }) {
  const [dragOverJobId, setDragOverJobId] = useState<string | null>(null)

  function startCVDrag(event: DragEvent<HTMLElement>, cv: CV) {
    event.dataTransfer.effectAllowed = 'link'
    event.dataTransfer.setData('application/x-opportunity-desk-cv', cv.id)
    event.dataTransfer.setData('text/plain', cv.id)
  }

  function dropCV(event: DragEvent<HTMLElement>, job: Job) {
    event.preventDefault()
    setDragOverJobId(null)
    const cvId = event.dataTransfer.getData('application/x-opportunity-desk-cv') || event.dataTransfer.getData('text/plain')
    if (cvs.some((cv) => cv.id === cvId)) void onCV(job, cvId)
  }

  return (
    <>
      <section className="cv-drag-panel workspace-card" aria-label="CVs available to link">
        <div><p className="eyebrow">CV assignment</p><h2>Drag a CV onto an opportunity</h2><span>On phones or with a keyboard, use the CV selector inside each card.</span></div>
        <div className="cv-drag-list">{cvs.map((cv) => <article className="cv-drag-chip" key={cv.id} draggable={!busy} onDragStart={(event) => startCVDrag(event, cv)} onDragEnd={() => setDragOverJobId(null)}><strong>{cv.name}</strong><span>{cv.tailored_company || cv.target_role || 'General CV'}</span></article>)}{cvs.length === 0 && <span className="compact-empty">Add a CV in the CV library before linking one.</span>}</div>
      </section>
      <section className="kanban" aria-label="Application board">{BOARD_COLUMNS.map((column) => {
        const columnJobs = jobs.filter((job) => column.statuses.includes(job.status))
        return <div className="kanban-column" key={column.title}><div className="kanban-head"><strong>{column.title}</strong><span>{columnJobs.length}</span></div><div className="kanban-cards">{columnJobs.map((job) => {
          const linkedCV = cvs.find((cv) => cv.id === job.cv_id)
          return <article className={dragOverJobId === job.id ? 'kanban-card cv-drop-active' : 'kanban-card'} key={job.id} onDragOver={(event) => { if (!busy && cvs.length) { event.preventDefault(); event.dataTransfer.dropEffect = 'link'; setDragOverJobId(job.id) } }} onDragLeave={() => setDragOverJobId((current) => current === job.id ? null : current)} onDrop={(event) => dropCV(event, job)}><JobBadges job={job} /><button className="card-title" onClick={() => onEdit(job)}><strong>{job.role_title}</strong><span>{job.company}</span></button>{job.next_action_at && <small>{job.next_action || 'Next action'} · {relativeDueLabel(job.next_action_at)}</small>}<div className={linkedCV ? 'linked-cv' : 'linked-cv empty'}><strong>{linkedCV ? linkedCV.name : 'Drop a CV here'}</strong><span>{linkedCV ? linkedCV.tailored_company ? `Tailored for ${linkedCV.tailored_company}` : linkedCV.original_filename || 'Text-only CV' : 'or choose one below'}</span></div><label className="compact-select">CV used<select disabled={busy} value={job.cv_id ?? ''} onChange={(event) => void onCV(job, event.target.value || null)}><option value="">No CV linked</option>{cvs.map((cv) => <option key={cv.id} value={cv.id}>{cv.name}{cv.tailored_company ? ` — ${cv.tailored_company}` : ''}</option>)}</select></label><label className="compact-select">Move to<select disabled={busy} value={job.status} onChange={(event) => void onStatus(job, event.target.value as JobStatus)}>{JOB_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</select></label></article>
        })}{columnJobs.length === 0 && <div className="column-empty">No applications</div>}</div></div>
      })}</section>
    </>
  )
}

function ApplicationsView({ jobs, cvs, sends, total, search, filter, busy, onSearch, onFilter, onEdit, onTailor, onDelete, onDownloadCV }: { jobs: Job[]; cvs: CV[]; sends: ApplicationSend[]; total: number; search: string; filter: 'all' | JobStatus; busy: boolean; onSearch: (value: string) => void; onFilter: (value: 'all' | JobStatus) => void; onEdit: (job: Job) => void; onTailor: (job: Job) => void; onDelete: (job: Job) => Promise<void>; onDownloadCV: (cv: CV) => Promise<void> }) {
  return <section className="workspace-card"><div className="workspace-head"><div><p className="eyebrow">Your pipeline</p><h2>{total} applications</h2></div><div className="controls"><input aria-label="Search applications" placeholder="Search company, role or notes" value={search} onChange={(event) => onSearch(event.target.value)} /><select aria-label="Filter by status" value={filter} onChange={(event) => onFilter(event.target.value as 'all' | JobStatus)}><option value="all">All statuses</option>{JOB_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</select></div></div>{jobs.length === 0 ? <div className="empty-state"><strong>{total ? 'No matching applications' : 'Your pipeline is ready'}</strong><span>{total ? 'Try a different search or status.' : 'Add your first opportunity to start tracking it across devices.'}</span></div> : <div className="table-wrap"><table><thead><tr><th>Opportunity</th><th>Stage</th><th>CV used</th><th>Follow-up</th><th>Updated</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{jobs.map((job) => { const linkedCV = cvs.find((cv) => cv.id === job.cv_id); const lastSend = sends.find((send) => send.job_id === job.id && send.status === 'sent'); return <tr key={job.id}><td><strong>{job.role_title}</strong><span>{job.company}{job.location ? ` · ${job.location}` : ''}</span></td><td><JobBadges job={job} /></td><td>{linkedCV ? <><strong>{linkedCV.name}</strong><span>{linkedCV.tailored_company ? `Tailored for ${linkedCV.tailored_company}` : linkedCV.original_filename || 'Text-only CV'}</span>{linkedCV.storage_path && <button className="button ghost table-download" disabled={busy} onClick={() => void onDownloadCV(linkedCV)}>Download</button>}</> : <span>No CV linked</span>}{lastSend && <span className="sent-summary">Sent {formatDateTime(lastSend.sent_at)} to {lastSend.recipient}</span>}</td><td>{job.next_action_at ? <><strong>{job.next_action || 'Follow up'}</strong><span>{formatDateTime(job.next_action_at)}</span></> : <span>Not scheduled</span>}</td><td>{formatDateTime(job.updated_at)}</td><td><div className="row-actions">{job.job_url && <a className="button ghost" href={job.job_url} target="_blank" rel="noreferrer">Open</a>}<button className="button secondary" disabled={busy} onClick={() => onTailor(job)}>Tailor CV</button><button className="button secondary" onClick={() => onEdit(job)}>Edit</button><button className="button danger" disabled={busy} onClick={() => void onDelete(job)}>Delete</button></div></td></tr> })}</tbody></table></div>}</section>
}

function RemindersView({ jobs, contacts, outreach, onEdit, onEditContact, onOpenOutreach, onEnable }: { jobs: Job[]; contacts: Contact[]; outreach: OutreachEmail[]; onEdit: (job: Job) => void; onEditContact: (contact: Contact) => void; onOpenOutreach: (email: OutreachEmail) => void; onEnable: () => Promise<void> }) {
  return (
    <>
      <section className="workspace-card"><div className="workspace-head"><div><p className="eyebrow">Follow-up queue</p><h2>{jobs.length} scheduled actions</h2></div><button className="button secondary" onClick={() => void onEnable()}>Enable browser alerts</button></div>{jobs.length === 0 ? <div className="empty-state"><strong>Nothing is due</strong><span>Add a next action and date to an application to see it here.</span></div> : <div className="reminder-list">{jobs.map((job) => <button key={job.id} onClick={() => onEdit(job)}><time dateTime={job.next_action_at!}>{formatDateTime(job.next_action_at!)}</time><span><strong>{job.next_action || 'Follow up'}</strong><small>{job.role_title} at {job.company}</small></span><em className={new Date(job.next_action_at!).getTime() < Date.now() ? 'overdue' : ''}>{relativeDueLabel(job.next_action_at!)}</em></button>)}</div>}</section>
      {contacts.length > 0 && <section className="workspace-card"><div className="workspace-head"><div><p className="eyebrow">Networking</p><h2>{contacts.length} networking follow-ups</h2></div></div><div className="reminder-list">{contacts.map((contact) => <button key={contact.id} onClick={() => onEditContact(contact)}><time dateTime={contact.next_action_at!}>{formatDateTime(contact.next_action_at!)}</time><span><strong>{contact.next_action || 'Follow up'}</strong><small>{contact.name}{contact.company ? ` · ${contact.company}` : ''}</small></span><em className={new Date(contact.next_action_at!).getTime() < Date.now() ? 'overdue' : ''}>{relativeDueLabel(contact.next_action_at!)}</em></button>)}</div></section>}
      {outreach.length > 0 && <section className="workspace-card"><div className="workspace-head"><div><p className="eyebrow">Speculative outreach</p><h2>{outreach.length} unanswered message{outreach.length === 1 ? '' : 's'}</h2></div></div><div className="reminder-list">{outreach.map((email) => <button key={email.id} onClick={() => onOpenOutreach(email)}><time dateTime={email.follow_up_at!}>{formatDateTime(email.follow_up_at!)}</time><span><strong>Follow up on “{email.subject}”</strong><small>{email.company}{email.recipient_name ? ` · ${email.recipient_name}` : ''}</small></span><em className={new Date(email.follow_up_at!).getTime() < Date.now() ? 'overdue' : ''}>{relativeDueLabel(email.follow_up_at!)}</em></button>)}</div></section>}
    </>
  )
}

function CVLibrary({ cvs, blocks, busy, onAdd, onEdit, onDownload, onDelete, onBuild, onAddBlock, onEditBlock, onDeleteBlock }: { cvs: CV[]; blocks: CVBlock[]; busy: boolean; onAdd: () => void; onEdit: (cv: CV) => void; onDownload: (cv: CV) => Promise<void>; onDelete: (cv: CV) => Promise<void>; onBuild: () => void; onAddBlock: () => void; onEditBlock: (block: CVBlock) => void; onDeleteBlock: (block: CVBlock) => Promise<void> }) {
  const [search, setSearch] = useState('')
  const filteredCVs = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return cvs
    return cvs.filter((cv) => [cv.name, cv.tailored_company ?? '', cv.target_role ?? '', cv.notes ?? '', cv.plain_text ?? ''].some((value) => value.toLowerCase().includes(needle)))
  }, [cvs, search])

  return (
    <>
    <section className="workspace-card">
      <div className="workspace-head"><div><p className="eyebrow">Secure document workspace</p><h2>{cvs.length} CV versions</h2></div><div className="controls"><button className="button primary" onClick={onBuild}>Build CV for a role</button><input aria-label="Search CVs" placeholder="Search name, company, role, notes, or text" value={search} onChange={(event) => setSearch(event.target.value)} /></div></div>
      {filteredCVs.length === 0 ? <div className="empty-state"><strong>{cvs.length ? 'No matching CVs' : 'Build your CV library'}</strong><span>{cvs.length ? 'Try a different search.' : 'Upload a document, paste a text version, or use both. Your private library will follow your account to every device.'}</span>{!cvs.length && <button className="button primary" onClick={onAdd}>Add your first CV</button>}</div> : (
        <div className="cv-grid">{filteredCVs.map((cv) => (
          <article className="cv-card" key={cv.id}>
            <div className="cv-card-head"><span className="cv-file-mark" aria-hidden="true">CV</span><div><h3>{cv.name}</h3><p>{cv.tailored_company ? `Tailored for ${cv.tailored_company}` : cv.target_role || 'General CV'}</p></div></div>
            <div className="cv-meta"><span>{cv.storage_path ? cv.original_filename || 'Stored file' : 'Text-only version'}</span>{cv.size_bytes != null && <span>{formatFileSize(cv.size_bytes)}</span>}<span>Updated {formatDateTime(cv.updated_at)}</span></div>
            {cv.notes && <p className="cv-notes">{cv.notes}</p>}
            {cv.plain_text && <p className="cv-preview">{cv.plain_text.slice(0, 180)}{cv.plain_text.length > 180 ? '…' : ''}</p>}
            <div className="cv-actions">{cv.storage_path && <button className="button secondary" disabled={busy} onClick={() => void onDownload(cv)}>Download</button>}<button className="button secondary" disabled={busy} onClick={() => onEdit(cv)}>Edit</button><button className="button danger" disabled={busy} onClick={() => void onDelete(cv)}>Delete</button></div>
          </article>
        ))}</div>
      )}
    </section>

    <section className="workspace-card">
      <div className="workspace-head">
        <div><p className="eyebrow">Reusable content</p><h2>{blocks.length} CV blocks</h2></div>
        <button className="button secondary" onClick={onAddBlock}>+ Add block</button>
      </div>
      {blocks.length === 0 ? (
        <div className="empty-state">
          <strong>Write each part once</strong>
          <span>Save your summary, skills, roles and qualifications as blocks. The builder combines them with your STAR stories into a CV aimed at a specific role, using only text you have written.</span>
          <button className="button primary" onClick={onAddBlock}>Add your first block</button>
        </div>
      ) : (
        <div className="cv-grid">{blocks.map((block) => (
          <article className="cv-card" key={block.id}>
            <div className="cv-card-head"><span className="cv-file-mark" aria-hidden="true">§</span><div><h3>{block.title}</h3><p>{CV_BLOCK_TYPE_LABELS[block.block_type]}{block.tags ? ` · ${block.tags}` : ''}</p></div></div>
            <p className="cv-preview">{block.content.slice(0, 200)}{block.content.length > 200 ? '…' : ''}</p>
            <div className="cv-actions">
              <button className="button secondary" disabled={busy} onClick={() => onEditBlock(block)}>Edit</button>
              <button className="button danger" disabled={busy} onClick={() => void onDeleteBlock(block)}>Delete</button>
            </div>
          </article>
        ))}</div>
      )}
    </section>
    </>
  )
}

function BackupView({ jobs, busy, onJson, onCsv, onImport }: { jobs: Job[]; busy: boolean; onJson: () => void; onCsv: () => void; onImport: (event: ChangeEvent<HTMLInputElement>) => Promise<void> }) {
  return <div className="settings-grid"><section className="workspace-card panel"><p className="eyebrow">Portable application copy</p><h2>Export applications</h2><p>Download application records as a restorable JSON file or a CSV spreadsheet. CV files remain protected in the separate private library. Contacts and interview preparation are not yet part of this backup.</p><div className="button-row"><button className="button primary" onClick={onJson}>Download JSON backup</button><button className="button secondary" onClick={onCsv}>Download CSV</button></div></section><section className="workspace-card panel"><p className="eyebrow">Restore applications</p><h2>Import a backup</h2><p>Import a JSON file created by this version of Opportunity Desk. Matching application IDs are updated; new ones are added.</p><label className={busy ? 'button secondary file-button disabled' : 'button secondary file-button'}>{busy ? 'Importing…' : 'Choose JSON backup'}<input type="file" accept="application/json,.json" disabled={busy} onChange={(event) => void onImport(event)} /></label><small>{jobs.length} applications are currently synchronized.</small></section></div>
}

function SettingsView({ settings, busy, googleConnected, onSave, onConnectGoogle, onEnableNotifications }: { settings: UserSettings; busy: boolean; googleConnected: boolean; onSave: (draft: SettingsDraft) => Promise<void>; onConnectGoogle: (clientId: string) => Promise<void>; onEnableNotifications: () => Promise<void> }) {
  const settingsDraft = (value: UserSettings): SettingsDraft => ({ default_view: value.default_view, reminders_enabled: value.reminders_enabled, reminder_lead_hours: value.reminder_lead_hours, timezone: value.timezone, google_client_id: value.google_client_id ?? '', email_reminders_enabled: value.email_reminders_enabled, email_reminder_hour: value.email_reminder_hour })
  const [draft, setDraft] = useState<SettingsDraft>(() => settingsDraft(settings))
  useEffect(() => setDraft(settingsDraft(settings)), [settings])
  return (
    <section className="workspace-card settings-form">
      <div><p className="eyebrow">Synchronized preferences</p><h2>Workspace settings</h2><p>These preferences follow your account to every device. Browser notification permission and short-lived Google access are still approved separately in each browser.</p></div>
      <label>Start page<select value={draft.default_view} onChange={(event) => setDraft({ ...draft, default_view: event.target.value as DefaultView })}>{APP_VIEWS.filter((candidate): candidate is DefaultView => ['dashboard', 'board', 'applications', 'reminders', 'cvs'].includes(candidate)).map((candidate) => <option value={candidate} key={candidate}>{viewTitle(candidate)}</option>)}</select></label>
      <label>Timezone<input value={draft.timezone} onChange={(event) => setDraft({ ...draft, timezone: event.target.value })} /></label>
      <label>Reminder lead time<select value={draft.reminder_lead_hours} onChange={(event) => setDraft({ ...draft, reminder_lead_hours: Number(event.target.value) })}><option value={0}>At the due time</option><option value={1}>1 hour before</option><option value={6}>6 hours before</option><option value={24}>1 day before</option><option value={72}>3 days before</option><option value={168}>1 week before</option></select></label>
      <label className="check-label"><input type="checkbox" checked={draft.reminders_enabled} onChange={(event) => setDraft({ ...draft, reminders_enabled: event.target.checked })} />Show reminders while Opportunity Desk is open</label>
      <div className="settings-divider"><p className="eyebrow">Email reminders</p><h3>{draft.email_reminders_enabled ? 'One daily digest of due follow-ups' : 'Off — reminders only appear in the browser'}</h3><p>A server function checks hourly and sends at most one email per day, in your timezone, listing application and networking follow-ups that are newly due. Nothing is sent while there is nothing due.</p></div>
      <label className="check-label"><input type="checkbox" checked={draft.email_reminders_enabled} onChange={(event) => setDraft({ ...draft, email_reminders_enabled: event.target.checked })} />Email me due follow-ups at my account address</label>
      <label>Delivery hour<select value={draft.email_reminder_hour} onChange={(event) => setDraft({ ...draft, email_reminder_hour: Number(event.target.value) })}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}</select><small>Local to the timezone above. Delivery also requires the server email secrets described in the developer notes.</small></label>
      <div className="settings-divider"><p className="eyebrow">Google Calendar and Gmail</p><h3>{googleConnected ? 'Connected for this session' : 'Connection ready when you are'}</h3><p>The OAuth client ID is public and synchronizes with your account. Google access tokens are short-lived and stay only in this browser's memory.</p></div>
      <label>Google OAuth client ID<input value={draft.google_client_id} onChange={(event) => setDraft({ ...draft, google_client_id: event.target.value })} placeholder="123456789-example.apps.googleusercontent.com" /><small>Enable the Google Calendar API and Gmail API, then use a Web application client whose authorized JavaScript origin includes this site.</small></label>
      <details className="setup-guide"><summary>Google Cloud setup</summary><ol><li>Create or open a project in <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Google Cloud Console</a>.</li><li>Enable Google Calendar API and Gmail API.</li><li>Configure the OAuth consent screen and add your Google address as a test user if the app is in testing.</li><li>Create a Web application OAuth client and add <code>{window.location.origin}</code> as an authorized JavaScript origin.</li><li>Paste the client ID above, save settings, and connect Google.</li></ol></details>
      <div className="button-row"><button className="button primary" disabled={busy} onClick={() => void onSave(draft)}>{busy ? 'Saving…' : 'Save settings'}</button><button className="button secondary" disabled={busy || !draft.google_client_id.trim()} onClick={() => void onConnectGoogle(draft.google_client_id)}>{googleConnected ? 'Reconnect Google' : 'Connect Google'}</button><button className="button secondary" onClick={() => void onEnableNotifications()}>Allow browser notifications</button></div>
    </section>
  )
}
