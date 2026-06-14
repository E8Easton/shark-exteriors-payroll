# Deploy Shark Exteriors Payroll — Netlify + Supabase

**Netlify** hosts the website. **Supabase** stores all payroll data (jobs, tips, crew, 11 weeks).

---

## Step 1 — Create Supabase project (free)

1. Go to [supabase.com](https://supabase.com) → **New project**
2. Pick a name (e.g. `shark-payroll`) and set a database password — **save the password**

## Step 2 — Create database tables

1. In Supabase: **SQL Editor** → **New query**
2. Copy everything from `supabase/migrations/001_schema.sql` in this repo
3. Click **Run**

## Step 3 — Get connection string

1. Supabase → **Project Settings** → **Database**
2. Under **Connection string**, choose **URI**
3. Use the **Transaction pooler** string (port **6543**) — best for Netlify
4. Replace `[YOUR-PASSWORD]` with your database password

Example:
```
postgresql://postgres.xxxxx:YOUR_PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

## Step 4 — Connect GitHub on Netlify

1. Go to [app.netlify.com](https://app.netlify.com)
2. **Add new site** → **Import from GitHub**
3. Select `E8Easton/shark-exteriors-payroll`
4. Netlify reads `netlify.toml` automatically — click **Deploy**

## Step 5 — Add environment variable on Netlify

**Site configuration** → **Environment variables** → add:

| Name | Value |
|------|--------|
| `DATABASE_URL` | your Supabase pooler URI (step 3) |
| `NODE_ENV` | `production` |

Optional: `SESSION_SECRET` — any long random string (login cookie signing)

## Step 6 — Redeploy and test

1. **Deploys** → **Trigger deploy** → **Deploy site**
2. Open `https://YOUR-SITE.netlify.app/health` → should show `"ok": true, "driver": "postgres"`
3. Open `/` → login page
4. Login: **easton** / **zastrow**

---

## Local development (no Supabase needed)

```bash
npm install
npm run dev
```

Uses `./data/payroll.db` on your computer. To use Supabase locally, add `DATABASE_URL` to a `.env` file (not committed to git).

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| **Function crashed / EROFS** | Redeploy latest GitHub code (fixed — no file writes on Netlify) |
| **relation "employees" does not exist** | Run `001_schema.sql` in Supabase SQL Editor |
| **Page not found** | Check deploy logs; build must succeed |
| **Login fails / 500** | Check `DATABASE_URL` is correct pooler URI with password |
| **Health shows ok:false** | Read the `error` field — usually bad DATABASE_URL |

---

## After code updates

Push to GitHub → Netlify redeploys. Supabase data is **not** deleted.
