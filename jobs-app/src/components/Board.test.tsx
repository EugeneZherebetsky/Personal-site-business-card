import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { BoardView, CV_DRAG_TYPE } from './Board'
import { makeCV, makeJob } from '../test/factories'
import { STATUS_LABELS } from '../types'

// jsdom has no DataTransfer; this keeps the parts the board relies on.
function fakeDataTransfer() {
  const store = new Map<string, string>()
  return {
    dropEffect: 'none',
    effectAllowed: 'all',
    get types() { return [...store.keys()] },
    setData: (type: string, value: string) => { store.set(type, value) },
    getData: (type: string) => store.get(type) ?? '',
  }
}

function renderBoard() {
  const onStatus = vi.fn().mockResolvedValue(undefined)
  const onCV = vi.fn().mockResolvedValue(undefined)
  const jobs = [makeJob({ id: 'job-1', role_title: 'PMO Lead', company: 'Acme', status: 'applied' })]
  const cvs = [makeCV({ id: 'cv-1', name: 'PMO CV' })]
  render(<BoardView jobs={jobs} cvs={cvs} busy={false} onEdit={() => {}} onStatus={onStatus} onCV={onCV} />)
  return { onStatus, onCV, jobs }
}

async function startDragging(card: HTMLElement) {
  const dataTransfer = fakeDataTransfer()
  fireEvent.dragStart(card, { dataTransfer })
  // Drop zones appear on the next tick so the browser does not cancel the drag.
  await screen.findByTestId('drop-zones-Conversations')
  return dataTransfer
}

describe('BoardView drag and drop', () => {
  it('moves an application to the stage it is dropped on', async () => {
    const { onStatus, jobs } = renderBoard()
    const card = screen.getByText('PMO Lead').closest('article')!
    const dataTransfer = await startDragging(card)

    const target = within(screen.getByTestId('drop-zones-Conversations')).getByText(STATUS_LABELS.interviewing).parentElement!
    const over = fireEvent.dragOver(target, { dataTransfer })
    expect(over).toBe(false) // default prevented: the browser allows the drop
    fireEvent.drop(target, { dataTransfer })

    expect(onStatus).toHaveBeenCalledWith(jobs[0], 'interviewing')
    expect(screen.queryByTestId('drop-zones-Conversations')).toBeNull()
  })

  it('splits multi-stage columns and refuses a drop on the current stage', async () => {
    const { onStatus } = renderBoard()
    const dataTransfer = await startDragging(screen.getByText('PMO Lead').closest('article')!)

    expect(within(screen.getByTestId('drop-zones-Complete')).getAllByText(/Drop to move here/)).toHaveLength(4)
    const current = within(screen.getByTestId('drop-zones-Applied')).getByText('Current stage').parentElement!
    expect(fireEvent.dragOver(current, { dataTransfer })).toBe(true) // not prevented: no drop allowed
    fireEvent.drop(current, { dataTransfer })
    expect(onStatus).not.toHaveBeenCalled()
  })

  it('still links a CV dropped on a card without showing stage zones', () => {
    const { onCV, jobs } = renderBoard()
    const dataTransfer = fakeDataTransfer()
    fireEvent.dragStart(screen.getByText('PMO CV', { selector: 'strong' }).closest('article')!, { dataTransfer })
    expect(dataTransfer.types).toContain(CV_DRAG_TYPE)

    const card = screen.getByText('PMO Lead').closest('article')!
    fireEvent.dragOver(card, { dataTransfer })
    fireEvent.drop(card, { dataTransfer })
    expect(onCV).toHaveBeenCalledWith(jobs[0], 'cv-1')
    expect(screen.queryByTestId('drop-zones-Applied')).toBeNull()
  })
})
