import type { Contact, CV, Job, JobStageEvent, JobStatus } from '../types'
import { ACTIVE_STATUSES } from './opportunities'
import { sourceGroup } from './naming'

export const RESPONSE_STATUSES: JobStatus[] = ['phone_screen', 'interviewing', 'assessment', 'final_round', 'offer', 'accepted', 'rejected']
export const INTERVIEW_STATUSES: JobStatus[] = ['phone_screen', 'interviewing', 'assessment', 'final_round']
export const OFFER_STATUSES: JobStatus[] = ['offer', 'accepted']

/**
 * Every status each application has ever reached, combining stage events
 * (including synthetic backfills — reaching a state is factual even when its
 * timestamp is not) with the current status.
 */
export function reachedStatuses(jobs: Job[], events: JobStageEvent[]) {
  const reached = new Map<string, Set<JobStatus>>()
  const add = (jobId: string, status: JobStatus | null) => {
    if (!status) return
    const set = reached.get(jobId) ?? new Set<JobStatus>()
    set.add(status)
    reached.set(jobId, set)
  }
  events.forEach((event) => {
    add(event.job_id, event.from_status)
    add(event.job_id, event.to_status)
  })
  jobs.forEach((job) => add(job.id, job.status))
  return reached
}

function hasReached(reached: Map<string, Set<JobStatus>>, jobId: string, statuses: JobStatus[]) {
  const set = reached.get(jobId)
  return Boolean(set && statuses.some((status) => set.has(status)))
}

export function isApplied(job: Job, reached: Map<string, Set<JobStatus>>) {
  return Boolean(job.applied_at) || hasReached(reached, job.id, ['applied', ...RESPONSE_STATUSES])
}

export type FunnelStage = { key: string; label: string; count: number }

export function stageFunnel(jobs: Job[], reached: Map<string, Set<JobStatus>>): FunnelStage[] {
  const applied = jobs.filter((job) => isApplied(job, reached))
  return [
    { key: 'applied', label: 'Applied', count: applied.length },
    { key: 'response', label: 'Any response', count: applied.filter((job) => hasReached(reached, job.id, RESPONSE_STATUSES)).length },
    { key: 'interview', label: 'Interview stage', count: applied.filter((job) => hasReached(reached, job.id, INTERVIEW_STATUSES)).length },
    { key: 'offer', label: 'Offer', count: applied.filter((job) => hasReached(reached, job.id, OFFER_STATUSES)).length },
    { key: 'accepted', label: 'Accepted', count: applied.filter((job) => hasReached(reached, job.id, ['accepted'])).length },
  ]
}

export type WeeklyCount = { weekStart: string; label: string; count: number }

function startOfWeek(date: Date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = (result.getDay() + 6) % 7 // Monday = 0
  result.setDate(result.getDate() - day)
  return result
}

// Calendar identity of a week's Monday. Buckets are matched on this key, not
// on elapsed milliseconds, because weeks that cross a daylight-saving
// transition are not exactly 168 hours long.
function weekKey(weekStart: Date) {
  return `${weekStart.getFullYear()}-${weekStart.getMonth()}-${weekStart.getDate()}`
}

/** Applications per calendar week (Monday-based) using the user-entered applied date. */
export function weeklyApplications(jobs: Job[], weeks = 8, now = new Date()): WeeklyCount[] {
  const currentWeek = startOfWeek(now)
  const ordered: WeeklyCount[] = []
  const buckets = new Map<string, WeeklyCount>()
  for (let index = weeks - 1; index >= 0; index -= 1) {
    const weekStart = new Date(currentWeek)
    weekStart.setDate(weekStart.getDate() - index * 7)
    const bucket = {
      weekStart: weekStart.toISOString(),
      label: `${weekStart.getDate()} ${weekStart.toLocaleString(undefined, { month: 'short' })}`,
      count: 0,
    }
    ordered.push(bucket)
    buckets.set(weekKey(weekStart), bucket)
  }
  jobs.forEach((job) => {
    if (!job.applied_at) return
    const applied = new Date(`${job.applied_at}T00:00`)
    if (Number.isNaN(applied.getTime())) return
    const bucket = buckets.get(weekKey(startOfWeek(applied)))
    if (bucket) bucket.count += 1
  })
  return ordered
}

