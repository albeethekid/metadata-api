# Social Video Metadata CSV Tool

A lightweight utility for extracting structured metadata from YouTube and TikTok videos and exporting it as a unified CSV.
Designed for analysis, ops workflows, and downstream ingestion (Sheets, Excel, BI tools).

The app consists of:

- A serverless API that normalizes video metadata from multiple platforms
- A minimal static UI that batch-processes YouTube/TikTok URLs and downloads a CSV
- No frontend framework required.

## Live API Base

https://youtube-api-project-azure.vercel.app

## API Routes

### GET /api/video/{VIDEO_ID}

Fetches normalized metadata for a single YouTube video.

This endpoint is the single source of truth for:

- duration parsing
- engagement metrics
- hero image selection
- channel handle resolution

#### Example

GET /api/video/dQw4w9WgXcQ

#### Default (compact) response

```json
{
  "videoId": "dQw4w9WgXcQ",
  "publishedAt": "2009-10-25T06:57:33Z",
  "durationIso": "PT3M34S",
  "durationSeconds": 214,
  "viewCount": 1736217114,
  "likeCount": 18755791,
  "commentCount": 2414583,
  "engagement": {
    "likeRate": 0.0108,
    "commentRate": 0.0014
  },
  "heroImageUrl": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
  "channelHandle": "@rickastleyyt"
}
```

#### Verbose response (full raw payload)

To return the full YouTube API payload (video + channel data), pass:

GET /api/video/dQw4w9WgXcQ?verbose=1

This returns the original unfiltered response exactly as received and assembled by the backend.

### GET /api/tiktok/video/metrics?url=<URL_ENCODED_TIKTOK_URL>[&verbose=1]

Fetches normalized metadata for a single TikTok video by scraping the public page and extracting embedded JSON.

#### Example

GET /api/tiktok/video/metrics?url=https%3A%2F%2Fwww.tiktok.com%2F%40yaroslavslonsky%2Fvideo%2F7568246874558237965

#### Default response (camelCase)

```json
{
  "platform": "tiktok",
  "inputUrl": "https://www.tiktok.com/@yaroslavslonsky/video/7568246874558237965",
  "videoId": "7568246874558237965",
  "publishedAt": "2025-11-02T21:43:40.000Z",
  "description": "#sora Potty Training Made Easy...",
  "heroImageUrl": "https://p16-sign-va.tiktokcdn.com/...",
  "metrics": {
    "views": 18700,
    "likes": 233,
    "comments": 34,
    "shares": 24
  }
}
```

#### Verbose response (verbose=1)

Includes `heroImageUrls` and `raw` TikTok item object.

#### Error behavior

- Missing `url`: 400 { "error": "MISSING_URL" }
- URL not TikTok: 400 { "error": "INVALID_URL" }
- Cannot extract video ID: 400 { "error": "CANNOT_EXTRACT_VIDEO_ID" }
- HTML fetch fails: 502 { "error": "PAGE_FETCH_FAILED" }
- No embedded JSON: 502 { "error": "NO_REHYDRATION_DATA" }
- Video not found in JSON: 404 { "error": "VIDEO_NOT_FOUND" }
- Unexpected error: 500 { "error": "INTERNAL_ERROR" }

## UI: Social Video → CSV Tool

### URL

/youtube-csv.html

### Description

A simple browser-based tool that allows users to:

- Paste a list of YouTube or TikTok URLs (one per line)
- Detect platform and extract video IDs/handles from valid links
- Call the appropriate API endpoint for each video
- Download a CSV containing unified, normalized metadata

No authentication. No data persistence.

### Supported URL formats

**YouTube**
- https://www.youtube.com/watch?v=VIDEO_ID
- https://www.youtube.com/shorts/VIDEO_ID
- https://youtu.be/VIDEO_ID

**TikTok**
- https://www.tiktok.com/@HANDLE/video/VIDEO_ID

Invalid or unsupported URLs are silently skipped and do not appear in the CSV.

### CSV Columns (exact)

- platform
- originalUrl
- videoId
- title
- publishedAt
- durationIso
- durationSeconds
- viewCount
- likeCount
- commentCount
- engagement_likeRate
- engagement_commentRate
- heroImageUrl
- channelHandle

Only successfully fetched videos produce rows.

### CSV behavior

- Generated client-side
- Proper CSV escaping
- Safe against spreadsheet formula injection
- Filename format: `social-video-metadata-YYYY-MM-DD-HHMM.csv`

### Platform-specific mapping

**YouTube**
- title: video title
- duration: from YouTube API
- engagement: derived from like/comment counts

**TikTok**
- title: video description/caption
- duration: empty (not available)
- engagement: derived from like/comment counts
- channelHandle: parsed from URL (@handle)

## Platform Implementation Details

### TikTok

- No official API used; fetches public page HTML with a desktop Chrome User-Agent.
- Extracts embedded JSON from `<script id="SIGI_STATE">` or `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">`.
- Resolves the video object by matching the numeric video ID.
- No headless browsers; pure HTTP fetch + JSON parsing.
- Rate-limit aware; client-side concurrency limited to 5.

### YouTube

- Uses official YouTube Data API v3.
- Two API calls per video: videos.list + channels.list.
- See Google API Usage section for quota details.

## Google API Usage

### API Used

YouTube Data API v3

Official documentation: https://developers.google.com/youtube/v3

### Calls Made Per Video

The backend endpoint performs two Google API calls per video:

#### videos.list

**Purpose:**
- duration (contentDetails.duration)
- views, likes, comments (statistics)
- thumbnails (snippet.thumbnails)
- publish date

**Cost:** 1 quota unit

#### channels.list

**Purpose:**
- resolve channel handle or custom URL

**Cost:** 1 quota unit

**Total cost per video:** ~2 quota units

Default YouTube quota is 10,000 units/day, allowing ~5,000 videos/day at current design.

### API Limits

With a 10,000 unit/day budget:

≈ 5,000 videos/day before quota exhaustion (10,000 ÷ 2).

## Future Improvements

### API Batching

Calls to the Google API can be batched for significant efficiency gains:

If you batch:
- 50 videos → 2 units total
- Instead of 100 units

That changes your ceiling from:
- 5,000 videos/day
- → ~250,000 videos/day

## Hero Image Selection Logic

The backend selects the best available thumbnail in descending priority:

1. maxres
2. standard
3. high
4. medium
5. default

The resolved URL is returned as heroImageUrl.

## Engagement Metrics

Computed server-side to keep the UI simple and consistent:

```
likeRate = likeCount / viewCount
commentRate = commentCount / viewCount
```

If counts are missing or views are zero, rates are returned as null.

## Design Principles

- Minimal surface area
- No frontend framework
- Single authoritative API
- CSV-first output
- Fail-soft behavior (skip invalid inputs, partial success allowed)

This tool is intentionally scoped for batch analysis and operational workflows rather than end-user presentation.
