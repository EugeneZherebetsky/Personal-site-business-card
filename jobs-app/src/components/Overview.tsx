import { useMemo } from 'react'
import {
  RESPONSE_STATUSES,
  isApplied,
  medianDaysToFirstResponse,
  reachedStatuses,
  resultsByCV,
  resultsBySource,
  shareLabel,
  stageFunnel,
  weeklyApplications,
  type GroupOutcome,
} from '../lib/analytics'
import { BOARD_COLUMNS, relativeDueLabel } from '../lib/opportunities'
import type { CV, Contact, Job, JobStageEvent } from '../types'

export type OverviewCounts = { active: number; interviews: number; offers: number }

type OverviewViewProps = {
  jobs: Job[]
  cvs: CV[]
  stageEvents: JobStageEvent[]
  counts: OverviewCounts
  jobReminders: Job[]
  contactReminders: Contact[]
  onEditJob: (job: Job) => void
  onEditContact: (contact: Contact) => void
  onOpenBoard: () => void
  onOpenReminders: () => void
  now?: Date
}

type NextAction =
  | { kind: 'job'; id: string; due: string; title: string; detail: string; job: Job }
  | { kind: 'contact'; id: string; due: string; title: string; detail: string; contact: Contact }

const WEEK_MS = 7 * 86_400_000

