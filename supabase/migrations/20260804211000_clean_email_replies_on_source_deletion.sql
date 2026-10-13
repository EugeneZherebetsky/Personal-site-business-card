-- Clean up cached email replies when their polymorphic source (job or outreach) is deleted.
--
-- `email_replies.source_id` is a polymorphic UUID pointing to either `jobs.id`
-- or `outreach_emails.id`, so foreign key ON DELETE CASCADE cannot be used.
-- This trigger automatically purges associated replies on source deletion so
-- orphan rows do not linger, retain sender addresses and subjects indefinitely,
-- or consume the 1,000-row workspace fetch limit.

create or replace function private.clean_email_replies_for_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'jobs' then
    delete from public.email_replies
    where source_type = 'job'
      and source_id = old.id
      and user_id = old.user_id;
  elsif tg_table_name = 'outreach_emails' then
    delete from public.email_replies
    where source_type = 'outreach'
      and source_id = old.id
      and user_id = old.user_id;
  end if;

  return old;
end;
$$;

revoke execute on function private.clean_email_replies_for_source()
from public, anon, authenticated, service_role;

drop trigger if exists jobs_clean_email_replies on public.jobs;
create trigger jobs_clean_email_replies
after delete on public.jobs
for each row execute function private.clean_email_replies_for_source();

drop trigger if exists outreach_emails_clean_email_replies on public.outreach_emails;
create trigger outreach_emails_clean_email_replies
after delete on public.outreach_emails
for each row execute function private.clean_email_replies_for_source();

-- Clean up any existing orphan reply rows created prior to this trigger.
delete from public.email_replies
where (source_type = 'job' and not exists (
  select 1 from public.jobs where public.jobs.id = email_replies.source_id
))
or (source_type = 'outreach' and not exists (
  select 1 from public.outreach_emails where public.outreach_emails.id = email_replies.source_id
));
