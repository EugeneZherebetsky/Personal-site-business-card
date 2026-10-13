-- Replies detected on a Gmail thread the user has already written to.
--
-- This is a derived cache, not a source of truth: it records that a message
-- arrived on a thread, never the body of that message. `application_sends` is
-- deliberately insert-only, so detected replies live here rather than mutating
-- immutable send history.

create table if not exists public.email_replies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_type text not null,
  source_id uuid not null,
  thread_id text not null,
  provider_message_id text not null,
  from_address text,
  subject text,
  received_at timestamptz not null,
  detected_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb,
  constraint email_replies_source_type_check check (source_type in ('job', 'outreach'))
);

-- One row per Gmail message, so repeated checks never accumulate duplicates.
create unique index if not exists email_replies_message_idx
  on public.email_replies (user_id, provider_message_id);

create index if not exists email_replies_source_idx
  on public.email_replies (user_id, source_type, source_id, received_at desc);

create index if not exists email_replies_thread_idx
  on public.email_replies (user_id, thread_id);

alter table public.email_replies enable row level security;

create policy "Users can view own email replies"
on public.email_replies for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy "Users can record own email replies"
on public.email_replies for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and (select auth.uid()) = user_id
  and (
    (
      source_type = 'job'
      and exists (select 1 from public.jobs where jobs.id = email_replies.source_id and jobs.user_id = (select auth.uid()))
    )
    or (
      source_type = 'outreach'
      and exists (select 1 from public.outreach_emails where outreach_emails.id = email_replies.source_id and outreach_emails.user_id = (select auth.uid()))
    )
  )
);

create policy "Users can delete own email replies"
on public.email_replies for delete
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

revoke all on table public.email_replies from anon;
revoke all on table public.email_replies from authenticated;
grant select, insert, delete on table public.email_replies to authenticated;
grant all on table public.email_replies to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'email_replies'
  ) then
    alter publication supabase_realtime add table public.email_replies;
  end if;
end $$;
