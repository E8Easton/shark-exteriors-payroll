# Deploy on Netlify (netlify.com)

Connect your GitHub repo and deploy. All payroll data is stored in a **Turso** cloud database (SQLite) so it persists for the full season.

## Step 1 — Create a Turso database (free, one time)

Turso stores your payroll data in the cloud. Netlify cannot save SQLite files on its own servers.

1. Go to [turso.tech](https://turso.tech) and sign up (free).
2. Install the Turso CLI or use the web dashboard to create a database named `shark-payroll`.
3. Copy these two values:
   - **Database URL** → looks like `libsql://shark-payroll-yourname.turso.io`
   - **Auth token** → from `turso db tokens create shark-payroll`

Or use the **[Turso integration on Netlify](https://www.netlify.com/integrations/turso/)** — it can add the env vars for you automatically.

## Step 2 — Connect GitHub on Netlify

1. Go to [app.netlify.com](https://app.netlify.com)
2. **Add new site** → **Import an existing project**
3. Choose **GitHub** → select `E8Easton/shark-exteriors-payroll`
4. Netlify reads `netlify.toml` automatically — do **not** change the publish folder unless Netlify asks (should be `public`)

## Step 3 — Add environment variables

In Netlify: **Site configuration** → **Environment variables** → add:

| Name | Value |
|------|--------|
| `TURSO_DATABASE_URL` | your `libsql://...` URL |
| `TURSO_AUTH_TOKEN` | your Turso token |
| `NODE_ENV` | `production` |

## Step 4 — Deploy

Click **Deploy site**. When it finishes, open your Netlify URL (e.g. `https://something.netlify.app`).

- `/health` should show `{"ok":true,"platform":"netlify","driver":"libsql"}`
- `/` should redirect to the **login page**

**Owner login:** `easton` / `zastrow`

## Step 5 — Redeploy after GitHub updates

Push to GitHub → Netlify auto-redeploys (if enabled) or click **Trigger deploy** in the Netlify dashboard. Your Turso data is **not** wiped.

## Local development

```bash
npm install
npm run dev
```

Uses `./data/payroll.db` locally (no Turso needed). To test with Turso locally, set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in a `.env` file.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| **Page not found** | Check deploy logs. Usually missing `TURSO_DATABASE_URL` or failed build. |
| **500 on login** | Turso env vars wrong or database not created. |
| **Build failed** | Ensure Node 22 in Netlify: Site settings → Build → `NODE_VERSION` = `22` |
