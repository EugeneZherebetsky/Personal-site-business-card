import type { OutreachDraft, OutreachEmail, ReplyStatus } from '../types'
import { clean, toLocalDateTimeInput } from './opportunities'

/** Days after sending when a first follow-up is proposed. */
export const DEFAULT_FOLLOW_UP_DAYS = 6

export function outreachToDraft(email: OutreachEmail): OutreachDraft {
  return {
    company: email.company,
    recipient_name: email.recipient_name ?? '',
    recipient_role: email.recipient_role ?? '',
    recipient_email: email.recipient_email,
    contact_id: email.contact_id ?? '',
    cv_id: email.cv_id ?? '',
    subject: email.subject,
    body: email.body,
    follow_up_at: toLocalDateTimeInput(email.follow_up_at),
    notes: email.notes ?? '',
  }
}

export function outreachDraftToPayload(draft: OutreachDraft) {
  return {
    company: draft.company.trim(),
    recipient_name: clean(draft.recipient_name),
    recipient_role: clean(draft.recipient_role),
    recipient_email: draft.recipient_email.trim(),
    contact_id: clean(draft.contact_id),
    cv_id: clean(draft.cv_id),
    subject: draft.subject.trim(),
    body: draft.body,
    follow_up_at: draft.follow_up_at ? new Date(draft.follow_up_at).toISOString() : null,
    notes: clean(draft.notes),
  }
}

/** A local `datetime-local` value a number of days from now, at 09:00. */
export function followUpDateInput(days = DEFAULT_FOLLOW_UP_DAYS, from = new Date()) {
  const target = new Date(from)
  target.setDate(target.getDate() + days)
  target.setHours(9, 0, 0, 0)
  return toLocalDateTimeInput(target.toISOString())
}

export type OutreachFilter = 'all' | 'draft' | 'sending' | 'awaiting' | 'replied' | 'no_reply'

export function outreachMatches(email: OutreachEmail, search: string, filter: OutreachFilter) {
  const needle = search.trim().toLowerCase()
  const matchesFilter = filter === 'all'
    || (filter === 'draft' && email.status === 'draft')
    || (filter === 'sending' && email.status === 'sending')
    || (email.status === 'sent' && email.reply_status === filter)
  const matchesSearch = !needle || [
    email.company,
    email.recipient_name ?? '',
    email.recipient_role ?? '',
    email.recipient_email,
    email.subject,
    email.body,
    email.notes ?? '',
  ].some((value) => value.toLowerCase().includes(needle))
  return matchesFilter && matchesSearch
}

export type OutreachSummary = {
  drafts: number
  unknown: number
  sent: number
  awaiting: number
  replied: number
  noReply: number
  companies: number
}

export function outreachSummary(emails: OutreachEmail[]): OutreachSummary {
  const sent = emails.filter((email) => email.status === 'sent')
  const replyCount = (status: ReplyStatus) => sent.filter((email) => email.reply_status === status).length
  return {
    drafts: emails.filter((email) => email.status === 'draft').length,
    unknown: emails.filter((email) => email.status === 'sending').length,
    sent: sent.length,
    awaiting: replyCount('awaiting'),
    replied: replyCount('replied'),
    noReply: replyCount('no_reply'),
    companies: new Set(sent.map((email) => email.company.trim().toLowerCase()).filter(Boolean)).size,
  }
}

/** Outreach follow-ups that are due, soonest first. Replied threads are done. */
export function dueOutreachFollowUps(emails: OutreachEmail[]) {
  return emails
    .filter((email) => email.status === 'sent' && email.follow_up_at && email.reply_status !== 'replied')
    .sort((left, right) => new Date(left.follow_up_at!).getTime() - new Date(right.follow_up_at!).getTime())
}

/**
 * A starting subject and body for a speculative message. Deliberately leaves
 * the specific reason for writing blank: a message without it reads as a
 * circular and is the main reason cold outreach is ignored.
 */
export function suggestedOutreach(company: string, recipientName: string, senderName?: string | null) {
  // A bracketed placeholder blocks sending until the user signs the message.
  const signature = senderName?.trim() || '[Your name]'
  const firstName = recipientName.trim().split(/\s+/)[0] ?? ''
  const greeting = firstName ? `Dear ${firstName},` : 'Dear Sir or Madam,'
  const target = company.trim() || '[company]'
  return {
    subject: `IT leadership experience for ${target}`,
    body: [
      greeting,
      '',
      `I am writing to you directly rather than in response to an advertised role. [Say in one sentence why ${target} specifically — a project, a plant, a recent change.]`,
      '',
      '[Two or three lines on the experience that is relevant to them, with one concrete outcome.]',
      '',
      'If it would be useful, I would welcome a short conversation, whether or not there is anything open at the moment. My CV is attached for context.',
      '',
      'Kind regards,',
      signature,
    ].join('\n'),
  }
}

/** True when the body still contains an unfilled placeholder. */
export function hasUnfilledPlaceholder(body: string) {
  return /\[[^\]]{4,}\]/.test(body)
}
