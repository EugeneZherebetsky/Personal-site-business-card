import { supabase } from '../lib/supabase'
import type { DetectedReply } from '../lib/gmailReplies'
import type { EmailReply } from '../types'

const TABLE = 'email_replies'
const PAGE_SIZE = 1000

/**
 * Every detected reply, newest first. Paged because the API caps each request
 * at `max_rows`, so a single capped query would silently drop rows.
 */
export async function listEmailReplies(): Promise<{
  data: EmailReply[] | null
  error: { message: string } | null
}> {
  const replies: EmailReply[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .order('received_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) return { data: null, error }
    const page = (data ?? []) as EmailReply[]
    replies.push(...page)
    if (page.length < PAGE_SIZE) return { data: replies, error: null }
  }
}

/**
 * Stores detected replies against an application or outreach message. The
 * unique (user, Gmail message id) index makes this idempotent, so checking a
 * thread again never creates duplicates. The kind lives in `data`.
 */
export function recordEmailReplies(
  userId: string,
  sourceType: EmailReply['source_type'],
  sourceId: string,
  replies: DetectedReply[],
) {
  return supabase.from(TABLE).upsert(
    replies.map(({ kind, ...reply }) => ({
      ...reply,
      user_id: userId,
      source_type: sourceType,
      source_id: sourceId,
      data: { kind },
    })),
    { onConflict: 'user_id,provider_message_id', ignoreDuplicates: true },
  )
}
