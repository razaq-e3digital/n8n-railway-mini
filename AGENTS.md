# Agent brief: deploy n8n to Railway

## Scope (read first)
This file governs a minimal deployment repository whose only job is to deploy n8n to
Railway as a prebuilt image. This is NOT the n8n source repository. There is no n8n source
code to build here, and you must not attempt to. If you have seen n8n's contributor
guidance (pnpm builds, monorepo packages, test suites, PR conventions), it does not apply
to this task. Ignore it.

You are deploying n8n to Railway. Follow this brief exactly. Read the non-negotiables first,
then work through the steps. Stop at every STOP marker and hand back to the human.

## Writing style for any text you produce
- British English always.
- Never use em-dashes. Use commas, colons, parentheses, or full stops.

## Non-negotiables (do not deviate)
1. Do NOT build n8n from source. This repo deploys the prebuilt official image via a thin
   wrapper Dockerfile. A from-source monorepo build on Railway Hobby is slow and unreliable.
2. The image is pinned to `n8nio/n8n:2.31.7`. Do not change the tag or use `latest`.
3. The `N8N_ENCRYPTION_KEY` is generated ONCE and then never changed or regenerated. If a
   value already exists in Railway, reuse it. Changing it makes all stored credentials
   unreadable.
4. Set `N8N_WEBHOOK_URL` and `N8N_EDITOR_BASE_URL` BEFORE any OAuth credential work, or OAuth
   callbacks break.
5. Use the account or workspace token (`RAILWAY_API_TOKEN`) for create operations such as
   adding a database or generating a domain. A project-only token can fail these with
   Unauthorized.
6. Never commit secrets to git. Secrets live only in Railway variables.
7. When a CLI command's syntax is uncertain, run it with `--help` first and use the current
   flags. Do not guess flags.

## Inputs the human must provide before you start
- A Railway account or workspace token exported as `RAILWAY_API_TOKEN`.
- Confirmation that Railway has access to this GitHub repo (only if using GitHub auto-deploy).

---

## Steps

### 1. Confirm the wrapper Dockerfile
The repo root contains a `Dockerfile` with only:
```dockerfile
FROM n8nio/n8n:2.31.7
```
That is the whole build. Do not add secrets here.

### 2. Authenticate the Railway CLI
The CLI skips interactive login when a token env var is set. Confirm `RAILWAY_API_TOKEN`
is present in the environment. Do not run `railway login` interactively.

**STOP 1.** If `RAILWAY_API_TOKEN` is not set, stop and ask the human to provide an account
or workspace scoped token. Do not proceed with create operations on a project-only token.

### 3. Create the project and add Postgres
- Create or link the project (`railway init` or `railway link`).
- Run `railway add --help`, then add a PostgreSQL database service with the correct flag.

### 4. Choose the deploy method
The CLI deploys local source with `railway up`, but wiring a GitHub repo to the service for
push-based auto-deploys usually requires a dashboard action or a GraphQL API call.

**STOP 2.** Ask the human which they want:
- (a) GitHub auto-deploy: pause so they connect the repo in the dashboard, or
- (b) CLI deploys: you will deploy with `railway up` from this directory instead.

### 5. Set environment variables
Generate the encryption key once: `openssl rand -hex 24`. Set it as a Railway variable.
Then set the rest (run `railway variables --help` to confirm syntax). The `${{...}}` values
are Railway reference variables; set them as the literal strings shown.
```bash
DB_TYPE=postgresdb
DB_POSTGRESDB_HOST=${{Postgres.PGHOST}}
DB_POSTGRESDB_PORT=${{Postgres.PGPORT}}
DB_POSTGRESDB_DATABASE=${{Postgres.PGDATABASE}}
DB_POSTGRESDB_USER=${{Postgres.PGUSER}}
DB_POSTGRESDB_PASSWORD=${{Postgres.PGPASSWORD}}
N8N_ENCRYPTION_KEY=<the key you generated, reuse if one already exists>
N8N_HOST=${{RAILWAY_PUBLIC_DOMAIN}}
N8N_PROTOCOL=https
N8N_WEBHOOK_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}/
N8N_EDITOR_BASE_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}/
N8N_PORT=5678
PORT=5678
N8N_LISTEN_ADDRESS=0.0.0.0
N8N_PROXY_HOPS=1
GENERIC_TIMEZONE=Europe/London
TZ=Europe/London
EXECUTIONS_DATA_PRUNE=true
EXECUTIONS_DATA_MAX_AGE=336
```

### 6. Volume
Default: skip the volume. Postgres plus the fixed encryption key already persists workflows
and credentials. Only add a volume at `/home/node/.n8n` if the human explicitly wants
persistent binary data, and be aware Railway mounts volumes as root while n8n runs as the
node user, which can cause permission errors.

### 7. Domain and deploy
- Generate a domain for the n8n service (`railway domain`).
- The `N8N_HOST` and `N8N_WEBHOOK_URL` references now resolve. Redeploy.
- Deploy via `railway up` (option b) or trigger the GitHub deploy (option a).

### 8. Verify boot
- Stream logs (`railway logs`) and confirm n8n started and connected to Postgres.
- Curl the domain and confirm it responds.
- If you see a 502, the cause is almost always a port mismatch. Confirm `PORT` and
  `N8N_PORT` agree, or set the domain target port to 5678. If it persists, try
  `N8N_LISTEN_ADDRESS=::`.

**STOP 3.** The n8n owner account and 2FA are set by the human in the browser. Hand back so
they create the owner login and enable 2FA. Do not disable user management.

**STOP 4.** Gmail and any Google OAuth credential require a browser consent flow you cannot
complete. Hand back to the human for those. You may script API-key style credentials
(OpenRouter, weather, the Discord webhook) via the n8n REST API if an n8n API key is
provided.

## Workflows maintained in this repo

### Daily Briefing (Discord)
The source for the Daily Briefing workflow lives in `briefing/`. Read `briefing/README.md`
before changing it. In short:
- Sources in the feed: `briefing/feeds.js`. Sections and layout: `briefing/compose.js`.
  Summariser model: `briefing/build.js`. Summarising and scoring prompt: `briefing/select.js`.
- Test with `node briefing/deploy.js test`, deploy with `node briefing/deploy.js prod`, then
  commit. Do not leave changes only in the n8n editor: the next deploy overwrites them.
- Credentials come from `secrets.local` (gitignored). Never copy a credential into `briefing/`.

## Done when
A pinned n8n image (2.31.7) is deployed to Railway, Postgres is connected over the private
network, the domain serves over https with correct webhook URLs, schedules are anchored to
the configured timezone, and the human has created the owner account.
