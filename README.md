# Startup Race

Startup Race is a Spanish-language multiplayer board game in which two to four
players build a company through validation, prototyping, launch, and growth.
The browser is a view and command client; PostgreSQL is authoritative for turns,
random outcomes, resources, deadlines, victory, and final ranking.

The product contract and delivery scope live in [PLAN.md](./PLAN.md). Engineering
terminology is defined in [CONTEXT.md](./CONTEXT.md), and architectural decisions
are recorded under [`docs/adr`](./docs/adr).

## Requirements

- Node.js 22
- pnpm 11
- Docker Desktop or another Docker-compatible runtime for local Supabase
- Supabase CLI (installed as a project dependency)

## Local development

```bash
pnpm install
cp .env.example .env.local
pnpm supabase:start
pnpm supabase:reset
pnpm dev
```

Copy the local API URL and anonymous/publishable key printed by
`pnpm supabase:start` into `.env.local`. Only the three public values documented
in `.env.example` may be exposed to Vite. Never put a Supabase secret or service
role key in a `VITE_` variable.

## Quality commands

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:run
pnpm test:db
pnpm build
pnpm test:e2e
pnpm check
```

`pnpm check` is the fast frontend gate. CI runs the same checks and then adds the
Chromium end-to-end suite. `pnpm test:db` runs the pgTAP suite against the local
Supabase stack.

## Deployment

1. Create a Supabase project, enable anonymous sign-ins, and apply the migrations.
2. Allow the deployment's exact hostname on the existing Turnstile widget. For
   local development, allow `localhost` and `127.0.0.1` if both are used.
3. Import this repository into Vercel.
4. Configure these three browser-facing variables in both Vercel Preview and
   Production, then redeploy so Vite includes the new values in the build:

   | Vercel variable                 | Value                                      |
   | ------------------------------- | ------------------------------------------ |
   | `VITE_SUPABASE_URL`             | Project URL from Supabase's Connect dialog |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key from the same project      |
   | `VITE_TURNSTILE_SITE_KEY`       | Existing widget's public site key          |

   In Supabase Authentication → Bot and Abuse Protection, enable CAPTCHA,
   choose Cloudflare Turnstile, and enter the **Turnstile secret** there. Supabase
   Auth validates each token when the app creates an anonymous identity. The
   Turnstile secret, Supabase secret/service-role key, database password, and
   Cloudflare API token must never be added as `VITE_` variables or committed.

5. Set the Supabase Auth site URL and redirect allow-list to the deployed domains.
6. Verify a preview deployment before promoting `main` to production.

No provider secret belongs in Vercel client variables. Provider setup must stop
for approval if any step would incur a charge.

## Recovery and shutdown

- A client can reload safely: its anonymous Supabase identity identifies the same
  seat in the same browser, and `?room=ABC123` identifies the Sala.
- If a deployment is unhealthy, roll Vercel back to the last green deployment;
  do not roll back a database migration without a reviewed compensating migration.
- After the demonstration period, delete transient Sala, Jugador, and action rows,
  then disable anonymous sign-ins if the deployment is no longer needed.

## License

[MIT](./LICENSE)
