# Social Media Metadata API

A lightweight utility for extracting structured metadata from YouTube, TikTok, Spotify, and Chartmetric, and exporting it as a unified CSV.
Designed for analysis, ops workflows, and downstream ingestion (Sheets, Excel, BI tools).

The app consists of:

- A serverless API that normalizes metadata from multiple platforms (YouTube, TikTok, Spotify, Chartmetric)
- A minimal static UI that batch-processes URLs and downloads a CSV
- No frontend framework required.

## Live API Base

https://youtube-api-project-azure.vercel.app

## API Routes

### GET /api/chartmetric/metadata?url=<SPOTIFY_URL>[&verbose=1]

Fetches normalized metadata for Spotify content (tracks, albums, artists, playlists) via the Chartmetric API.

**Recommended for:** Spotify tracks, albums, artists, and playlists when you need streaming data and analytics.

#### Supported Spotify URLs

- **Tracks**: `https://open.spotify.com/track/{id}` - Includes Spotify stream counts
- **Albums**: `https://open.spotify.com/album/{id}`
- **Artists**: `https://open.spotify.com/artist/{id}` - **Use this endpoint for artist metadata**
- **Playlists**: `https://open.spotify.com/playlist/{id}` - Includes follower counts

#### Example

GET /api/chartmetric/metadata?url=https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp

#### Default (normalized) response

```json
{
  "platform": "chartmetric",
  "originalUrl": "https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp",
  "videoId": "3n3Ppam7vgaVa1iaRUc9Lp",
  "title": "Smells Like Teen Spirit",
  "publishedAt": "1991-09-10",
  "durationIso": "PT5M1S",
  "durationSeconds": 301,
  "viewCount": 1234567890,
  "likeCount": null,
  "commentCount": null,
  "engagement_likeRate": null,
  "engagement_commentRate": null,
  "heroImageUrl": "https://i.scdn.co/image/...",
  "channelHandle": "Nirvana"
}
```

#### Verbose response (verbose=1)

Returns the raw Chartmetric API response without normalization.

#### Platform-specific field mapping

**Tracks:**
- `viewCount`: Spotify streams (`cm_statistics.sp_streams`)
- `channelHandle`: Artist names
- `publishedAt`: Release date

**Playlists:**
- `viewCount`: Follower count
- `channelHandle`: Playlist owner name
- `publishedAt`: Last updated date

**Artists:**
- `channelHandle`: Artist name
- `heroImageUrl`: Artist profile image
- Additional Chartmetric analytics available in verbose mode

**Albums:**
- `publishedAt`: Release date
- `channelHandle`: Artist names
- `heroImageUrl`: Album artwork

#### Implementation notes

- **ID Conversion**: Tracks, albums, and artists use Chartmetric's `/get-ids` endpoints to convert Spotify IDs to internal Chartmetric IDs
- **Playlist Search**: Playlists use the Chartmetric search API (fuzzy matching) since direct ID conversion is not available
- **Authentication**: Uses OAuth refresh token to obtain access tokens (cached for 1 hour)

### GET /api/spotify/metadata?url=<SPOTIFY_URL>[&verbose=1]

Fetches normalized metadata for Spotify content directly from the Spotify API.

**Recommended for:** Spotify shows and episodes. For tracks, albums, artists, and playlists, use the Chartmetric endpoint for additional analytics.

#### Supported Spotify URLs

- **Tracks**: `https://open.spotify.com/track/{id}` (use Chartmetric for stream counts)
- **Albums**: `https://open.spotify.com/album/{id}` (use Chartmetric for analytics)
- **Artists**: `https://open.spotify.com/artist/{id}` (use Chartmetric instead)
- **Playlists**: `https://open.spotify.com/playlist/{id}` (use Chartmetric for follower counts)
- **Shows**: `https://open.spotify.com/show/{id}`
- **Episodes**: `https://open.spotify.com/episode/{id}`
- **Creators URLs**: `https://creators.spotify.com/...` (resolved to canonical URLs)

#### Example

