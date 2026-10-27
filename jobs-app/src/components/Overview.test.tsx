import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OverviewView } from './Overview'
import { makeJob } from '../test/factories'
import type { Contact } from '../types'

const counts = { active: 3, interviews: 2, offers: 1 }
const NOW = new Date('2026-08-01T09:00:00.000Z')

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return { id: 'contact-1', name: 'Dana Recruiter', company: 'Globex', pipeline_stage: 'contacted', next_action: 'Send thank-you', next_action_at: '2026-08-02T09:00:00.000Z', ...overrides } as Contact
}

function renderOverview(props: Partial<Parameters<typeof OverviewView>[0]> = {}) {
  const handlers = { onEditJob: vi.fn(), onEditContact: vi.fn(), onOpenBoard: vi.fn(), onOpenReminders: vi.fn() }
  render(<OverviewView jobs={[]} cvs={[]} stageEvents={[]} counts={counts} jobReminders={[]} contactReminders={[]} now={NOW} {...handlers} {...props} />)
  return handlers
}

describe('OverviewView', () => {
  it('shows the headline counts and empty states', () => {
    renderOverview()
    expect(screen.getByText('Active pipeline').parentElement?.textContent).toBe('Active pipeline3')
    expect(screen.getByText('Offers').parentElement?.textContent).toBe('Offers1')
    expect(screen.getByText('No follow-ups are scheduled.')).toBeDefined()
    expect(screen.getByText('Add an application to see your pipeline.')).toBeDefined()
    expect(screen.getByText('no applications yet')).toBeDefined()
  })

  it('merges application and networking actions, lists at most five, and opens the one clicked', async () => {
    const jobReminders = Array.from({ length: 5 }, (_, index) => makeJob({
      id: `job-${index}`,
      role_title: `Role ${index}`,
      next_action: `Follow up ${index}`,
      next_action_at: `2026-08-0${index + 1}T10:00:00.000Z`,
    }))
    const contact = makeContact({ next_action_at: '2026-07-30T09:00:00.000Z' })
    const handlers = renderOverview({ jobs: jobReminders, jobReminders, contactReminders: [contact] })

    // The overdue contact sorts first, which pushes the latest application action out of the top five.
    expect(screen.queryByText('Follow up 4')).toBeNull()
    await userEvent.click(screen.getByText('Send thank-you'))
    expect(handlers.onEditContact).toHaveBeenCalledWith(contact)
    await userEvent.click(screen.getByText('Follow up 0'))
    expect(handlers.onEditJob).toHaveBeenCalledWith(jobReminders[0])
  })

  it('flags overdue actions in the due-this-week figure', () => {
    renderOverview({ contactReminders: [makeContact({ next_action_at: '2026-07-30T09:00:00.000Z' })] })
    const card = screen.getByText('Due this week').parentElement!
    expect(card.className).toContain('metric-alert')
    expect(card.textContent).toContain('1 overdue')
  })

  it('summarises the pipeline by board group and links to the board and reminders', async () => {
    const jobs = [makeJob({ id: 'a', status: 'applied' }), makeJob({ id: 'b', status: 'applied' }), makeJob({ id: 'c', status: 'interviewing' })]
    const handlers = renderOverview({ jobs })
    expect(screen.getByText('Applied', { selector: 'li' }).textContent).toBe('Applied2')
    expect(screen.getByText('Conversations', { selector: 'li' }).textContent).toBe('Conversations1')
    await userEvent.click(screen.getByRole('button', { name: 'Open board' }))
    await userEvent.click(screen.getByRole('button', { name: 'All reminders' }))
    expect(handlers.onOpenBoard).toHaveBeenCalledOnce()
    expect(handlers.onOpenReminders).toHaveBeenCalledOnce()
  })
})
