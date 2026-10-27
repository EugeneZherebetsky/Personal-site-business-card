-- Opt-in server-delivered reminder emails: settings, delivery deduplication,
-- and an hourly schedule that invokes the send-reminders Edge Function.

alter table public.user_settings
  add column if not exists email_reminders_enabled boolean not null default false,
  add column if not exists email_reminder_hour integer not null default 8;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_settings_email_reminder_hour_check'
      and conrelid = 'public.user_settings'::regclass
  ) then
    alter table public.user_settings
      add constraint user_settings_email_reminder_hour_check
      check (email_reminder_hour between 0 and 23);
  end if;
end $$;

-- Server-managed log of sent reminders so one due action is never emailed
-- twice. Users can read their own history; only the server writes it.
create table if not exists public.reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_type text not null,
  item_id uuid not null,
  next_action_at timestamptz not null,
  sent_at timestamptz not null default now(),
  constraint reminder_deliveries_item_type_check check (item_type in ('job', 'contact'))
);

create unique index if not exists reminder_deliveries_dedupe_idx
  on public.reminder_deliveries (user_id, item_type, item_id, next_action_at);

create index if not exists reminder_deliveries_user_sent_idx
  on public.reminder_deliveries (user_id, sent_at desc);

alter table public.reminder_deliveries enable row level security;

create policy "Users can view own reminder deliveries"
on public.reminder_deliveries for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

revoke all on table public.reminder_deliveries from anon, authenticated;
grant select on table public.reminder_deliveries to authenticated;
grant all on table public.reminder_deliveries to service_role;

-- Hourly trigger for the send-reminders Edge Function. The function decides
-- per user whether the local delivery hour matches and what is newly due.
-- The shared secret lives in Vault under the name 'reminder_cron_secret' and
-- is read at execution time, so this migration stores no secret material.
-- The project URL (https://<project-ref>.supabase.co) is read the same way
-- from the Vault secret 'project_url', so the migration works in any project.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'opportunity-desk-reminder-digests',
  '5 * * * *',
  $cron$
  select net.http_post(
    url := coalesce(
      (select decrypted_secret from vault.decrypted_secrets where name = 'project_url'),
      ''
    ) || '/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-reminder-secret', coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_cron_secret'),
        ''
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cron$
);
