# Opportunity Desk

A private, synchronized job-search workspace: track applications through a pipeline board, keep tailored CVs, work your network, prepare for interviews, get follow-up reminders, and see which channels and CV versions actually produce interviews.

Each person signs in to their own Supabase-backed workspace; row-level security keeps every record private to its owner. The reference deployment runs at `jobs.ezherebetskii.com`.

| Path | What it is |
|---|---|
| `jobs-app/` | React + Vite browser application |
| `supabase/` | Database migrations and Edge Functions |

## Run it locally

```bash
cd jobs-app
npm install
cp .env.example .env.local   # fill in your Supabase project values
npm run dev                  # http://localhost:5173
npm test                     # unit tests
npm run build                # type-check and production build
npm run format               # Prettier
```

Features, architecture, delivery history and the roadmap live in
[`jobs-app/README.md`](jobs-app/README.md) and [`jobs-app/DEVELOPER.md`](jobs-app/DEVELOPER.md).

## Supabase

Migrations are in `supabase/migrations/` and Edge Functions in
`supabase/functions/`. Apply them with the Supabase CLI:

```bash
supabase db push
supabase functions deploy tailor-cv
supabase functions deploy send-reminders
```

Secrets used by the functions: `OPENAI_API_KEY`, `SUPABASE_SECRET_KEY`, and
optionally `OPENAI_MODEL`, `AI_DAILY_LIMIT`, `ALLOWED_ORIGINS`. Scheduled
reminders also need the Vault secrets described in
[`jobs-app/README.md`](jobs-app/README.md).

## Deploying

Build `jobs-app` with `npm run build` and serve `jobs-app/dist` from any static
host. The reference deployment uses Cloudflare Pages.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Continuous integration runs tests,
type-check and the production build on every pull request.

## License

[MIT](LICENSE)
