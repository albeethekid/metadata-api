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

The server runs on `http://localhost:8080` (or `PORT` env var).

## Railway Deployment

Railway uses the `Dockerfile` at the repo root for deployment.

### Why Docker?

Playwright requires OS-level libraries (libglib, libnss, etc.) that aren't available in Railway's default Node.js buildpack. The official Playwright Docker image (`mcr.microsoft.com/playwright:v1.58.1-jammy`) includes:

- Chromium browser executable
- All required system dependencies (glib, nss, atk, cups, etc.)
- Node.js runtime

### How It Works

1. Railway detects the `Dockerfile` and builds the container.
2. The Playwright base image provides browsers + OS dependencies.
3. `npm ci --omit=dev` installs production Node dependencies.
4. The app binds to `0.0.0.0:$PORT` (Railway injects `PORT`).

### Verifying Deployment

After deploy, test the endpoints:

- **Health check**: `GET /` — returns API info
- **Instagram scrape**: `GET /api/instagram/video?url=<encoded_url>`

### Troubleshooting

If you see `libglib-2.0.so.0: cannot open shared object file`:
- Ensure Railway is using the Dockerfile (not Nixpacks).
- Verify the Playwright version in `package.json` matches the Docker image tag.

If browser executable not found:
- The Playwright base image includes browsers at `/ms-playwright`.
- Ensure `npm ci` runs without `--ignore-scripts` so Playwright can locate browsers.
