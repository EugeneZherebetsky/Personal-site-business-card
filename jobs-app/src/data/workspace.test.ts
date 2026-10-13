import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'

type Listener = { type: string; filter: Record<string, unknown>; callback: unknown }

const listeners: Listener[] = []
const channels: Array<{ name: string; options: unknown }> = []

vi.mock('../lib/supabase', () => {
  const channel = {
    on(type: string, filter: Record<string, unknown>, callback: unknown) {
      listeners.push({ type, filter, callback })
      return channel
    },
    subscribe: () => channel,
  }
  return {
    supabase: {
      realtime: { setAuth: async () => {} },
      channel: (name: string, options: unknown) => {
        channels.push({ name, options })
        return channel
      },
    },
  }
})

const { subscribeToWorkspace } = await import('./workspace')

const session = { access_token: 'token', user: { id: 'user-1' } } as Session
const onChange = () => {}
const onNetworkingChange = () => {}

/**
 * Tables that announce deletions through a `*_broadcast_deletion` trigger.
 * They must not also listen for Postgres DELETE events.
 */
const BROADCAST_DELETION_TABLES = [
  'cvs',
  'contacts',
  'contact_interactions',
  'star_stories',
  'interview_preps',
  'cv_blocks',
  'outreach_emails',
]

function postgresSubscriptions() {
  return listeners
    .filter((listener) => listener.type === 'postgres_changes')
    .map((listener) => ({
      table: listener.filter.table as string,
      event: listener.filter.event as string,
      handler: listener.callback === onChange ? 'change' : 'networking',
    }))
}

beforeEach(async () => {
  listeners.length = 0
  channels.length = 0
  await subscribeToWorkspace(session, { onChange, onNetworkingChange })
})

describe('subscribeToWorkspace', () => {
  it('listens for the same events as before the data-layer refactor', () => {
    const expected = [
      ['jobs', '*', 'change'],
      ['cvs', 'INSERT', 'change'],
      ['cvs', 'UPDATE', 'change'],
      ['user_settings', '*', 'change'],
      ['application_sends', 'INSERT', 'change'],
      ['contacts', 'INSERT', 'change'],
      ['contacts', 'UPDATE', 'change'],
      ['contact_interactions', 'INSERT', 'networking'],
      ['contact_interactions', 'UPDATE', 'networking'],
      ['star_stories', 'INSERT', 'change'],
      ['star_stories', 'UPDATE', 'change'],
      ['interview_preps', 'INSERT', 'change'],
      ['interview_preps', 'UPDATE', 'change'],
      ['job_stage_events', 'INSERT', 'change'],
      ['cv_blocks', 'INSERT', 'change'],
      ['cv_blocks', 'UPDATE', 'change'],
      ['outreach_emails', 'INSERT', 'change'],
      ['outreach_emails', 'UPDATE', 'change'],
      ['email_replies', 'INSERT', 'change'],
    ].map(([table, event, handler]) => ({ table, event, handler }))

    const byKey = (
      left: { table: string; event: string },
      right: { table: string; event: string },
    ) => `${left.table}:${left.event}`.localeCompare(`${right.table}:${right.event}`)
    expect(postgresSubscriptions().sort(byKey)).toEqual(expected.sort(byKey))
  })

  it('leaves deletions on broadcast-trigger tables to the private channel', () => {
    const deleteListeners = postgresSubscriptions().filter(
      (subscription) =>
        BROADCAST_DELETION_TABLES.includes(subscription.table) &&
        (subscription.event === '*' || subscription.event === 'DELETE'),
    )
    expect(deleteListeners).toEqual([])

    const broadcasts = listeners
      .filter((listener) => listener.type === 'broadcast')
      .map((listener) => [listener.filter.event, listener.callback])
    expect(broadcasts).toEqual([
      ['cv_deleted', onChange],
      ['record_deleted', onNetworkingChange],
    ])
  })

  it("scopes every database subscription to the user's private channel", () => {
    expect(channels).toEqual([
      { name: 'opportunity-desk:user-1', options: { config: { private: true } } },
    ])
    for (const listener of listeners.filter((entry) => entry.type === 'postgres_changes')) {
      expect(listener.filter).toMatchObject({ schema: 'public', filter: 'user_id=eq.user-1' })
    }
  })
})
