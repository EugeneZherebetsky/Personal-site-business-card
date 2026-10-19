# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Email
**contact@ezherebetskii.com** with a description, the affected area, and steps
to reproduce. You can expect an acknowledgement within 5 working days.

## Scope

- The static personal site at `ezherebetskii.com`
- Opportunity Desk at `jobs.ezherebetskii.com` (`jobs-app/`)
- Supabase database policies and Edge Functions (`supabase/`)
- The Job Tracker MCP server at `mcp.ezherebetskii.com` ([docs/mcp-server.md](docs/mcp-server.md))

## Secrets

Only publishable keys belong in `jobs-app/.env.local` and the client bundle.
Service role and provider API keys live exclusively in Supabase function
secrets, Supabase Vault and Cloudflare Worker secrets, and are never committed.
This repository is public: documentation must not contain keys, tokens,
personal data or job-search records.
