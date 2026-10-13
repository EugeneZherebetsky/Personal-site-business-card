import { supabase } from '../lib/supabase'
import type { OutreachEmail } from '../types'
import { saveVersioned, type SaveResult } from './versioned'

const TABLE = 'outreach_emails'

export function listOutreachEmails() {
  return supabase.from(TABLE).select('*').order('updated_at', { ascending: false }).limit(1000)
}

export function saveOutreachRecord(editing: OutreachEmail | 'new', payload: object, userId: string): Promise<SaveResult<OutreachEmail>> {
  return saveVersioned<OutreachEmail>(TABLE, editing, payload, userId, { status: 'draft' })
}

/** Writes the draft the send flow is about to deliver, returning its version. */
export function persistOutreachForSend(editing: OutreachEmail | 'new', payload: object, userId: string) {
  return editing === 'new'
    ? supabase.from(TABLE).insert({ ...payload, user_id: userId, status: 'draft' }).select('id, version').maybeSingle()
    : supabase.from(TABLE).update(payload).eq('id', editing.id).eq('version', editing.version).select('id, version').maybeSingle()
}

/**
 * Commits the send attempt before Gmail is called. The version must match the
 * text this client just wrote, or a concurrent edit would be frozen as the
 * delivered message while older text actually left the mailbox.
 */
export function claimOutreachForSending(id: string, version: number, attemptedAt: string) {
  return supabase
    .from(TABLE)
    .update({ status: 'sending', send_attempt_id: crypto.randomUUID(), send_attempted_at: attemptedAt })
    .eq('id', id)
    .eq('status', 'draft')
    .eq('version', version)
    .select('id')
    .maybeSingle()
}

/** Returns a claimed message to an editable draft after Gmail refused it outright. */
export function releaseOutreachClaim(id: string) {
  return supabase
    .from(TABLE)
    .update({ status: 'draft', send_attempt_id: null, send_attempted_at: null })
    .eq('id', id)
    .eq('status', 'sending')
}

export function markOutreachSent(id: string, record: { sent_at: string; provider_message_id: string; provider_thread_id: string | null; attachment_filename: string | null }) {
  return supabase
    .from(TABLE)
    .update({
      status: 'sent',
      sent_at: record.sent_at,
      provider_message_id: record.provider_message_id,
      provider_thread_id: record.provider_thread_id,
      attachment_filename: record.attachment_filename,
    })
    .eq('id', id)
    .eq('status', 'sending')
    .select('id')
    .maybeSingle()
}

export function readOutreachMessageId(id: string) {
  return supabase.from(TABLE).select('id, provider_message_id').eq('id', id).maybeSingle()
}

/** Records the user's own answer about a send whose Gmail response was lost. */
export function resolveOutreachAttempt(id: string, payload: object) {
  return supabase.from(TABLE).update(payload).eq('id', id).eq('status', 'sending').select('id').maybeSingle()
}

export function updateOutreachOutcome(email: OutreachEmail, payload: object) {
  return supabase.from(TABLE).update(payload).eq('id', email.id).eq('version', email.version).select('id').maybeSingle()
}

/**
 * Marks a sent message replied after a person answered on its Gmail thread.
 * Returns the whole row so an open editor can replace its copy and keep its
 * version current.
 */
export function markOutreachReplied(email: OutreachEmail, repliedAt: string) {
  return supabase
    .from(TABLE)
    .update({ reply_status: 'replied', replied_at: repliedAt })
    .eq('id', email.id)
    .eq('version', email.version)
    .select('*')
    .maybeSingle()
}

export function deleteOutreachRow(email: OutreachEmail) {
  return supabase.from(TABLE).delete().eq('id', email.id).eq('version', email.version).select('id').maybeSingle()
}
