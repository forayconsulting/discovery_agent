# Discovery Agent

AI-powered stakeholder discovery tool for consulting engagements. Admins create engagements and invite stakeholders to complete guided discovery sessions. An AI agent (Claude) dynamically generates multi-choice question batches tailored to each stakeholder's role and responses, then produces structured summaries.

## Architecture

- **Runtime:** Cloudflare Workers (Hono framework)
- **Database:** PostgreSQL on Railway, accessed via Cloudflare Hyperdrive
- **Session Cache:** Cloudflare KV (fast) with PostgreSQL fallback (durable)
- **AI:** Anthropic Claude API for question generation and summarization
- **Frontend:** Static HTML/CSS/JS served via Cloudflare Workers Assets

## Live URL

https://discovery-agent.foray-consulting.workers.dev

## Project Structure

```
src/
  index.ts              # App entry, Env bindings, route mounting
  routes/
    api.ts              # Stakeholder session API (start, answer, submit)
    admin.ts            # Admin API (engagements, sessions, settings, Monday.com)
  services/
    claude.ts           # Claude API integration (batch generation, summaries)
    db.ts               # PostgreSQL queries via Hyperdrive
    monday.ts           # Monday.com API client
    session.ts          # KV session/config management
  schemas/
    quiz.ts             # TypeScript interfaces and Claude tool schemas
public/
  admin.html            # Admin dashboard
  session.html          # Stakeholder quiz interface
  js/admin.js           # Admin client logic
  js/session.js         # Session quiz client logic
  css/styles.css        # Shared styles
migrations/
  001_initial.sql       # Core tables: engagements, sessions, discovery_results
  002_conversation_state.sql  # Durable session state column
wrangler.toml           # Cloudflare Workers configuration
```

## Key Features

- **Admin Dashboard:** Create engagements, batch-create stakeholder sessions, manage Monday.com API key via settings UI
- **Monday.com Integration:** Import engagement context from Monday.com boards/items (API key configurable via admin panel or env var)
- **AI-Driven Discovery:** Claude generates 2-4 tailored multiple-choice questions per batch, adapting based on prior answers
- **"Other" Free-Text Option:** Every question includes an "Other" field for custom stakeholder input
- **Session Resumability:** Conversation state is durably persisted to PostgreSQL, so sessions survive browser closures and can be resumed days later
- **Batch Session Creation:** Admins can queue up multiple stakeholder sessions at once
- **Status Tracking:** Sessions show "Not Started", "In Progress", or "Completed"
- **Aggregate Summaries:** View individual AI-generated discovery summaries or aggregate results across all stakeholders

## Infrastructure

| Service | Purpose |
|---------|---------|
| Cloudflare Workers | Application runtime |
| Cloudflare KV (`SESSION_KV`) | Session state cache, admin tokens, config values |
| Cloudflare Hyperdrive | Connection pooling to PostgreSQL |
| Railway PostgreSQL | Persistent data store |

## Secrets (via `wrangler secret put`)

- `ANTHROPIC_API_KEY` - Claude API key
- `ADMIN_PASSWORD` - Admin login password

## Development

```bash
npm install
npm run dev          # Local dev server via wrangler
npm run typecheck    # TypeScript check
npm run deploy       # Deploy to Cloudflare Workers
```

## Database Migrations

Run against the Railway PostgreSQL instance:

```bash
psql "$DATABASE_PUBLIC_URL" -f migrations/001_initial.sql
psql "$DATABASE_PUBLIC_URL" -f migrations/002_conversation_state.sql
```
