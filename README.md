# YouTube Metadata CSV Tool

A lightweight utility for extracting structured metadata from YouTube videos and exporting it as a CSV.
Designed for analysis, ops workflows, and downstream ingestion (Sheets, Excel, BI tools).

The app consists of:

- A serverless API that normalizes YouTube video metadata
- A minimal static UI that batch-processes YouTube URLs and downloads a CSV
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

## UI: YouTube → CSV Tool

### URL

/youtube-csv.html

### Description

A simple browser-based tool that allows users to:

- Paste a list of YouTube URLs (one per line)
- Extract video IDs from valid YouTube links
- Call the /api/video/{id} endpoint for each video
- Download a CSV containing normalized metadata

No authentication. No data persistence.

### Supported URL formats

- https://www.youtube.com/watch?v=VIDEO_ID
- https://www.youtube.com/shorts/VIDEO_ID
- https://youtu.be/VIDEO_ID

Invalid or non-YouTube URLs are silently skipped and do not appear in the CSV.

### CSV Columns (exact)

- videoId
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
- Filename format: `youtube-metadata-YYYY-MM-DD-HHMM.csv`

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
