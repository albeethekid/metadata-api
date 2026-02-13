# TikTok yt-dlp Endpoint Setup

## Overview

The new `/api/tiktok/ytdlp` endpoint uses [yt-dlp](https://github.com/yt-dlp/yt-dlp) to extract TikTok video metadata. This is an alternative to the existing `/api/tiktok/video/metrics` endpoint which uses HTTP scraping.

## Requirements

**Python 3.10 or higher** is required to run yt-dlp.

### Check Your Python Version

```bash
python3 --version
```

### Installing Python 3.10+

#### macOS (using Homebrew)
```bash
brew install python@3.11
```

#### Ubuntu/Debian
```bash
sudo apt update
sudo apt install python3.11
```

#### Windows
Download from [python.org](https://www.python.org/downloads/)

## Setup

The yt-dlp binary will be automatically downloaded to `bin/yt-dlp` on first use. The `bin/` directory is already created and gitignored.

## API Endpoint

### GET /api/tiktok/ytdlp

Fetches TikTok video metadata using yt-dlp.

#### Parameters
- `url` (required): URL-encoded TikTok video URL
- `verbose` (optional): Set to `1` to include raw yt-dlp metadata

#### Example Request
```bash
curl "http://localhost:8080/api/tiktok/ytdlp?url=https%3A%2F%2Fwww.tiktok.com%2F%40username%2Fvideo%2F1234567890"
```

#### Response Format
```json
{
  "platform": "tiktok",
  "inputUrl": "https://www.tiktok.com/@username/video/1234567890",
  "videoId": "1234567890",
  "publishedAt": "2024-01-15T12:00:00.000Z",
  "description": "Video caption/description",
  "heroImageUrl": "https://...",
  "metrics": {
    "views": 12345,
    "likes": 678,
    "comments": 90,
    "shares": 12
  }
}
```

#### Error Codes
- `400` - `MISSING_URL`: No URL parameter provided
- `400` - `INVALID_URL`: Invalid or non-TikTok URL
- `400` - `CANNOT_EXTRACT_VIDEO_ID`: Could not extract video ID from URL
- `502` - `YTDLP_FETCH_FAILED`: yt-dlp failed to fetch video data
- `503` - `PYTHON_VERSION_UNSUPPORTED`: Python version is below 3.10

## Comparison: yt-dlp vs HTTP Scraping

### `/api/tiktok/ytdlp` (yt-dlp)
**Pros:**
- More reliable - uses TikTok's internal APIs
- Better metadata extraction
- Handles various TikTok URL formats
- Active maintenance by yt-dlp community

**Cons:**
- Requires Python 3.10+
- Slightly slower (spawns Python process)
- Larger dependency footprint

### `/api/tiktok/video/metrics` (HTTP Scraping)
**Pros:**
- No Python dependency
- Faster (pure Node.js)
- Lighter weight

**Cons:**
- More fragile (relies on HTML structure)
- May break if TikTok changes their page structure
- Limited to publicly visible data

## Testing

Test the endpoint with the included test script:

```bash
node test-tiktok-ytdlp.js
```

Note: Ensure Python 3.10+ is installed before testing.
