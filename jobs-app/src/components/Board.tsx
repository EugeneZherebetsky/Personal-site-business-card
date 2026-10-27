import { useState, type DragEvent } from 'react'
import { BOARD_COLUMNS, relativeDueLabel } from '../lib/opportunities'
import { JOB_STATUSES, STATUS_LABELS, type CV, type Job, type JobStatus } from '../types'
import { JobBadges } from './JobBadges'

type BoardViewProps = {
  jobs: Job[]
  cvs: CV[]
  busy: boolean
  onEdit: (job: Job) => void
  onStatus: (job: Job, status: JobStatus) => Promise<void>
  onCV: (job: Job, cvId: string | null) => Promise<void>
}

// Separate drag types keep the two gestures apart: a CV chip dropped on a card
// links it, an application card dropped on a stage moves it.
export const CV_DRAG_TYPE = 'application/x-opportunity-desk-cv'
export const JOB_DRAG_TYPE = 'application/x-opportunity-desk-job'

function carries(event: DragEvent<HTMLElement>, type: string) {
  return Array.from(event.dataTransfer.types).includes(type)
}

export function BoardView({ jobs, cvs, busy, onEdit, onStatus, onCV }: BoardViewProps) {
  const [dragOverJobId, setDragOverJobId] = useState<string | null>(null)
  const [draggingJobId, setDraggingJobId] = useState<string | null>(null)
  const [dropStatus, setDropStatus] = useState<JobStatus | null>(null)
  const draggingJob = jobs.find((job) => job.id === draggingJobId) ?? null

  function startCVDrag(event: DragEvent<HTMLElement>, cv: CV) {
    event.dataTransfer.effectAllowed = 'link'
    event.dataTransfer.setData(CV_DRAG_TYPE, cv.id)
    event.dataTransfer.setData('text/plain', cv.id)
  }

  function dropCV(event: DragEvent<HTMLElement>, job: Job) {
    event.preventDefault()
    setDragOverJobId(null)
    const cvId = event.dataTransfer.getData(CV_DRAG_TYPE) || event.dataTransfer.getData('text/plain')
    if (cvs.some((cv) => cv.id === cvId)) void onCV(job, cvId)
  }

  function startJobDrag(event: DragEvent<HTMLElement>, job: Job) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(JOB_DRAG_TYPE, job.id)
    // Showing the drop zones in the same tick as dragstart makes Chrome cancel
    // the drag, so they appear on the next frame.
    window.setTimeout(() => setDraggingJobId(job.id), 0)
  }

  function endJobDrag() {
    setDraggingJobId(null)
    setDropStatus(null)
  }

  function overStage(event: DragEvent<HTMLElement>, status: JobStatus) {
    if (!carries(event, JOB_DRAG_TYPE) || draggingJob?.status === status) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropStatus(status)
  }

  function dropOnStage(event: DragEvent<HTMLElement>, status: JobStatus) {
    event.preventDefault()
    const jobId = event.dataTransfer.getData(JOB_DRAG_TYPE) || draggingJobId
    const job = jobs.find((candidate) => candidate.id === jobId)
    endJobDrag()
    if (job && job.status !== status) void onStatus(job, status)
  }

  return (
    <>
      <section className="cv-drag-panel workspace-card" aria-label="CVs available to link">
        <div><p className="eyebrow">Drag and drop</p><h2>Move cards between stages</h2><span>Drag an application to another column to change its stage, or drag a CV onto a card to link it. On phones or with a keyboard, use the selectors inside each card.</span></div>
        <div className="cv-drag-list">{cvs.map((cv) => <article className="cv-drag-chip" key={cv.id} draggable={!busy} onDragStart={(event) => startCVDrag(event, cv)} onDragEnd={() => setDragOverJobId(null)}><strong>{cv.name}</strong><span>{cv.tailored_company || cv.target_role || 'General CV'}</span></article>)}{cvs.length === 0 && <span className="compact-empty">Add a CV in the CV library before linking one.</span>}</div>
      </section>
      <section className={draggingJob ? 'kanban job-dragging' : 'kanban'} aria-label="Application board">{BOARD_COLUMNS.map((column) => {
        const columnJobs = jobs.filter((job) => column.statuses.includes(job.status))
        return <div className="kanban-column" key={column.title}>
          <div className="kanban-head"><strong>{column.title}</strong><span>{columnJobs.length}</span></div>
          <div className="kanban-cards">{columnJobs.map((job) => {
            const linkedCV = cvs.find((cv) => cv.id === job.cv_id)
            const classes = ['kanban-card', dragOverJobId === job.id ? 'cv-drop-active' : '', draggingJobId === job.id ? 'dragging' : ''].filter(Boolean).join(' ')
            return <article className={classes} key={job.id} draggable={!busy} onDragStart={(event) => startJobDrag(event, job)} onDragEnd={endJobDrag} onDragOver={(event) => { if (!busy && cvs.length && carries(event, CV_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = 'link'; setDragOverJobId(job.id) } }} onDragLeave={() => setDragOverJobId((current) => current === job.id ? null : current)} onDrop={(event) => { if (carries(event, CV_DRAG_TYPE)) dropCV(event, job) }}><JobBadges job={job} /><button className="card-title" onClick={() => onEdit(job)}><strong>{job.role_title}</strong><span>{job.company}</span></button>{job.next_action_at && <small>{job.next_action || 'Next action'} · {relativeDueLabel(job.next_action_at)}</small>}<div className={linkedCV ? 'linked-cv' : 'linked-cv empty'}><strong>{linkedCV ? linkedCV.name : 'Drop a CV here'}</strong><span>{linkedCV ? linkedCV.tailored_company ? `Tailored for ${linkedCV.tailored_company}` : linkedCV.original_filename || 'Text-only CV' : 'or choose one below'}</span></div><label className="compact-select">CV used<select disabled={busy} value={job.cv_id ?? ''} onChange={(event) => void onCV(job, event.target.value || null)}><option value="">No CV linked</option>{cvs.map((cv) => <option key={cv.id} value={cv.id}>{cv.name}{cv.tailored_company ? ` — ${cv.tailored_company}` : ''}</option>)}</select></label><label className="compact-select">Move to<select disabled={busy} value={job.status} onChange={(event) => void onStatus(job, event.target.value as JobStatus)}>{JOB_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</select></label></article>
          })}{columnJobs.length === 0 && <div className="column-empty">No applications</div>}</div>
          {draggingJob && (
            <div className="kanban-drop-zones" data-testid={`drop-zones-${column.title}`}>
              {column.statuses.map((status) => {
                const current = draggingJob.status === status
                return <div key={status} className={['kanban-drop-zone', current ? 'current' : '', dropStatus === status ? 'over' : ''].filter(Boolean).join(' ')} data-status={status} onDragOver={(event) => overStage(event, status)} onDragLeave={() => setDropStatus((value) => value === status ? null : value)} onDrop={(event) => dropOnStage(event, status)}>
                  <strong>{STATUS_LABELS[status]}</strong>
                  <span>{current ? 'Current stage' : 'Drop to move here'}</span>
                </div>
              })}
            </div>
          )}
        </div>
      })}</section>
    </>
  )
}