function reliable(event: JobStageEvent) {
  return event.event_type !== 'backfill_current_state' && event.details['historical_timestamp_reliable'] !== false
}

/**
 * Median days between a trustworthy applied event and the first later
 * trustworthy response event. Synthetic backfills are excluded, so this only
 * measures history recorded live by the stage-event trigger.
 */
export function medianDaysToFirstResponse(events: JobStageEvent[]) {
  const byJob = new Map<string, JobStageEvent[]>()
  events.filter(reliable).forEach((event) => {
    const list = byJob.get(event.job_id) ?? []
    list.push(event)
    byJob.set(event.job_id, list)
  })
  const durations: number[] = []
  byJob.forEach((jobEvents) => {
    jobEvents.sort((left, right) => new Date(left.occurred_at).getTime() - new Date(right.occurred_at).getTime())
    const appliedEvent = jobEvents.find((event) => event.to_status === 'applied')
    if (!appliedEvent) return
    const appliedTime = new Date(appliedEvent.occurred_at).getTime()
    const responseEvent = jobEvents.find((event) => RESPONSE_STATUSES.includes(event.to_status) && new Date(event.occurred_at).getTime() >= appliedTime)
    if (!responseEvent) return
    durations.push((new Date(responseEvent.occurred_at).getTime() - appliedTime) / 86_400_000)
  })
  if (!durations.length) return { medianDays: null as number | null, sample: 0 }
  durations.sort((left, right) => left - right)
  const middle = Math.floor(durations.length / 2)
  const median = durations.length % 2 ? durations[middle] : (durations[middle - 1] + durations[middle]) / 2
  return { medianDays: Math.round(median * 10) / 10, sample: durations.length }
}

export type GroupOutcome = { label: string; total: number; applied: number; interviews: number; offers: number }

export function resultsBySource(jobs: Job[], reached: Map<string, Set<JobStatus>>): GroupOutcome[] {
  return groupOutcomes(jobs, reached, (job) => sourceGroup(job.source) || 'No source recorded')
}

export function resultsByCV(jobs: Job[], cvs: CV[], reached: Map<string, Set<JobStatus>>): GroupOutcome[] {
  const names = new Map(cvs.map((cv) => [cv.id, cv.name]))
  return groupOutcomes(
    jobs.filter((job) => job.cv_id),
    reached,
    (job) => names.get(job.cv_id!) ?? 'Deleted CV',
  )
}

function groupOutcomes(jobs: Job[], reached: Map<string, Set<JobStatus>>, keyOf: (job: Job) => string): GroupOutcome[] {
  const groups = new Map<string, GroupOutcome>()
  jobs.forEach((job) => {
    const label = keyOf(job)
    const group = groups.get(label) ?? { label, total: 0, applied: 0, interviews: 0, offers: 0 }
    group.total += 1
    if (isApplied(job, reached)) group.applied += 1
    if (hasReached(reached, job.id, INTERVIEW_STATUSES)) group.interviews += 1
    if (hasReached(reached, job.id, OFFER_STATUSES)) group.offers += 1
    groups.set(label, group)
  })
  return [...groups.values()].sort((left, right) => right.total - left.total || left.label.localeCompare(right.label))
}

export function overdueCounts(jobs: Job[], contacts: Contact[], now = new Date()) {
  const cutoff = now.getTime()
  return {
    jobs: jobs.filter((job) => job.next_action_at && ACTIVE_STATUSES.includes(job.status) && new Date(job.next_action_at).getTime() < cutoff).length,
    contacts: contacts.filter((contact) => contact.next_action_at && contact.pipeline_stage !== 'closed' && new Date(contact.next_action_at).getTime() < cutoff).length,
  }
}

/** Formats a share as "x of n (p%)" so small samples are never shown as bare percentages. */
export function shareLabel(part: number, whole: number) {
  if (!whole) return 'no data yet'
  return `${part} of ${whole} (${Math.round((part / whole) * 100)}%)`
}
