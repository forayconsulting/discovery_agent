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
  003_steering_and_overview.sql  # Per-session steering + engagement overview
wrangler.toml           # Cloudflare Workers configuration
```

## Key Features

- **Admin Dashboard:** Create engagements, batch-create stakeholder sessions, manage Monday.com API key via settings UI
- **Monday.com Integration:** Import engagement context from Monday.com boards/items (API key configurable via admin panel or env var)
- **AI-Driven Discovery:** Claude generates 2-4 tailored multiple-choice questions per batch, adapting based on prior answers. Questions are open-ended and non-leading, following a first-principles approach that lets the stakeholder's genuine perspective emerge
- **Session Steering:** Admins can request AI-suggested focus areas per stakeholder (based on role and engagement context), select from them, and inject custom steering that guides — but doesn't force — the discovery questions
- **"Other" Free-Text Option:** Every question includes an "Other" field for custom stakeholder input
- **Fast Submit (Fire-and-Forget):** Answers are saved and the session is marked complete synchronously, returning instantly. AI summary generation runs in the background via `waitUntil`, so users never experience browser timeouts. Pending summaries show spinners with auto-polling in the admin UI
- **Engagement Overview:** When 2+ session summaries are completed, an engagement-level overview is auto-generated synthesizing themes, consensus, and divergences across all stakeholders. Can also be manually refreshed
- **Collapsible Summaries:** In the aggregate tab, individual summaries auto-collapse when there are many, with the engagement overview displayed prominently at the top
- **Session Resumability:** Conversation state is durably persisted to PostgreSQL, so sessions survive browser closures and can be resumed days later
- **Batch Session Creation:** Admins can queue up multiple stakeholder sessions at once
- **Status Tracking:** Sessions show "Not Started", "In Progress", or "Completed"
- **Summary Retry:** If background summary generation fails, admins can manually retry from the admin panel

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
psql "$DATABASE_PUBLIC_URL" -f migrations/003_steering_and_overview.sql
```
