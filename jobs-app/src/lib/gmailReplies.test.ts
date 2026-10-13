import { describe, expect, it } from 'vitest'
import {
  checkableSends,
  classifyMessage,
  findThreadReplies,
  headerValue,
  matchLostSend,
  normalizeAddress,
  storedReplyKind,
  summarizeReplies,
} from './gmailReplies'
import type { GmailMessageMetadata } from './google'

function message(
  id: string,
  headers: Record<string, string>,
  isoDate: string,
  labelIds: string[] = ['INBOX'],
): GmailMessageMetadata {
  return {
    id,
    threadId: 'thread-1',
    labelIds,
    internalDate: String(new Date(isoDate).getTime()),
    payload: { headers: Object.entries(headers).map(([name, value]) => ({ name, value })) },
  }
}

const SENT_AT = '2026-08-01T10:00:00.000Z'

describe('normalizeAddress and headerValue', () => {
  it('extracts a bare address from a display-name header', () => {
    expect(normalizeAddress('Dana Lead <Dana@Example.com>')).toBe('dana@example.com')
    expect(normalizeAddress('  PLAIN@Example.com ')).toBe('plain@example.com')
  })

  it('reads headers case-insensitively', () => {
    const sample = message('m1', { FROM: 'a@b.com', subject: 'Hello' }, '2026-08-01T10:00:00Z')
    expect(headerValue(sample, 'From')).toBe('a@b.com')
    expect(headerValue(sample, 'SUBJECT')).toBe('Hello')
    expect(headerValue(sample, 'Missing')).toBe('')
  })
})

