# ezherebetskii-site

Personal site of Evgenii Zherebetskii plus **Opportunity Desk**, a private job-search workspace,
and the **Job Tracker MCP server** that gives Claude access to the same data.

| Path | What it is |
|---|---|
| `index.html`, `styles.css`, `assets/` | Static personal site served at `ezherebetskii.com` |
| `jobs-app/` | React + Vite application served at `jobs.ezherebetskii.com` |
| `supabase/` | Database migrations and Edge Functions backing the jobs app |
| `docs/` | System architecture and the Job Tracker MCP reference |

The MCP server (`mcp.ezherebetskii.com`) is a Cloudflare Worker maintained in a separate project;
it is documented in [`docs/mcp-server.md`](docs/mcp-server.md).

## Documentation

| Document | Covers |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The whole system: components, domains, data flows, security, deployment, known gaps |
| [`jobs-app/DEVELOPER.md`](jobs-app/DEVELOPER.md) | Opportunity Desk design, database map, migration history, engineering rules |
| [`docs/mcp-server.md`](docs/mcp-server.md) | Job Tracker MCP tools, setup, security, operations, troubleshooting |

## Personal site

Static HTML and CSS with no build step. Open `index.html` locally, or deploy the
repository root as-is.

## Opportunity Desk (`jobs-app/`)

```bash
cd jobs-app
npm install
cp .env.example .env.local   # fill in your Supabase project values
npm run dev                  # http://localhost:5173
npm test                     # unit tests
npm run build                # type-check and production build
npm run format               # Prettier
```

Architecture, delivery history and the roadmap live in
[`jobs-app/DEVELOPER.md`](jobs-app/DEVELOPER.md).

## Supabase

Migrations are in `supabase/migrations/` and Edge Functions in
`supabase/functions/`. Apply them with the Supabase CLI:

```bash
supabase db push
supabase functions deploy tailor-cv
supabase functions deploy send-reminders
```

Secrets used by the functions:

| Function | Required | Optional |
|---|---|---|
| `tailor-cv` | `OPENAI_API_KEY`, `SUPABASE_SECRET_KEY` | `OPENAI_MODEL`, `AI_DAILY_LIMIT`, `ALLOWED_ORIGINS` |
| `send-reminders` | `RESEND_API_KEY`, `REMINDER_FROM_EMAIL`, `REMINDER_CRON_SECRET`, `SUPABASE_SECRET_KEY` | |

The cron job reads the matching `reminder_cron_secret` from Supabase Vault.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Continuous integration runs tests,
type-check and the production build on every pull request.

## License

[MIT](LICENSE)