function OutcomeTable({ title, note, rows }: { title: string; note: string; rows: GroupOutcome[] }) {
  return (
    <div className="overview-outcome">
      <h3>{title}</h3>
      {rows.length === 0 ? <div className="compact-empty">{note}</div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>{title}</th><th>Saved</th><th>Applied</th><th>Interviews</th><th>Offers</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <td><strong>{row.label}</strong></td>
                  <td>{row.total}</td>
                  <td>{row.applied}</td>
                  <td>{row.interviews}</td>
                  <td>{row.offers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/**
 * The single "where do I stand" page. The first screen answers what needs
 * doing and where the pipeline is; everything below the divider explains how
 * the search is converting. It replaces the former Dashboard and Analytics views.
 */
export function OverviewView({ jobs, cvs, stageEvents, counts, jobReminders, contactReminders, onEditJob, onEditContact, onOpenBoard, onOpenReminders, now = new Date() }: OverviewViewProps) {
  const nowMs = now.getTime()

  const nextActions = useMemo<NextAction[]>(() => [
    ...jobReminders.map((job): NextAction => ({ kind: 'job', id: `job:${job.id}`, due: job.next_action_at!, title: job.next_action || 'Follow up', detail: `${job.role_title} · ${job.company}`, job })),
    ...contactReminders.map((contact): NextAction => ({ kind: 'contact', id: `contact:${contact.id}`, due: contact.next_action_at!, title: contact.next_action || 'Follow up', detail: `${contact.name}${contact.company ? ` · ${contact.company}` : ''} · Network`, contact })),
  ].sort((left, right) => new Date(left.due).getTime() - new Date(right.due).getTime()), [contactReminders, jobReminders])

  const dueThisWeek = nextActions.filter((item) => new Date(item.due).getTime() <= nowMs + WEEK_MS).length
  const overdue = nextActions.filter((item) => new Date(item.due).getTime() < nowMs).length

  const reached = useMemo(() => reachedStatuses(jobs, stageEvents), [jobs, stageEvents])
  const appliedJobs = useMemo(() => jobs.filter((job) => isApplied(job, reached)), [jobs, reached])
  const responded = useMemo(() => appliedJobs.filter((job) => {
    const set = reached.get(job.id)
    return Boolean(set && RESPONSE_STATUSES.some((status) => set.has(status)))
  }).length, [appliedJobs, reached])

  const columns = BOARD_COLUMNS.map((column, index) => ({ ...column, index, count: jobs.filter((job) => column.statuses.includes(job.status)).length }))

  const weekly = useMemo(() => weeklyApplications(jobs, 8, now), [jobs, now])
  const weeklyMax = Math.max(1, ...weekly.map((week) => week.count))
  const funnel = useMemo(() => stageFunnel(jobs, reached), [jobs, reached])
  const firstResponse = useMemo(() => medianDaysToFirstResponse(stageEvents), [stageEvents])
  const bySource = useMemo(() => resultsBySource(jobs, reached), [jobs, reached])
  const byCV = useMemo(() => resultsByCV(jobs, cvs, reached), [cvs, jobs, reached])

  return (
    <>
      <section className="metrics five" aria-label="Status at a glance">
        <article><span>Active pipeline</span><strong>{counts.active}</strong></article>
        <article><span>Interview stages</span><strong>{counts.interviews}</strong></article>
        <article><span>Offers</span><strong>{counts.offers}</strong></article>
        <article className={overdue > 0 ? 'metric-alert' : ''}><span>Due this week</span><strong>{dueThisWeek}</strong><small className="metric-note">{overdue > 0 ? `${overdue} overdue` : 'nothing overdue'}</small></article>
        <article><span>Got a response</span><strong>{responded}</strong><small className="metric-note">{appliedJobs.length ? `of ${appliedJobs.length} applied (${Math.round((responded / appliedJobs.length) * 100)}%)` : 'no applications yet'}</small></article>
      </section>

      <div className="dashboard-grid">
        <section className="workspace-card panel">
          <div className="panel-head"><div><p className="eyebrow">Needs attention</p><h2>Next actions</h2></div><button className="button ghost" onClick={onOpenReminders}>All reminders</button></div>
          <div className="attention-list">
            {nextActions.slice(0, 5).map((item) => (
              <button key={item.id} onClick={() => item.kind === 'job' ? onEditJob(item.job) : onEditContact(item.contact)}>
                <span><strong>{item.title}</strong><small>{item.detail}</small></span>
                <em className={new Date(item.due).getTime() < nowMs ? 'overdue' : ''}>{relativeDueLabel(item.due)}</em>
              </button>
            ))}
            {nextActions.length === 0 && <div className="compact-empty">No follow-ups are scheduled.</div>}
          </div>
        </section>

        <section className="workspace-card panel">
          <div className="panel-head"><div><p className="eyebrow">Pipeline</p><h2>Where applications are</h2></div><button className="button ghost" onClick={onOpenBoard}>Open board</button></div>
          {jobs.length === 0 ? <div className="compact-empty">Add an application to see your pipeline.</div> : (
            <>
              <button className="pipeline-strip" onClick={onOpenBoard} aria-label="Open the board">
                {columns.filter((column) => column.count > 0).map((column) => <i key={column.title} className={`strip-${column.index}`} style={{ flexGrow: column.count }} title={`${column.title}: ${column.count}`} />)}
              </button>
              <ul className="pipeline-legend">
                {columns.map((column) => <li key={column.title} className={column.count === 0 ? 'empty' : ''}><i className={`strip-${column.index}`} aria-hidden="true" />{column.title}<strong>{column.count}</strong></li>)}
              </ul>
            </>
          )}
        </section>
      </div>

      <div className="overview-divider"><span>Momentum and results</span></div>

      <div className="dashboard-grid">
        <section className="workspace-card panel">
          <div className="panel-head"><div><p className="eyebrow">Weekly effort</p><h2>Applications per week</h2></div></div>
          <div className="pipeline-chart">
            {weekly.map((week) => (
              <div className="pipeline-row" key={week.weekStart}>
                <span>{week.label}</span>
                <div><i style={{ width: `${(week.count / weeklyMax) * 100}%` }} /></div>
                <strong>{week.count}</strong>
              </div>
            ))}
          </div>
          <p className="analytics-note">Counted by the applied date on each application over the last 8 weeks.</p>
        </section>

        <section className="workspace-card panel">
          <div className="panel-head"><div><p className="eyebrow">Conversion</p><h2>Stage funnel</h2></div></div>
          <div className="pipeline-chart funnel">
            {funnel.map((stage, index) => (
              <div className="pipeline-row" key={stage.key}>
                <span>{stage.label}</span>
                <div><i style={{ width: `${(stage.count / Math.max(1, funnel[0].count)) * 100}%` }} /></div>
                <strong>{index === 0 ? stage.count : shareLabel(stage.count, funnel[0].count)}</strong>
              </div>
            ))}
          </div>
          <p className="analytics-note">
            {firstResponse.medianDays == null
              ? 'Median response time appears after status changes are recorded live (existing applications only carry their current state).'
              : `Median time from applying to the first response: ${firstResponse.medianDays} days, measured on ${firstResponse.sample} application${firstResponse.sample === 1 ? '' : 's'} with live-recorded history.`}
          </p>
        </section>
      </div>

      <details className="workspace-card panel overview-details">
        <summary><span><p className="eyebrow">What's working</p><strong>Results by source and CV version</strong></span></summary>
        <div className="overview-outcomes">
          <OutcomeTable title="By source" note="Record a source on your applications to compare where interviews come from." rows={bySource} />
          <OutcomeTable title="By CV version" note="Link CVs to applications to compare which version performs better." rows={byCV} />
        </div>
      </details>

      <p className="analytics-note standalone">These are your own counts, not predictions. With small samples, one reply can move every percentage — read the absolute numbers first.</p>
    </>
  )
}
