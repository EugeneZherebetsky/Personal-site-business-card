import type { GmailMessageMetadata } from './google'
import type { ApplicationSend, EmailReply } from '../types'

/**
 * What arrived on a thread. Only a `reply` is a person answering; the other
 * two are machines, and must never mark an outreach message as replied or it
 * would silently drop out of follow-ups.
 */
export type ReplyKind = 'reply' | 'auto_reply' | 'bounce'

export const REPLY_KIND_LABELS: Record<ReplyKind, string> = {
  reply: 'Reply',
  auto_reply: 'Automatic reply',
  bounce: 'Delivery failure',
}

/**
 * A message on one of our threads that somebody else sent. Only header facts
 * are ever held: who, when, the subject, and what kind of message it is.
 * Bodies are neither requested nor stored.
 */
export type DetectedReply = {
  provider_message_id: string
  thread_id: string
  from_address: string
  subject: string
  received_at: string
  kind: ReplyKind
}

export function headerValue(message: GmailMessageMetadata, name: string) {
  const wanted = name.toLowerCase()
  const header = message.payload?.headers?.find(
    (candidate) => candidate.name?.toLowerCase() === wanted,
  )
  return header?.value ?? ''
}

/** Reduces `Dana Lead <dana@example.com>` to `dana@example.com`. */
export function normalizeAddress(value: string) {
  const angled = value.match(/<([^>]+)>/)
  return (angled ? angled[1] : value).trim().toLowerCase()
}

function receivedAt(message: GmailMessageMetadata) {
  if (!message.internalDate) return null
  const epoch = Number(message.internalDate)
  return Number.isFinite(epoch) ? epoch : null
}

/**
 * Labels Gmail puts on mail the mailbox owner wrote. Labels are used instead
 * of comparing the From address, which misses mail sent from a "Send mail as"
 * alias and would count it as somebody else answering. DRAFT covers a reply
 * the owner has started but not sent.
 */
const OWN_LABELS = new Set(['SENT', 'DRAFT'])

export function isOwnMessage(message: GmailMessageMetadata) {
  return Boolean(message.labelIds?.some((label) => OWN_LABELS.has(label)))
}

const BOUNCE_SENDER = /^(mailer-daemon|postmaster)@/

export function isBounce(message: GmailMessageMetadata) {
  if (BOUNCE_SENDER.test(normalizeAddress(headerValue(message, 'From')))) return true
  if (headerValue(message, 'X-Failed-Recipients').trim()) return true
  return /report-type\s*=\s*"?delivery-status/i.test(headerValue(message, 'Content-Type'))
}

/**
 * Subject prefixes common mail clients use for out-of-office answers, in
 * English and Hungarian. Headers are checked first; this catches clients
 * that set none.
 */
const AUTO_REPLY_SUBJECT =
  /^(automatic reply|auto[- ]?reply|autoreply|out of (the )?office|automatikus válasz)\b/i

export function isAutoReply(message: GmailMessageMetadata) {
  // RFC 3834: any value other than "no" marks an automatic message.
  const autoSubmitted = headerValue(message, 'Auto-Submitted').trim().toLowerCase()
  if (autoSubmitted && autoSubmitted !== 'no') return true
  if (headerValue(message, 'X-Autoreply').trim() || headerValue(message, 'X-Autorespond').trim())
    return true
  if (/^(auto_reply|bulk|junk)$/i.test(headerValue(message, 'Precedence').trim())) return true
  return AUTO_REPLY_SUBJECT.test(headerValue(message, 'Subject').trim())
}

export function classifyMessage(message: GmailMessageMetadata): ReplyKind {
  if (isBounce(message)) return 'bounce'
  if (isAutoReply(message)) return 'auto_reply'
  return 'reply'
}

/** Clock tolerance between our recorded send time and Gmail's. */
const SEND_TIME_TOLERANCE_MS = 60_000

/**
 * Messages on the thread that somebody else sent at or after our own
 * message, oldest first. A minute of tolerance absorbs clock differences
 * without reaching back to unrelated earlier mail.
 */
