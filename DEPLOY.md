# Deploy Shark Exteriors Payroll (Fly.io)

This app stores **all payroll data** (jobs, tips, overrides, crew) in SQLite on a Fly **volume** at `/data`. Data persists across redeploys for the full 11-week season.

## One-time setup

1. Install the [Fly CLI](https://fly.io/docs/hands-on/install-flyctl/) and sign in:

   ```bash
   fly auth login
   ```

2. From this repo folder, launch the app (use the existing `fly.toml`):

   ```bash
   fly launch --no-deploy
   ```

   - Choose app name `shark-exteriors-payroll` or your own (update `app` in `fly.toml` if you change it).
   - Confirm region (default `iad` — US East).

3. Create the persistent volume (only once per app):

   ```bash
   fly volumes create payroll_data --region iad --size 1
   ```

4. Set a strong session secret (required in production):

   ```bash
   fly secrets set SESSION_SECRET="paste-a-long-random-string-here"
   ```

   Generate one with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

5. Deploy:

   ```bash
   fly deploy
   ```

6. Open the site:

   ```bash
   fly open
   ```

Your live URL will look like: `https://shark-exteriors-payroll.fly.dev`

## Default logins

On first deploy, default crew accounts are seeded from names (username = first name, password = last name, lowercase). Example owner: **easton** / **zastrow**.

Change passwords from **Manage Crew** after going live.

## Redeploy after GitHub updates

```bash
git pull
fly deploy
```

Data on the `/data` volume is **not** wiped by redeploys.

## Backup (recommended weekly)

```bash
fly ssh console -C "sqlite3 /data/payroll.db '.backup /data/backup.db'"
fly ssh sftp get /data/backup.db ./payroll-backup.db
```

## Environment variables

| Variable | Purpose |
|----------|---------|
| `SESSION_SECRET` | **Required** in production — signs login cookies |
| `DB_PATH` | SQLite file (default `/data/payroll.db` on Fly) |
| `SESSIONS_PATH` | Login sessions folder (default `/data/sessions`) |
| `PORT` | Set automatically by Fly |

## Local development

```bash
npm install
npm run dev
```

Uses `./payroll.db` and `./sessions/` locally (not committed to git).
