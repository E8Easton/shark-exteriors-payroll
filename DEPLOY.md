# Deploy on Fly.io (GitHub link)

## Fix for "Page not found"

That usually means the app **never started**. Do these two things in the [Fly.io dashboard](https://fly.io/dashboard) **before** you hit Deploy:

### 1. Create the storage volume (keeps all 11 weeks of payroll data)

1. Open your app on Fly.io
2. Go to **Storage** → **Volumes**
3. **Create volume**
   - Name: `payroll_data` (must match `fly.toml`)
   - Region: `iad` (same as `primary_region` in `fly.toml`)
   - Size: 1 GB
4. Attach the volume to your machine (Fly usually does this on next deploy)

### 2. Match the app name

In `fly.toml`, the line `app = 'shark-exteriors-payroll'` must match **your Fly app name** exactly. If Fly gave you a different name when you linked GitHub, change that line to match, commit, and push.

### 3. Deploy from GitHub

1. Fly.io dashboard → your app → **Deploy** (or enable auto-deploy on push to `master`)
2. Wait until the deploy finishes (green / running)
3. Open your app URL — you should see the **login page**, not "page not found"
4. Test: visit `https://YOUR-APP.fly.dev/health` — should show `{"ok":true,...}`

## Logins

- Owner: **easton** / **zastrow**
- Crew: first name / last name (lowercase), e.g. **malcolm** / **gall**

Change passwords from **Manage Crew** after going live.

## Redeploy after code updates

Push to GitHub → Fly redeploys (if auto-deploy is on) or click **Deploy** in the dashboard. Data on the `payroll_data` volume is kept.

## Optional: set your own session secret

Fly auto-creates one on first boot and saves it on the volume. To set your own:

```bash
fly secrets set SESSION_SECRET="your-long-random-string"
```

## Local dev

```bash
npm install
npm run dev
```

Uses `./data/` locally (not committed to git).