export function findThreadReplies(
  messages: GmailMessageMetadata[],
  sentAtIso: string,
): DetectedReply[] {
  const sentAt = new Date(sentAtIso).getTime()
  if (!Number.isFinite(sentAt)) return []

  return messages
    .map((message) => ({ message, at: receivedAt(message) }))
    .filter(
      (entry): entry is { message: GmailMessageMetadata; at: number } =>
        entry.at !== null && entry.at >= sentAt - SEND_TIME_TOLERANCE_MS,
    )
    .filter(({ message }) => !isOwnMessage(message))
    .sort((left, right) => left.at - right.at)
    .map(({ message, at }) => ({
      provider_message_id: message.id,
      thread_id: message.threadId ?? '',
      from_address: normalizeAddress(headerValue(message, 'From')),
      subject: headerValue(message, 'Subject'),
      received_at: new Date(at).toISOString(),
      kind: classifyMessage(message),
    }))
}

export type ThreadCheckSummary = {
  /** The first message from a person, if any; only this marks a reply. */
  firstReply: DetectedReply | null
  replies: number
  autoReplies: number
  bounces: number
}

export function summarizeReplies(replies: DetectedReply[]): ThreadCheckSummary {
  return {
    firstReply: replies.find((reply) => reply.kind === 'reply') ?? null,
    replies: replies.filter((reply) => reply.kind === 'reply').length,
    autoReplies: replies.filter((reply) => reply.kind === 'auto_reply').length,
    bounces: replies.filter((reply) => reply.kind === 'bounce').length,
  }
}

/**
 * The Gmail threads an application was sent on, one entry per thread, each
 * measured from the earliest send on it. Failed sends and sends recorded
 * without a thread cannot be checked.
 */
export function checkableSends(sends: ApplicationSend[]) {
  const byThread = new Map<string, ApplicationSend>()
  for (const send of sends) {
    const threadId = send.details?.thread_id
    if (send.status !== 'sent' || typeof threadId !== 'string' || !threadId) continue
    const known = byThread.get(threadId)
    if (!known || new Date(send.sent_at).getTime() < new Date(known.sent_at).getTime()) {
      byThread.set(threadId, send)
    }
  }
  return [...byThread].map(([threadId, send]) => ({ threadId, send }))
}

/** The kind of a stored reply. Rows recorded before kinds existed are replies. */
export function storedReplyKind(reply: Pick<EmailReply, 'data'>): ReplyKind {
  const kind = reply.data?.kind
  return kind === 'auto_reply' || kind === 'bounce' ? kind : 'reply'
}

/** Clock tolerance before the attempt, for skew between our clock and Gmail's. */
const LOST_SEND_TOLERANCE_MS = 120_000

/** How long after the attempt a delivery can still plausibly belong to it. */
export const LOST_SEND_WINDOW_MS = 10 * 60_000

/**
 * Finds our own message among recent sent mail, for a send whose response was
 * lost. Matching is on recipient, exact subject, and a send time inside a
 * narrow window around the attempt.
 *
 * The window has an upper bound on purpose. Recipient and subject alone would
 * also match the same message sent by hand hours later, and attaching that
 * message id would permanently record this attempt as the one that was
 * delivered.
 */
export function matchLostSend(
  candidates: GmailMessageMetadata[],
  target: { recipient: string; subject: string; attemptedAtIso: string },
  windowMs = LOST_SEND_WINDOW_MS,
): GmailMessageMetadata | null {
  const wantedTo = normalizeAddress(target.recipient)
  const wantedSubject = target.subject.trim().toLowerCase()
  const attemptedAt = new Date(target.attemptedAtIso).getTime()
  if (!Number.isFinite(attemptedAt)) return null
  const floor = attemptedAt - LOST_SEND_TOLERANCE_MS
  const ceiling = attemptedAt + windowMs

  const matches = candidates
    .map((message) => ({ message, at: receivedAt(message) }))
    .filter(({ message, at }) => {
      if (at === null || at < floor || at > ceiling) return false
      if (normalizeAddress(headerValue(message, 'To')) !== wantedTo) return false
      return headerValue(message, 'Subject').trim().toLowerCase() === wantedSubject
    })
  if (!matches.length) return null
  return matches.reduce((earliest, entry) =>
    (entry.at ?? 0) < (earliest.at ?? 0) ? entry : earliest,
  ).message
}
