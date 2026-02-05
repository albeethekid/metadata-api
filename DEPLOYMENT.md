# Deployment Guide

## Local Development

Run the app locally using Node.js (no Docker required):

```bash
npm install
npm run dev
```

If you need Playwright for Instagram scraping locally, install the browser:

```bash
npx playwright install chromium
```

The server runs on `http://localhost:3000`.

## Railway Deployment

Railway uses the `Dockerfile` at the repo root for deployment.

### Why Docker?

Playwright requires OS-level libraries (libglib, libnss, etc.) that aren't available in Railway's default Node.js buildpack. The official Playwright Docker image (`mcr.microsoft.com/playwright:v1.58.1-jammy`) includes:

- Chromium browser
- All required system dependencies (glib, nss, atk, cups, etc.)
- Node.js runtime

### How It Works

1. Railway detects the `Dockerfile` and builds the container.
2. The Playwright base image provides all OS dependencies.
3. `npm ci --ignore-scripts` installs Node dependencies without redundant browser downloads.
4. The app binds to `0.0.0.0:$PORT` (Railway injects `PORT`).

### Verifying Deployment

After deploy, test the endpoints:

- **Health check**: `GET /` — returns API info
- **Instagram scrape**: `GET /api/instagram/video?url=<encoded_url>`

### Troubleshooting

If you see `libglib-2.0.so.0: cannot open shared object file`:
- Ensure Railway is using the Dockerfile (not Nixpacks).
- Verify the Playwright version in `package.json` matches the Docker image tag.

If browser launch fails:
- Check Railway logs for detailed error messages.
- Ensure `NODE_ENV=production` is set (done in Dockerfile).
