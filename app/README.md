# Academic Submission Dashboard

> New to this project, or setting it up for the first time? **[GETTING_STARTED.md](GETTING_STARTED.md)**
> is a plain-language, step-by-step version of everything below, including free hosting.

Implementation of the design in [../architecture.md](../architecture.md),
[../sequence-flows.md](../sequence-flows.md), [../design-options.md](../design-options.md), and
[../schema.md](../schema.md). Built, installed, and smoke-tested end to end (see "What's been
verified" below) — the one thing not testable here is a real Google Drive connection, since
that needs your own Google account.

## Decisions this build reflects

- **Before/On-time/After boundary**: [design-options.md §2](../design-options.md#2-️-deadline-label-semantics--before--on-time--after)
  Option A — a configurable `on_time_window_hours` per task (default 24h). Before = earlier than
  `deadline − window`; On time = within the window up to the deadline; After = past the
  deadline. Missing finalizes once `deadline + grace_period_hours` has passed with no
  submission.
- **Screenshot evidence**: [design-options.md §5](../design-options.md#5-️-screenshot-evidence-handling)
  Option B — stays in the Prof's own local folders. The dashboard only stores a free-text note
  (e.g. "saved at D:\Evidence\...") against a task, not an uploaded file — see the "Evidence
  notes" panel.
- **Google auth: OAuth sign-in, not a service account.** The Prof clicks "Connect Google Drive"
  and signs in with their own account — no JSON key file, no sharing folders with a robot
  email. See [credentials/README.md](credentials/README.md).

## Stack

- Node.js + Express
- **`@libsql/client`** for the database — SQLite-compatible. Locally it just opens a file
  (`file:./data/dashboard.db`), zero external account needed. Point it at a free
  [Turso](https://turso.tech) database instead and the exact same code runs against a
  network-hosted DB — this is what makes free serverless-ish hosting actually work (see
  "Deploying for free" below).
- Vanilla HTML/CSS/JS frontend — no build step, no framework, nothing to compile before
  deploying.

## Setup (local)

1. `npm install`
2. `.env` already exists in this scaffold (copied from `.env.example`) with local-file DB mode
   and no Google credentials filled in yet.
3. Follow [credentials/README.md](credentials/README.md) to create a Google OAuth client, then
   fill `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` into `.env`.
4. `npm start` → open `http://localhost:3000`.
5. Click **Connect Google Drive**, sign in.
6. Create a batch (auto-creates its 4 semesters) → pick a semester → **+ New task** (subject
   name, task name, Drive submission link, deadline via the date/time picker) → the task's Drive
   folder should already contain `group_a/`, `group_b/`, ... subfolders for **Sync now** to find
   anything.

## What's been verified (this session, without real Drive credentials)

- Server boots, static frontend serves (`index.html`, `app.js`, `styles.css`)
- `POST /api/batches` creates a batch **and** its 4 semesters in one call
- `POST /api/tasks` creates a subject inline and extracts the Drive folder ID from a pasted
  `.../folders/<id>` link correctly
- `GET /api/tasks/:id/submissions` returns a clean empty state before any sync has run
- `POST /api/tasks/:id/evidence` stores a note; it comes back correctly on the next submissions
  fetch
- `POST /api/sync` fails with a clear, specific error (`No Google account connected yet...`)
  rather than crashing, when no OAuth token is stored yet
- `GET /auth/google` fails with a clear config error rather than crashing, when OAuth
  credentials aren't set
- `GET /api/reports/audit.csv` returns a well-formed (empty) CSV

**Not tested**: an actual Drive scan (`syncTask` in `src/sync.js`) — that needs a real signed-in
Google account and a Drive folder with `group_a/`/`group_b/` subfolders to point at.

## Deploying for free

Being direct about the actual constraints, since "free and easy" has real tradeoffs to pick
between:

1. **Database: [Turso](https://turso.tech) free tier.** Create a database there, copy its URL
   and an auth token into `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` on your host. This is *why*
   the app uses `@libsql/client` instead of a plain SQLite file — most genuinely-free hosts
   (Vercel, Netlify, and even Render's free tier under some conditions) don't guarantee a
   persistent local disk, so a plain SQLite file risks getting wiped on redeploy/restart. Turso
   solves that without changing a line of application code.

2. **App hosting: [Render.com](https://render.com) free Web Service** (or Fly.io/Railway as
   alternatives — the Railway free *trial* is time-limited, not a perpetual free tier, as of
   this writing). Connect your GitHub repo, set the environment variables from `.env.example`
   (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI`),
   deploy. Update the OAuth redirect URI in both the Google Cloud Console **and**
   `GOOGLE_OAUTH_REDIRECT_URI` to your Render URL (`https://your-app.onrender.com/auth/google/callback`).

3. **The free-tier catch**: Render's free Web Services **sleep after 15 minutes of no incoming
   HTTP traffic** and take ~30-50s to wake on the next request. That means the in-process
   `node-cron` schedule in `src/server.js` is unreliable on its own — if the process is asleep,
   the cron simply isn't running. Two free fixes, use both:
   - The **"Sync now" button** always works regardless of sleep — clicking it wakes the host via
     the HTTP request itself.
   - **[cron-job.org](https://cron-job.org)** (free) — point it at
     `POST https://your-app.onrender.com/api/sync` every 15 minutes. This both drives the sync
     *and* keeps the host from sleeping, solving both problems with one free external service.

4. **Google OAuth consent screen**: keep it in "Testing" status (see
   [credentials/README.md](credentials/README.md)) — no Google verification review needed for a
   small number of named test users, which is all this needs.

Net result: Turso (free) + Render (free) + cron-job.org (free) + a Google Cloud project (free,
OAuth client only, no billing-enabled API usage) — genuinely $0, deployable from a GitHub push,
with the one caveat above about cold starts, worked around by the external pinger.

## Known limitations

- No login/roles for the dashboard itself (anyone who can reach the URL sees everything) — the
  Google OAuth step only gates *Drive access*, not *dashboard access*. Fine behind a private
  URL for a small number of Profs; not a substitute for real access control if this needs to be
  more widely reachable.
- Evidence is a text note, not a file — by design, per the confirmed decision above.
- One Google account connected at a time (`oauth_tokens` always uses the most recently
  connected one) — fine for a single Prof; would need per-task or per-Prof account association
  to support multiple Profs with separate Drives.
- `student_groups` are scoped to the subject and auto-registered from Drive subfolder names —
  a typo'd subfolder name (`group_a` vs `Group_A`) creates a second group. Worth normalizing
  (e.g. lowercase + trim) if this becomes a real pain point.
