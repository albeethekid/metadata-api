# Docker Deployment Guide

## Overview

The Dockerfile supports both Playwright (for Instagram scraping) and yt-dlp (for TikTok scraping) in production.

## What's Included

### Base Image
- **microsoft/playwright:v1.58.1-jammy** - Ubuntu 22.04 with Playwright pre-installed

### Additional Software
- **Python 3.11** - Required for yt-dlp
- **Chromium browser** - For Instagram scraping via Playwright
- **Node.js dependencies** - All npm packages

## Supported Endpoints

All endpoints work in Docker:

1. **YouTube** - `/api/video/:videoId` (requires YOUTUBE_API_KEY)
2. **TikTok (HTTP scraping)** - `/api/tiktok/video/metrics` (no Python required)
3. **TikTok (yt-dlp)** - `/api/tiktok/ytdlp` (uses Python 3.11)
4. **Instagram** - `/api/instagram/video` (uses Playwright + Chromium)

## Building the Docker Image

```bash
docker build -t youtube-api-project .
```

## Running the Container

```bash
docker run -p 8080:8080 \
  -e YOUTUBE_API_KEY=your_api_key_here \
  youtube-api-project
```

## Environment Variables

Required:
- `YOUTUBE_API_KEY` - Your YouTube Data API v3 key

Optional:
- `NODE_ENV` - Set to `production` (default in Dockerfile)
- `PORT` - Server port (default: 8080)

## Python 3.10+ Installation

The Dockerfile uses Ubuntu Jammy's built-in Python 3.10:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-distutils \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*
```

This is faster and more reliable than installing from external PPAs.

## yt-dlp Binary

The yt-dlp binary is **not** included in the Docker image. It will be:
1. Auto-downloaded to `bin/yt-dlp` on first API request to `/api/tiktok/ytdlp`
2. Shebang automatically fixed to use the detected Python 3.10+ path
3. Cached for subsequent requests

## Python Path Detection

The code automatically detects the Python path (3.10+):
- **macOS (Homebrew)**: `/opt/homebrew/bin/python3.11`
- **Docker/Linux (3.11)**: `/usr/bin/python3.11`
- **Docker/Linux (3.10)**: `/usr/bin/python3.10`
- **Fallback**: `python3` in PATH

## Volume Mounts (Optional)

To persist the yt-dlp binary across container restarts:

```bash
docker run -p 8080:8080 \
  -e YOUTUBE_API_KEY=your_api_key_here \
  -v $(pwd)/bin:/app/bin \
  youtube-api-project
```

## Testing in Docker

Build and run locally:

```bash
# Build
docker build -t youtube-api-project .

# Run
docker run -p 8080:8080 \
  -e YOUTUBE_API_KEY=your_api_key_here \
  youtube-api-project

# Test endpoints
curl "http://localhost:8080/"
curl "http://localhost:8080/api/tiktok/ytdlp?url=https%3A%2F%2Fwww.tiktok.com%2F%40username%2Fvideo%2F123"
```

## Production Deployment

### Vercel / Serverless
Note: yt-dlp endpoint may not work on serverless platforms due to:
- Binary download restrictions
- Python runtime requirements
- Process spawning limitations

For serverless deployments, use the HTTP scraping endpoint instead:
- `/api/tiktok/video/metrics` (works on Vercel/serverless)

### Docker-based Platforms (Recommended)
Works on:
- AWS ECS/Fargate
- Google Cloud Run
- Azure Container Instances
- DigitalOcean App Platform (Docker)
- Fly.io
- Railway

## Image Size

Approximate sizes:
- Base Playwright image: ~1.5GB
- With Python 3.11: ~1.6GB
- With all dependencies: ~1.7GB

## Security Notes

1. The yt-dlp binary is downloaded from GitHub on first use
2. Python 3.11 is installed from Ubuntu's deadsnakes PPA
3. All apt packages are cleaned up to reduce image size
4. No sensitive data is baked into the image

## Troubleshooting

### yt-dlp fails with Python error
Check Python version in container:
```bash
docker exec -it <container_id> python3.11 --version
```

### Binary download fails
Check network connectivity and GitHub access from container.

### Playwright fails
Ensure Chromium is installed:
```bash
docker exec -it <container_id> npx playwright install chromium
```