GET /api/spotify/metadata?url=https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp

#### Default (normalized) response

```json
{
  "platform": "spotify",
  "inputUrl": "https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp",
  "canonicalUrl": "https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp",
  "type": "track",
  "id": "3n3Ppam7vgaVa1iaRUc9Lp",
  "title": "Smells Like Teen Spirit",
  "publishedAt": "1991-09-10",
  "durationSeconds": 301,
  "heroImageUrl": "https://i.scdn.co/image/...",
  "channelHandle": "Nirvana"
}
```

#### Verbose response (verbose=1)

Returns the raw Spotify API response without normalization.

#### Implementation notes

- **Authentication**: Uses Spotify Client Credentials Flow (no user authentication required)
- **Creators URLs**: Automatically resolves `creators.spotify.com` URLs to canonical `open.spotify.com` URLs
  - Note: Podcast episode creators URLs are not supported due to incompatible ID format

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

### GET /api/instagram/video?url=<INSTAGRAM_URL>

Fetches normalized metadata for Instagram posts by scraping the public page and extracting embedded data.

#### Supported Instagram URLs

- **Posts**: `https://www.instagram.com/p/{shortcode}/`
- **Reels**: `https://www.instagram.com/reel/{shortcode}/`
- **TV**: `https://www.instagram.com/tv/{shortcode}/`

#### Example

GET /api/instagram/video?url=https://www.instagram.com/p/CgtXoBxr_FU/

#### Default response

```json
{
  "platform": "instagram",
  "inputUrl": "https://www.instagram.com/p/CgtXoBxr_FU/",
  "videoId": "CgtXoBxr_FU",
  "publishedAt": "2022-08-01T07:44:21.000Z",
  "description": "BLACKPINK AI Version 💖 😍 They are so pretty 😍\n\n#JISOO #지수 #블랙핑크지수 #블랙핑크 #김지수 #ygstage #ygactress #yg #actressjisoo #actresskimjisoo #kimjisoo #blackpinkjisoo #jisooblackpink #jisoosnowdrop #blackpink #blackpinkedit #jisooedit #blackpinkinyourarea #Lisoo #Chaesoo #Jensoo #Jennie #Lisa #Rośe #actressjisoo24",
  "authorHandle": "actressjisoo24",
  "heroImageUrl": "https://scontent-gru2-1.cdninstagram.com/v/t51.29350-15/296685005_375951118019173_1915861710552891075_n.webp?stp=c216.0.648.648a_dst-jpg_e35_s640x640_tt6&_nc_cat=111&ccb=7-5&_nc_sid=18de74&efg=eyJlZmdfdGFnIjoiQ0FST1VTUVMfSVRFTS5iZXN0X2ltYWdlX3VybGdlbi5DQzMiJ9&_nc_ohc=aLoTdBS0SygQ7kNvwFRls5v&_nc_oc=AdpATLmIebkhmqxyr_Pj1SzTXSStNiOYcm1GWGDvf_WRSUSUSQ7VlJlm1ZgBm48vCc&_nc_zt=23&_nc_ht=scontent-gru2-1.cdninstagram.com&_nc_gid=SggdoQ9UyoJT33liMF04HQ&_nc_ss=7a30f&oh=00_AfzYwAjrV3DOb03M1tgcZf8P9EMa6FWf99N2lNed0lSLNA&oe=69C2265C",
  "metrics": {
    "views": null,
    "likes": 49,
    "comments": 1,
    "shares": null
  }
}
```

#### Verbose response (verbose=1)

Includes `debug` object with screenshots and captured data.

#### Implementation notes

- **Authentication**: No authentication required (scrapes public page)
- **Author Handle**: Extracted from description hashtags using smart prioritization
- **Proxy Support**: Configurable via proxy parameter
- **Error behavior**: Similar to TikTok endpoint

### GET /api/search/channels?q=<QUERY>[&maxResults=50][&verbose=1]

Searches for YouTube channels by query with subscriber counts and video statistics.

#### Parameters

