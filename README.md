# 6-a-side Fantasy League

A custom Fantasy-Premier-League-style game for a 6-a-side league, built with Next.js (App Router), TypeScript, Tailwind CSS, and Supabase (Postgres + Auth + Realtime).

- Squads of 8 (6 starters, 2 subs), £50m budget, captain/vice-captain, auto-subs.
- Transfers with free-transfer banking, -4 point hits, Wildcard / Bench Boost / Triple Captain chips.
- Admin panel for players, gameweeks, deadlines, stats entry, and fully editable scoring rules.
- Two leaderboards (top players, top fantasy teams) switchable by gameweek or overall, with rank-movement arrows.
- Live updates via Supabase Realtime, shareable team images, CSV/JSON exports.

All squad rules, budget, and deadlines are enforced **server-side** in Postgres (see `supabase/schema.sql`), not just in the UI — a user calling the API directly can't bypass them.

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a free account/project (pick any name/region).
2. Wait for the project to finish provisioning, then open **Project Settings → API**. You'll need:
   - **Project URL**
   - **anon public** key
   - **service_role** key (keep this secret — only used server-side)

## 2. Run the database schema

1. In the Supabase dashboard, open **SQL Editor → New query**.
2. Paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql) and run it.
   This creates every table, Row Level Security policy, and the server-side functions that validate squads, transfers, and chips (`submit_team_picks`, `admin_advance_gameweek`, `validate_invite`, etc.), and adds the live-score tables to the Realtime publication.
3. Open a new query, paste [`supabase/seed.sql`](supabase/seed.sql), and run it. This loads the 19-player pool.

## 3. Configure authentication

**Email magic link** is enabled by default — nothing to do.

**Google sign-in** (optional):
1. In Supabase: **Authentication → Sign In / Providers → Google** → toggle it on.
2. Follow Supabase's linked instructions to create a Google OAuth Client ID/Secret in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials), then paste them into the Supabase provider settings.

**Redirect URLs** — in **Authentication → URL Configuration**:
- Set **Site URL** to your production URL (you'll get this after deploying to Vercel in step 7; `http://localhost:3000` works for local dev in the meantime).
- Add these to **Redirect URLs**:
  - `http://localhost:3000/auth/callback`
  - `https://YOUR-VERCEL-DOMAIN.vercel.app/auth/callback` (add once you have it)

## 4. Run it locally

```bash
npm install
cp .env.local.example .env.local
```

Edit `.env.local` and fill in the three values from step 1 (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`), then:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## 5. Get your invite link and become admin

The **first person to ever sign in becomes the league admin automatically.**

1. In Supabase: **Table Editor → league_settings**, copy the `invite_token` value.
2. Your invite link is: `http://localhost:3000/join?invite=<token>` (or your production URL once deployed).
3. Open that link yourself first and sign in — you'll become the admin.
4. Share the same link with the rest of the league. Everyone who signs up through it joins; the admin panel (**Admin → Overview**) also shows a copy/regenerate button for this link.

## 6. Set up the league as admin

Before Gameweek 1 can open:

1. **Admin → Players**: check the 19 seeded players and prices (edit or add/remove any as needed).
2. **Admin → Gameweeks**: create Gameweek 1 with its deadline. Create future gameweeks the same way as the season progresses.
3. **Admin → Settings**: adjust the budget or any scoring rule if you want something other than the defaults.
4. After each gameweek is played, **Admin → Stats**: enter each player's stats (played, goals, assists, clean sheet, saves, etc.) for that gameweek, then mark it **Scored** in **Admin → Gameweeks**. Points recalculate automatically everywhere the moment you save.
5. Once a gameweek's deadline has passed and stats are in, hit **Advance →** on that gameweek (in **Admin → Gameweeks**) to roll everyone's free transfers forward and open the next one.

## 7. Deploy to Vercel

1. Push this project to a GitHub repo.
2. Go to [vercel.com/new](https://vercel.com/new) and import the repo.
3. Under **Environment Variables**, add the same four values from `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_SITE_URL` → set this to `https://YOUR-PROJECT.vercel.app` (Vercel shows you the domain before the first deploy finishes; you can edit the env var and redeploy after if needed)
4. Click **Deploy**.
5. Back in Supabase **Authentication → URL Configuration**, add `https://YOUR-PROJECT.vercel.app/auth/callback` to **Redirect URLs** (and set **Site URL** to the production domain) if you haven't already.

Your shareable league link is now:

```
https://YOUR-PROJECT.vercel.app/join?invite=<invite_token>
```

(the same token from step 5 — grab it again from `league_settings` in Supabase, or from **Admin → Overview** once you're signed in as admin).

That's it — everyone on the link shares one live database, so picks, scores, and leaderboards update for the whole league in real time.

## Project structure

```
supabase/schema.sql   — tables, RLS policies, validation RPCs, Realtime publication
supabase/seed.sql     — the 19-player pool
src/lib/scoring.ts    — pure scoring engine (points, auto-subs, captaincy, chips)
src/lib/leaderboards.ts — leaderboard + rank-history aggregation
src/app/actions/      — server actions (team picks, admin mutations)
src/app/(app)/        — authenticated app (dashboard, pick-team, transfers, leaderboards, players, teams, admin)
```

## Tech stack

Next.js 16 (App Router, TypeScript) · Tailwind CSS · Supabase (Postgres, Auth, Realtime) · `html-to-image` for the share card.
