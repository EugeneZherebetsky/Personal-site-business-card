import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OutreachForm } from './OutreachForm'
import { outreachToDraft } from '../lib/outreach'
import type { EmailReply, OutreachEmail } from '../types'

const NOW = '2026-08-01T10:00:00.000Z'

function sentEmail(overrides: Partial<OutreachEmail> = {}): OutreachEmail {
  return {
    id: 'out-1',
    user_id: 'user-1',
    company: 'Acme',
    recipient_name: 'Dana Lead',
    recipient_role: 'CIO',
    recipient_email: 'dana@example.com',
    contact_id: null,
    cv_id: null,
    job_id: null,
    subject: 'Intro',
    body: 'Hello',
    status: 'sent',
    sent_at: NOW,
    send_attempt_id: null,
    send_attempted_at: NOW,
    provider: 'gmail',
    provider_message_id: 'msg-1',
    provider_thread_id: 'thread-1',
    attachment_filename: null,
    reply_status: 'awaiting',
    replied_at: null,
    follow_up_at: null,
    notes: null,
    created_at: NOW,
    updated_at: NOW,
    version: 1,
    data: {},
    ...overrides,
  }
}

function reply(id: string, kind: string | undefined, from: string): EmailReply {
  return {
    id,
    user_id: 'user-1',
    source_type: 'outreach',
    source_id: 'out-1',
    thread_id: 'thread-1',
    provider_message_id: id,
    from_address: from,
    subject: 'Re: Intro',
    received_at: '2026-08-02T10:00:00.000Z',
    detected_at: '2026-08-02T10:05:00.000Z',
    data: kind ? { kind } : {},
  }
}

function renderForm(email: OutreachEmail, replies: EmailReply[] = [], handlers = {}) {
  const props = {
    initial: outreachToDraft(email),
    sent: email,
    inFlight: null,
    title: 'Email as sent',
    busy: false,
    error: '',
    notice: '',
    cvs: [],
    contacts: [],
    googleConfigured: true,
    syncPending: false,
    replies,
    onCancel: () => {},
    onSaveDraft: async () => {},
    onSend: async () => {},
    onUpdateOutcome: vi.fn(async () => {}),
    onRetrySync: async () => {},
    onResolveAttempt: async () => {},
    onReconcileAttempt: async () => {},
    onCheckReply: vi.fn(async () => {}),
    ...handlers,
  }
  return { props, ...render(<OutreachForm {...props} />) }
}

describe('OutreachForm reply checking', () => {
  it('labels automatic replies and delivery failures apart from real replies', () => {
    renderForm(sentEmail(), [
      reply('r1', undefined, 'dana@example.com'),
      reply('r2', 'auto_reply', 'dana@example.com'),
      reply('r3', 'bounce', 'mailer-daemon@googlemail.com'),
    ])
    const items = screen
      .getAllByRole('listitem')
      .map((item) => item.querySelector('strong')?.textContent)
    expect(items).toEqual(['Reply', 'Automatic reply', 'Delivery failure'])
  })

  it('asks Gmail about this message when the check is pressed', async () => {
    const email = sentEmail()
    const { props } = renderForm(email)
    await userEvent.click(screen.getByRole('button', { name: 'Check Gmail for a reply' }))
    expect(props.onCheckReply).toHaveBeenCalledWith(email)
  })

  it('cannot check a message sent without a recorded thread', () => {
    renderForm(sentEmail({ provider_thread_id: null }))
    expect(
      (screen.getByRole('button', { name: 'Check Gmail for a reply' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('follows a reply state set by a check, so saving does not undo it', async () => {
    const { props, rerender } = renderForm(sentEmail())
    const replied = sentEmail({ reply_status: 'replied', version: 2 })
    rerender(<OutreachForm {...props} sent={replied} initial={outreachToDraft(replied)} />)

    await userEvent.click(screen.getByRole('button', { name: 'Save outcome' }))
    expect(props.onUpdateOutcome).toHaveBeenCalledWith(
      replied,
      expect.objectContaining({ reply_status: 'replied' }),
    )
  })

  it('shows a check outcome inside the dialog', () => {
    const { props, rerender } = renderForm(sentEmail())
    rerender(<OutreachForm {...props} notice="No reply yet." />)
    expect(screen.getByRole('status').textContent).toBe('No reply yet.')
  })
})
