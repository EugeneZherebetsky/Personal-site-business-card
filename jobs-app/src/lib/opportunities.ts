import {
  JOB_STATUSES,
  PRIORITIES,
  WORK_MODES,
  type Job,
  type JobDraft,
  type JobPriority,
  type JobStatus,
  type WorkMode,
} from '../types'
import { canonicalSource } from './naming'

export const ACTIVE_STATUSES: JobStatus[] = [
  'saved',
  'applied',
  'phone_screen',
  'interviewing',
  'assessment',
  'final_round',
  'offer',
  'on_hold',
]

export const BOARD_COLUMNS: Array<{ title: string; statuses: JobStatus[] }> = [
  { title: 'Saved', statuses: ['saved'] },
  { title: 'Applied', statuses: ['applied'] },
  { title: 'Conversations', statuses: ['phone_screen', 'interviewing'] },
  { title: 'Final stages', statuses: ['assessment', 'final_round', 'offer'] },
  { title: 'On hold', statuses: ['on_hold'] },
  { title: 'Complete', statuses: ['accepted', 'rejected', 'withdrawn', 'closed'] },
]

export function clean(value: string) {
  const trimmed = value.trim()
  return trimmed || null
}

export function toLocalDateTimeInput(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function toDraft(job: Job): JobDraft {
  return {
    company: job.company,
    role_title: job.role_title,
    status: job.status,
    work_mode: job.work_mode,
    priority: job.priority,
    location: job.location ?? '',
    job_url: job.job_url ?? '',
    source: job.source ?? '',
    salary_text: job.salary_text ?? '',
    contact_name: job.contact_name ?? '',
    contact_email: job.contact_email ?? '',
    applied_at: job.applied_at ?? '',
    next_action: job.next_action ?? '',
    next_action_at: toLocalDateTimeInput(job.next_action_at),
    job_description: job.job_description ?? '',
    notes: job.notes ?? '',
    external_job_id: job.external_job_id ?? '',
    email_recipient: job.email_recipient ?? '',
    email_subject: job.email_subject ?? '',
    email_body: job.email_body ?? '',
    cv_id: job.cv_id ?? '',
  }
}

export function draftToPayload(draft: JobDraft) {
  return {
    company: draft.company.trim(),
    role_title: draft.role_title.trim(),
    status: draft.status,
    work_mode: draft.work_mode,
    priority: draft.priority,
    location: clean(draft.location),
    job_url: clean(draft.job_url),
    source: clean(canonicalSource(draft.source)),
    salary_text: clean(draft.salary_text),
    contact_name: clean(draft.contact_name),
    contact_email: clean(draft.contact_email),
    applied_at: clean(draft.applied_at),
    next_action: clean(draft.next_action),
    next_action_at: draft.next_action_at ? new Date(draft.next_action_at).toISOString() : null,
    job_description: clean(draft.job_description),
    notes: clean(draft.notes),
    external_job_id: clean(draft.external_job_id),
    email_recipient: clean(draft.email_recipient),
    email_subject: clean(draft.email_subject),
    email_body: clean(draft.email_body),
    cv_id: clean(draft.cv_id),
  }
}

export function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === 'string' && JOB_STATUSES.includes(value as JobStatus)
}

export function isWorkMode(value: unknown): value is WorkMode {
  return typeof value === 'string' && WORK_MODES.includes(value as WorkMode)
}

export function isPriority(value: unknown): value is JobPriority {
  return typeof value === 'string' && PRIORITIES.includes(value as JobPriority)
}

export function jobMatches(job: Job, search: string, status: 'all' | JobStatus) {
  const needle = search.trim().toLowerCase()
  const matchesStatus = status === 'all' || job.status === status
  const matchesSearch = !needle || [
    job.company,
    job.role_title,
    job.location ?? '',
    job.contact_name ?? '',
    job.source ?? '',
    job.notes ?? '',
  ].some((value) => value.toLowerCase().includes(needle))
  return matchesStatus && matchesSearch
}

export function formatDateTime(value: string) {
  return new Date(value).toLocaleString()
}

export function relativeDueLabel(value: string) {
  const difference = new Date(value).getTime() - Date.now()
  const hours = Math.round(Math.abs(difference) / 3_600_000)
  if (difference < 0) return hours < 1 ? 'Due now' : `${hours}h overdue`
  if (hours < 1) return 'Due within an hour'
  if (hours < 48) return `Due in ${hours}h`
  return `Due in ${Math.round(hours / 24)} days`
}

function csvCell(value: unknown) {
  const text = value == null ? '' : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

export function jobsToCsv(jobs: Job[]) {
  const columns: Array<keyof Job> = [
    'company', 'role_title', 'status', 'priority', 'work_mode', 'location', 'job_url',
    'source', 'salary_text', 'contact_name', 'contact_email', 'applied_at', 'next_action',
    'next_action_at', 'job_description', 'notes', 'cv_id', 'email_recipient', 'email_subject', 'email_body',
  ]
  return [
    columns.map(csvCell).join(','),
    ...jobs.map((job) => columns.map((column) => csvCell(job[column])).join(',')),
  ].join('\r\n')
}

export function downloadText(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