- `q`: Search query (required)
- `maxResults`: Maximum results (default: 10, max: 50)
- `verbose`: Return full API response when set to 1

#### Example

GET /api/search/channels?q=blackpink&maxResults=5

#### Default response

```json
[
  {
    "channelName": "BLACKPINK",
    "channelUrl": "https://www.youtube.com/blackpinkofficial",
    "channelHandle": "blackpinkofficial",
    "thumbnailUrl": "https://yt3.ggpht.com/...",
    "description": "Official BLACKPINK YouTube Channel",
    "subscriberCount": 92500000,
    "videoCount": 485
  }
]
```

#### Verbose response (verbose=1)

Returns the raw YouTube Data API response with additional fields.

## UI: Social Media Metadata → CSV Tool

### URL

/csv.html

### Description

A simple browser-based tool that allows users to:

- Paste a list of YouTube, TikTok, Instagram, or Spotify URLs (one per line)

### URL

/channels.html

### Description

A YouTube channel search tool that exports results as CSV. Features:

- Search YouTube channels by query
- Fixed maximum of 50 results (YouTube API limit)
- Includes subscriber count, video count, and channel handles
- Direct CSV download with properly formatted data

#### Example Usage

1. Enter search query (e.g., "blackpink")
2. Click "Generate CSV" 
3. Download the generated CSV file

The tool automatically uses the maximum 50 results to provide comprehensive channel data.
- Detect platform and extract IDs/handles from valid links
- Call the appropriate API endpoint for each URL (Chartmetric for Spotify tracks/albums/artists/playlists, Spotify API for shows/episodes)
- Download a CSV containing unified, normalized metadata

No authentication. No data persistence.

### Supported URL formats

**YouTube**
- https://www.youtube.com/watch?v=VIDEO_ID
- https://www.youtube.com/shorts/VIDEO_ID
- https://youtu.be/VIDEO_ID

**TikTok**
- https://www.tiktok.com/@HANDLE/video/VIDEO_ID

**Spotify**
- https://open.spotify.com/track/{id}
- https://open.spotify.com/album/{id}
- https://open.spotify.com/artist/{id}
- https://open.spotify.com/playlist/{id}
- https://open.spotify.com/show/{id}
- https://open.spotify.com/episode/{id}

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
- Filename format: `social-media-metadata-YYYY-MM-DD-HHMM.csv`
- Date format: `YYYY-MM-DD` (e.g., 2024-09-05)

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

**Spotify (via Spotify API)**
- title: track/album/artist/playlist name
- duration: from Spotify API (tracks and episodes only)
- viewCount: not available
- channelHandle: artist names, playlist owner, or publisher

**Spotify (via Chartmetric API)**
- title: track/album/artist/playlist name
- duration: from Chartmetric (tracks only)
- viewCount: Spotify streams for tracks, follower count for playlists
- channelHandle: artist names or playlist owner
- publishedAt: release date for tracks/albums, last updated for playlists

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

### Spotify

- Uses official Spotify Web API.
- Authentication via Client Credentials Flow (no user login required).
- Supports tracks, albums, artists, playlists, shows, and episodes.
- Access tokens cached for 1 hour.
- Automatically resolves `creators.spotify.com` URLs to canonical `open.spotify.com` URLs.
- Note: Creators podcast episode URLs are not supported due to incompatible ID format.

### Chartmetric

- Uses Chartmetric API for Spotify music analytics and streaming data.
- Authentication via OAuth refresh token (access tokens cached for 1 hour).
- **ID Conversion**: Tracks, albums, and artists use `/get-ids` endpoints to convert Spotify IDs to Chartmetric's internal IDs.
- **Playlist Lookup**: Uses search API with fuzzy matching (no direct ID conversion available).
- Provides additional metrics not available in Spotify API:
  - Spotify stream counts (`cm_statistics.sp_streams`)
  - Playlist follower counts
  - Last updated timestamps for playlists
- Supported entities: tracks, albums, artists, playlists.
- Not supported: shows, episodes.

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
