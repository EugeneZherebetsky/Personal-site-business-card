import type { RealtimeChannel, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { listApplicationSends } from './applicationSends'
import { listContacts } from './contacts'
import { listCVBlocks } from './cvBlocks'
import { listCVs } from './cvs'
import { listEmailReplies } from './emailReplies'
import { listInterviewPreps } from './interviewPreps'
import { listJobs } from './jobs'
import { listOutreachEmails } from './outreachEmails'
import { readSettings } from './settings'
import { listAllStageEvents } from './stageEvents'
import { listStarStories } from './starStories'

/** One round trip for everything the workspace shows. */
export async function fetchWorkspace(userId: string) {
  const [jobs, cvs, settings, sends, contacts, stories, preps, stageEvents, blocks, outreach, replies] = await Promise.all([
    listJobs(),
    listCVs(),
    readSettings(userId),
    listApplicationSends(),
    listContacts(),
    listStarStories(),
    listInterviewPreps(),
    listAllStageEvents(),
    listCVBlocks(),
    listOutreachEmails(),
    listEmailReplies(),
  ])
  return { jobs, cvs, settings, sends, contacts, stories, preps, stageEvents, blocks, outreach, replies }
}

type WorkspaceListeners = {
  /** Any synchronized record changed. */
  onChange: () => void
  /** A contact interaction changed, so open contact history must reload too. */
  onNetworkingChange: () => void
}

type WatchedEvent = 'INSERT' | 'UPDATE' | '*'

/**
 * Tables whose changes only need the workspace reloaded, with the events each
 * one listens for.
 *
 * Most tables deliberately skip DELETE: a filtered DELETE subscription cannot
 * reliably identify the former owner, so those tables announce deletions on
 * the private channel instead (the `*_broadcast_deletion` triggers in
 * `supabase/migrations`). Keep this list in step with those triggers.
 */
export const WATCHED_TABLES: ReadonlyArray<readonly [table: string, events: readonly WatchedEvent[]]> = [
  ['jobs', ['*']],
  ['cvs', ['INSERT', 'UPDATE']],
  ['user_settings', ['*']],
  ['application_sends', ['INSERT']],
  ['contacts', ['INSERT', 'UPDATE']],
  ['star_stories', ['INSERT', 'UPDATE']],
  ['interview_preps', ['INSERT', 'UPDATE']],
  ['job_stage_events', ['INSERT']],
  ['cv_blocks', ['INSERT', 'UPDATE']],
  ['outreach_emails', ['INSERT', 'UPDATE']],
  // Replies are only ever inserted. They are deleted with their job or
  // outreach message, whose own deletion already reloads the workspace.
  ['email_replies', ['INSERT']],
]

/** Contact interactions also refresh the open contact's history. */
const NETWORKING_EVENTS: readonly WatchedEvent[] = ['INSERT', 'UPDATE']

/** Subscribes to this user's private synchronization channel. */
export async function subscribeToWorkspace(session: Session, listeners: WorkspaceListeners): Promise<RealtimeChannel> {
  await supabase.realtime.setAuth(session.access_token)
  const filter = `user_id=eq.${session.user.id}`
  let channel = supabase.channel(`opportunity-desk:${session.user.id}`, { config: { private: true } })

  for (const [table, events] of WATCHED_TABLES) {
    for (const event of events) {
      channel = channel.on('postgres_changes', { event, schema: 'public', table, filter }, listeners.onChange)
    }
  }
  for (const event of NETWORKING_EVENTS) {
    channel = channel.on(
      'postgres_changes',
      { event, schema: 'public', table: 'contact_interactions', filter },
      listeners.onNetworkingChange,
    )
  }
  channel = channel
    .on('broadcast', { event: 'cv_deleted' }, listeners.onChange)
    .on('broadcast', { event: 'record_deleted' }, listeners.onNetworkingChange)

  return channel.subscribe()
}

export function unsubscribeFromWorkspace(channel: RealtimeChannel) {
  return supabase.removeChannel(channel)
}

export function signOutWorkspace() {
  return supabase.auth.signOut()
}