describe('classifyMessage', () => {
  const at = '2026-08-02T09:00:00Z'

  it('treats an ordinary answer as a reply', () => {
    expect(
      classifyMessage(message('m', { From: 'dana@example.com', Subject: 'Re: Intro' }, at)),
    ).toBe('reply')
  })

  it('recognises bounces by sender, failed-recipient header, or delivery report', () => {
    expect(
      classifyMessage(
        message('a', { From: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>' }, at),
      ),
    ).toBe('bounce')
    expect(classifyMessage(message('b', { From: 'postmaster@example.com' }, at))).toBe('bounce')
    expect(
      classifyMessage(
        message('c', { From: 'relay@example.com', 'X-Failed-Recipients': 'dana@example.com' }, at),
      ),
    ).toBe('bounce')
    expect(
      classifyMessage(
        message(
          'd',
          {
            From: 'relay@example.com',
            'Content-Type': 'multipart/report; report-type=delivery-status; boundary="x"',
          },
          at,
        ),
      ),
    ).toBe('bounce')
  })

  it('recognises automatic replies by header', () => {
    expect(
      classifyMessage(
        message('a', { From: 'dana@example.com', 'Auto-Submitted': 'auto-replied' }, at),
      ),
    ).toBe('auto_reply')
    expect(
      classifyMessage(message('b', { From: 'dana@example.com', 'X-Autoreply': 'yes' }, at)),
    ).toBe('auto_reply')
    expect(
      classifyMessage(message('c', { From: 'dana@example.com', Precedence: 'auto_reply' }, at)),
    ).toBe('auto_reply')
  })

  it('treats Auto-Submitted: no as a person', () => {
    expect(
      classifyMessage(message('a', { From: 'dana@example.com', 'Auto-Submitted': 'no' }, at)),
    ).toBe('reply')
  })

  it('recognises out-of-office subjects in English and Hungarian, but not a quoted one', () => {
    expect(
      classifyMessage(
        message('a', { From: 'dana@example.com', Subject: 'Automatic reply: Intro' }, at),
      ),
    ).toBe('auto_reply')
    expect(
      classifyMessage(
        message('b', { From: 'dana@example.com', Subject: 'Out of Office: back Monday' }, at),
      ),
    ).toBe('auto_reply')
    expect(
      classifyMessage(
        message('c', { From: 'dana@example.com', Subject: 'Automatikus válasz: Intro' }, at),
      ),
    ).toBe('auto_reply')
    expect(
      classifyMessage(
        message('d', { From: 'dana@example.com', Subject: 'Re: Out of office until Friday' }, at),
      ),
    ).toBe('reply')
  })
})

describe('findThreadReplies', () => {
  it('returns messages from other people, oldest first, with their kind', () => {
    const replies = findThreadReplies(
      [
        message('mine', { From: 'Me <me@example.com>', Subject: 'Intro' }, '2026-08-01T10:00:00Z', [
          'SENT',
        ]),
        message(
          'later',
          { From: 'Dana <dana@example.com>', Subject: 'Re: Intro' },
          '2026-08-03T09:00:00Z',
        ),
        message(
          'ooo',
          { From: 'sam@example.com', Subject: 'Automatic reply: Intro' },
          '2026-08-01T10:01:00Z',
        ),
      ],
      SENT_AT,
    )

    expect(replies.map((reply) => [reply.provider_message_id, reply.kind])).toEqual([
      ['ooo', 'auto_reply'],
      ['later', 'reply'],
    ])
    expect(replies[1]).toMatchObject({
      from_address: 'dana@example.com',
      thread_id: 'thread-1',
      subject: 'Re: Intro',
    })
    expect(replies[1].received_at).toBe('2026-08-03T09:00:00.000Z')
  })

  it('ignores our own mail by label, even when sent from an alias', () => {
    const replies = findThreadReplies(
      [
        message(
          'alias',
          { From: 'Eugene <eugene@my-domain.example>', Subject: 'Following up' },
          '2026-08-08T10:00:00Z',
          ['SENT'],
        ),
        message(
          'draft',
          { From: 'eugene@my-domain.example', Subject: 'Re: Intro' },
          '2026-08-09T10:00:00Z',
          ['DRAFT'],
        ),
      ],
      SENT_AT,
    )
    expect(replies).toEqual([])
  })

  it('ignores anything meaningfully older than our message', () => {
    expect(
      findThreadReplies(
        [message('old', { From: 'other@example.com' }, '2026-07-20T10:00:00Z')],
        SENT_AT,
      ),
    ).toEqual([])
  })

  it('tolerates small clock differences around the send time', () => {
    expect(
      findThreadReplies(
        [message('edge', { From: 'other@example.com' }, '2026-08-01T09:59:30Z')],
        SENT_AT,
      ),
    ).toHaveLength(1)
  })

  it('returns nothing when the send time or dates are unusable', () => {
    expect(
      findThreadReplies(
        [message('m', { From: 'other@example.com' }, '2026-08-02T10:00:00Z')],
        'not-a-date',
      ),
    ).toEqual([])
    expect(
      findThreadReplies(
        [{ id: 'm', payload: { headers: [{ name: 'From', value: 'other@example.com' }] } }],
        SENT_AT,
      ),
    ).toEqual([])
  })
})

describe('summarizeReplies', () => {
  it('only counts a person answering as the reply that marks a message replied', () => {
    const replies = findThreadReplies(
      [
        message('bounce', { From: 'mailer-daemon@googlemail.com' }, '2026-08-01T10:00:30Z'),
        message(
          'ooo',
          { From: 'dana@example.com', 'Auto-Submitted': 'auto-replied' },
          '2026-08-01T10:01:00Z',
        ),
      ],
      SENT_AT,
    )
    expect(summarizeReplies(replies)).toEqual({
      firstReply: null,
      replies: 0,
      autoReplies: 1,
      bounces: 1,
    })

    const answered = summarizeReplies([
      ...replies,
      ...findThreadReplies(
        [message('dana', { From: 'dana@example.com' }, '2026-08-02T08:00:00Z')],
        SENT_AT,
      ),
    ])
    expect(answered.firstReply?.provider_message_id).toBe('dana')
    expect(answered.replies).toBe(1)
  })
})

describe('checkableSends', () => {
  const send = (id: string, status: 'sent' | 'failed', sentAt: string, threadId?: unknown) =>
    ({
      id,
      user_id: 'user-1',
      job_id: 'job-1',
      cv_id: null,
      sent_at: sentAt,
      recipient: 'dana@example.com',
      subject: 'Application',
      provider: 'gmail',
      provider_message_id: id,
      status,
      details: threadId === undefined ? {} : { thread_id: threadId },
    }) as const

  it('keeps one entry per thread, measured from its earliest send', () => {
    const result = checkableSends([
      send('later', 'sent', '2026-08-05T10:00:00Z', 't1'),
      send('first', 'sent', '2026-08-01T10:00:00Z', 't1'),
      send('other', 'sent', '2026-08-02T10:00:00Z', 't2'),
    ])
    expect(result.map(({ threadId, send: kept }) => [threadId, kept.id])).toEqual([
      ['t1', 'first'],
      ['t2', 'other'],
    ])
  })

  it('skips failed sends and sends without a recorded thread', () => {
    expect(
      checkableSends([
        send('failed', 'failed', '2026-08-01T10:00:00Z', 't1'),
        send('no-thread', 'sent', '2026-08-01T10:00:00Z'),
        send('null-thread', 'sent', '2026-08-01T10:00:00Z', null),
      ]),
    ).toEqual([])
  })
})

describe('storedReplyKind', () => {
  it('reads the stored kind and treats older rows as replies', () => {
    expect(storedReplyKind({ data: { kind: 'bounce' } })).toBe('bounce')
    expect(storedReplyKind({ data: { kind: 'auto_reply' } })).toBe('auto_reply')
    expect(storedReplyKind({ data: {} })).toBe('reply')
    expect(storedReplyKind({ data: { kind: 'something-else' } })).toBe('reply')
  })
})

describe('matchLostSend', () => {
  const target = {
    recipient: 'dana@example.com',
    subject: 'IT leadership experience',
    attemptedAtIso: '2026-08-01T10:00:00.000Z',
  }
  const sent = (id: string, to: string, subject: string, iso: string) =>
    message(id, { To: to, Subject: subject }, iso, ['SENT'])

  it('finds our message by recipient, subject and time', () => {
    const found = matchLostSend(
      [
        sent('other-subject', 'dana@example.com', 'Something else', '2026-08-01T10:00:05Z'),
        sent(
          'wanted',
          'Dana Lead <dana@example.com>',
          'IT leadership experience',
          '2026-08-01T10:00:05Z',
        ),
      ],
      target,
    )
    expect(found?.id).toBe('wanted')
  })

  it('rejects a different recipient or an earlier message', () => {
    expect(
      matchLostSend(
        [sent('wrong', 'someone@else.com', target.subject, '2026-08-01T10:00:05Z')],
        target,
      ),
    ).toBeNull()
    expect(
      matchLostSend(
        [sent('early', 'dana@example.com', target.subject, '2026-08-01T09:00:00Z')],
        target,
      ),
    ).toBeNull()
  })

  it('returns null when nothing matches', () => {
    expect(matchLostSend([], target)).toBeNull()
  })

  it('ignores an identical message sent long after the attempt', () => {
    // The same subject and recipient sent by hand hours later must not be
    // attached to this attempt and frozen as the delivered message.
    expect(
      matchLostSend(
        [sent('later', 'dana@example.com', target.subject, '2026-08-01T16:00:00Z')],
        target,
      ),
    ).toBeNull()
  })

  it('accepts a delivery inside the window but not one just outside it', () => {
    expect(
      matchLostSend(
        [sent('inside', 'dana@example.com', target.subject, '2026-08-01T10:09:00Z')],
        target,
      )?.id,
    ).toBe('inside')
    expect(
      matchLostSend(
        [sent('outside', 'dana@example.com', target.subject, '2026-08-01T10:11:00Z')],
        target,
      ),
    ).toBeNull()
  })

  it('prefers the earliest match when several fall inside the window', () => {
    const original = sent('original', 'dana@example.com', target.subject, '2026-08-01T10:00:05Z')
    const duplicate = sent('duplicate', 'dana@example.com', target.subject, '2026-08-01T14:00:00Z')
    expect(matchLostSend([duplicate, original], target, 6 * 60 * 60_000)?.id).toBe('original')
  })
})
