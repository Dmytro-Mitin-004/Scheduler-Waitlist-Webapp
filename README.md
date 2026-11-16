# Scheduler Waitlist

A web app that automatically fills calendar cancellations from a waitlist. When a business owner's appointment is cancelled, the system detects it, finds clients whose availability overlaps the freed slot, and emails them a one-click offer. First to confirm gets it.

**[Live Demo](https://scheduler-waitlist-webapp.vercel.app)**

> [!IMPORTANT]
> **The live demo cannot demonstrate the core auto-fill flow end-to-end.** The slot detection and email dispatch run on a cron job — Vercel's free tier limits this to once per day, and it also requires a live Google Calendar connection. What you *can* explore is the full UI: both dashboards, the waitlist management, and the confirm/decline page. The interesting parts (interval-overlap matching, CAS confirm, encrypted OAuth tokens) are in the backend logic under `src/lib/cron/` and `src/lib/confirm/`.

> [!WARNING]
> **The demo works without Google OAuth or Resend configured.** Without Google OAuth, connecting a new business to Google Calendar will fail — the demo account is pre-set to `disconnected` so this doesn't affect it. Without Resend, slot offer emails won't send — the confirm/decline page still works if navigated to directly. For a UI walkthrough these limitations are invisible.

---

## Try it out

Two accounts are pre-seeded — one for each side of the app:

**Business owner** — manages the waitlist and settings
```
URL:      /login
Email:    demo@schedulerwaitlist.com
Password: Demo1234!
```

**Client** — joins waitlists and receives slot offers
```
URL:      /client/login
Email:    democlient@schedulerwaitlist.com
Password: Demo1234!
```

The demo business has Google Calendar sync disabled, so nothing auto-fires. But all the UI is fully functional — you can add/remove waitlist entries, view pending offers, and walk through the confirm/decline flow.

---

## How it works

Every 5 minutes, a Vercel cron job hits `/api/cron/poll` and runs through each connected business:

1. **Sync** — fetches Google Calendar events and diffs them against the DB to find new cancellations
2. **Match** — finds active waitlist entries whose time windows overlap the freed slot using a compound range filter (`.lt('start_time', end_time).gt('end_time', start_time)`)
3. **Offer** — sends up to `batch_size` email offers, each with a single-use confirmation token
4. **Confirm** — when a client clicks their link, a compare-and-swap update claims the slot; any concurrent request gets a graceful "already filled" response
5. **Expire** — cleans up timed-out offers and stale entries

Google OAuth refresh tokens are AES-256-GCM encrypted at rest. Row Level Security is enabled on all five tables so owners can only access their own data.

---

## Stack

| | |
|---|---|
| Framework | Next.js 16 App Router, React 19, TypeScript strict mode |
| Styling | Tailwind CSS v4, shadcn/ui (Radix primitives), Inter |
| Database | Supabase (PostgreSQL + RLS), `@supabase/ssr` |
| Auth | Supabase Auth — email/password and Google OAuth |
| Email | Resend |
| Calendar | Google Calendar API (`googleapis`) |
| Infra | Vercel (cron + hosting), Supabase free tier |

---

## Project structure

```
src/
  app/
    (dashboard)/        # owner dashboard
    client/             # client portal
    api/cron/           # sync + dispatch pipeline
    api/health/         # keep-alive ping (runs every 72h)
  lib/
    cron/               # sync, dispatch, expiry logic
    confirm/            # token verification + CAS confirm
    crypto/             # AES-256-GCM encrypt/decrypt
    db/                 # Supabase client helpers
  components/
    ui/                 # shadcn/ui primitives
supabase/
  migrations/           # full schema with RLS policies
scripts/
  seed-demo.ts          # seeds both demo accounts
```

Schema: [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) — five tables: `businesses`, `clients`, `appointments`, `waitlist_entries`, `notifications`.

---

## Running locally

**Requirements:** Node.js 18+

```bash
git clone https://github.com/Trexicurity07/Scheduler-Waitlist-Webapp.git
cd Scheduler-Waitlist-Webapp
npm install
cp .env.example .env.local
```

### Credentials

You need a **Supabase project** (free tier works). Create one at [supabase.com](https://supabase.com), then fill these into `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=        # Project URL from Supabase dashboard
NEXT_PUBLIC_SUPABASE_ANON_KEY=   # Anon/public key
SUPABASE_SERVICE_ROLE_KEY=       # Service role key (Settings → API)
REFRESH_TOKEN_ENCRYPTION_KEY=    # Any 32-byte base64 string — generate with:
                                 # node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
NEXT_PUBLIC_APP_URL=http://localhost:3000
CRON_SECRET=                     # Any random string — used to authenticate cron calls
```

The remaining credentials are **optional** — the core UI works without them:

| Credential | Purpose | Get it from |
|---|---|---|
| `RESEND_API_KEY` + `RESEND_FROM_EMAIL` | Sending slot-offer emails | [resend.com](https://resend.com) (free tier) |
| `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` | Connecting a Google Calendar | [Google Cloud Console](https://console.cloud.google.com) → Credentials → OAuth 2.0 |

### Database and seed

Run the migration in the Supabase SQL editor:

```
supabase/migrations/0001_init.sql
```

Then seed the demo accounts:

```bash
npm run seed:demo
npm run dev
# App runs on http://localhost:3000
```

---

## Deploying to Vercel

1. Import the repo into Vercel
2. Add all variables from `.env.example` under Settings → Environment Variables
3. Deploy — cron jobs in `vercel.json` activate automatically on Hobby tier
4. Run `npm run seed:demo` locally (with `.env.local` pointing at your live Supabase) to create the demo accounts

The `/api/health` endpoint pings the database every 72 hours to stop Supabase free-tier projects from pausing after inactivity.
