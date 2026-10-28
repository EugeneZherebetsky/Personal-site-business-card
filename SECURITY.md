# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Email
**contact@ezherebetskii.com** with a description, the affected area, and steps
to reproduce. You can expect an acknowledgement within 5 working days.

## Scope

- Opportunity Desk at `jobs.ezherebetskii.com` (`jobs-app/`)
- Supabase database policies and Edge Functions (`supabase/`)

## Secrets

Only publishable keys belong in `jobs-app/.env.local` and the client bundle.
Service role and provider API keys live exclusively in Supabase function
secrets and are never committed.
