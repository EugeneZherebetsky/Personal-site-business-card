import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { JobForm } from './JobForm'
import { EMPTY_JOB } from '../types'
import { makeJob } from '../test/factories'

function renderForm(onSave = vi.fn().mockResolvedValue(undefined)) {
  const otherJobs = [
    makeJob({ id: 'a', company: 'Graphisoft', role_title: 'IT PMI Manager', status: 'applied' }),
    makeJob({ id: 'b', company: 'Graphisoft', role_title: 'M&A Integration Manager', status: 'closed' }),
  ]
  const noop = vi.fn().mockResolvedValue(undefined)
  render(<JobForm initial={EMPTY_JOB} title="Add an opportunity" busy={false} error="" notice="" cvs={[]} companySuggestions={['Graphisoft']} sourceSuggestions={['LinkedIn', 'Referral']} otherJobs={otherJobs} existing={false} googleConfigured={false} sendHistoryPending={false} sendHistory={[]} replies={[]} onCancel={() => {}} onSave={onSave} onTailor={noop} onCalendar={noop} onSend={noop} onRetrySendHistory={noop} onCheckReplies={noop} />)
  return { onSave }
}

describe('JobForm naming', () => {
  it('spots an employer already tracked under another spelling and offers the usual one', async () => {
    renderForm()
    const company = screen.getByLabelText(/^Company/)
    await userEvent.type(company, 'GRAPHISOFT')
    expect(screen.getByText(/Already tracked: IT PMI Manager \(Applied\), M&A Integration Manager \(Closed\)/)).toBeDefined()
    await userEvent.click(screen.getByRole('button', { name: 'Use “Graphisoft”' }))
    expect((company as HTMLInputElement).value).toBe('Graphisoft')
    expect(screen.queryByRole('button', { name: /^Use / })).toBeNull()
  })

  it('offers company and source suggestions', () => {
    renderForm()
    expect(screen.getByLabelText(/^Company/).getAttribute('list')).toBe('company-suggestions')
    expect(document.querySelectorAll('#source-suggestions option')).toHaveLength(2)
  })
})
