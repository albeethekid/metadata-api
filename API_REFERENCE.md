# API Reference

This document describes the HTTP routes exposed by this server, their parameters, and expected behavior.

## Base URL

- Local dev: `http://localhost:<PORT>` (default `8080`)

## Conventions

- All endpoints return JSON unless otherwise noted.
- Query params are case-sensitive as shown.
- Many endpoints support `verbose=1` to return a richer/rawer payload.

---

# YouTube

## `GET /api/search`

Search YouTube videos.

### Query params

- `q` (required): search query
- `maxResults` (optional, default `10`): number of results

### Behavior

- Returns the raw-ish response from the internal YouTube client.

### Upstream calls

**YouTube Data API v3** via `googleapis` (`src/youtubeClient.js#searchVideos`).

| Call | Parts | Quota units |
|---|---|---|
| `youtube.search.list` (type=video, order=relevance) | `snippet` | **100 per request** |

Total quota cost: **100 units per request**. Uses `YOUTUBE_API_KEY` / `YOUTUBE_API_KEYS` with automatic key rotation on daily-quota exhaustion.

### Errors

- `400` if `q` is missing

---

## `GET /api/search/channels`

Search YouTube channels.

### Query params

- `q` (required): search query
- `maxResults` (optional, default `10`)
- `verbose` (optional): set `verbose=1` to return the full response from the YouTube client

### Response (default, non-verbose)

An array of normalized channel objects:

- `channelName`
- `channelUrl`
- `channelHandle`
- `thumbnailUrl`
- `description`
- `subscriberCount`
- `videoCount`

### Upstream calls

**YouTube Data API v3** via `googleapis` (`src/youtubeClient.js#searchChannels`).

| Call | Parts | Quota units |
|---|---|---|
| `youtube.search.list` (type=channel, order=relevance) | `snippet` | **100** |
| `youtube.channels.list` (batched IDs from search results) | `statistics, snippet` | 1 |

Total quota cost: **~101 units per request** (channels.list is skipped if the search returned no results).

### Errors

- `400` if `q` is missing

---

## `GET /api/video/:videoId`

Fetch YouTube video metadata.

### Path params

- `videoId` (required)

### Query params

- `verbose` (optional): set `verbose=1` for a fuller payload

### Response (default, non-verbose)

Compact payload including:

- `videoId`
- `title`
- `publishedAt`
- `durationIso`, `durationSeconds`
- `viewCount`, `likeCount`, `commentCount`
- `engagement.likeRate`, `engagement.commentRate`
- `heroImageUrl`
- `channelHandle`

### Upstream calls

**YouTube Data API v3** via `googleapis` (`src/youtubeClient.js#getVideoDetails`).

| Call | Parts | Quota units |
|---|---|---|
| `youtube.videos.list` | `snippet, statistics, contentDetails` | 1 |
| `youtube.channels.list` (for the video's channel handle) | `snippet` | 1 |

Total quota cost: **2 units per request**. Channel lookup failures are non-fatal — the endpoint still returns the video with `channel.handle: null`.

---

## `GET /api/channel/:channelId`

Fetch YouTube channel details.

### Path params

- `channelId` (required)

### Upstream calls

**YouTube Data API v3** via `googleapis` (`src/youtubeClient.js#getChannelDetails`).

| Call | Parts | Quota units |
|---|---|---|
| `youtube.channels.list` | `snippet, statistics, brandingSettings` | 1 |

Total quota cost: **1 unit per request**.

---

## `GET /api/channel/:channelId/videos`

Fetch recent videos for a YouTube channel.

### Path params

- `channelId` (required)

### Query params

- `maxResults` (optional, default `10`)

### Upstream calls

**YouTube Data API v3** via `googleapis` (`src/youtubeClient.js#getChannelVideos`).

| Call | Parts | Quota units |
|---|---|---|
| `youtube.search.list` (channelId filter, order=date) | `snippet` | **100** |

Total quota cost: **100 units per request**. `search.list` is used rather than `playlistItems.list` here because the caller wants "recent" ordering across the whole channel (not just uploads), which requires the search index.

---

## `GET /api/youtube/discover-siblings`

Given a known infringing YouTube channel, scan its uploads playlist and return videos that likely belong to the same content series (e.g. audiobook chapters). Useful for identifying related infringing content after an initial SERP hit.

### Query params

- `channelId` (required): YouTube channel ID
- `query` (required): search string used to score videos (e.g. book title or series name)
- `maxResults` (optional): number of channel uploads to scan, default `100`, max `300`
- `minScore` (optional): only return videos at this score or higher, default `40`, max `100`
- `sourceVideoId` (optional): video ID to exclude from results (the already-known infringing video)
- `sourceTitle` (optional): title of the source video — improves scoring via title word overlap
- `sourceDescription` (optional): description of the source video — improves scoring via keyword overlap

### Scoring

Each candidate video is scored 0–100 based on:

| Signal | Points |
|---|---|
| Exact query phrase in title | +50 |
| Partial query term matches in title | up to +30 |
| Chapter/Part/Vol/Episode pattern in title | +25 |
| Query terms in description | +10 |
| Title word overlap with `sourceTitle` | +15 |
| Description keyword overlap with `sourceDescription` | +10 |

Only videos with `score > 0` are returned, sorted by score descending.

### Response

```json
{
  "platform": "youtube",
  "query": "...",
  "channel": {
    "channelId": "...",
    "title": "...",
    "uploadsPlaylistId": "..."
  },
  "summary": {
    "candidatesScanned": 100,
    "matchesReturned": 12
  },
  "matches": [
    {
      "videoId": "...",
      "title": "...",
      "description": "...",
      "publishedAt": "...",
      "channelId": "...",
      "channelTitle": "...",
      "url": "https://www.youtube.com/watch?v=...",
      "thumbnailUrl": "...",
      "score": 87,
      "scoreReasons": ["exact query match in title", "chapter pattern match"]
    }
  ]
}
```

### Upstream calls

**YouTube Data API v3** via `googleapis`. This endpoint is intentionally
built on cheap 1-unit calls to avoid the expensive `search.list` cost.

| Call | Parts | Quota units | Notes |
|---|---|---|---|
| `youtube.channels.list` (`src/youtubeClient.js#getChannelContentDetails`) | `snippet, contentDetails` | 1 | Uses `forHandle` when `channelId` starts with `@`, otherwise `id`. Returns the channel's `contentDetails.relatedPlaylists.uploads` playlist ID. |
| `youtube.playlistItems.list` (`#getPlaylistItemsAll`, paginated) | `snippet` | 1 per page | Fetches up to 50 items per page. For `maxResults=100` that's 2 pages = **2 units**; `maxResults=300` = 6 pages = **6 units**. |

**Typical quota cost**: **3 units** for the default `maxResults=100` scan (1 for channels.list + 2 for two pages of playlistItems.list). Compare with `/api/search?channelId=...` which would cost 100 units for the same scan.

**No calls to** `videos.list` — scoring is performed entirely against the snippet/thumbnails data returned by `playlistItems.list`, which is sufficient for the title/description overlap heuristics.

### Errors

- `400` if `channelId` or `query` is missing
- `404` if channel not found
- `502` if uploads playlist cannot be determined

---

## `GET /api/youtube/transcript`

Fetch the public transcript/captions for a YouTube video for downstream analysis (e.g. piracy detection). Backed by `yt-dlp`. No browser automation, no official captions API, no API key.

### Query params

- `videoId` (optional if `url` is provided): YouTube video ID
- `url` (optional if `videoId` is provided): full YouTube URL — supports `youtube.com/watch?v=...`, `youtu.be/...`, `youtube.com/shorts/...`, `youtube.com/embed/...`
- `lang` (optional, default `en`): preferred language code
- `proxy` (optional, default on if Oxylabs credentials exist): set `proxy=false` or `proxy=0` to bypass the proxy and call YouTube directly

### Behavior

- Uses `yt-dlp` to enumerate available caption tracks, then downloads the chosen track in `json3` format
- **Prefers manually-authored captions** over auto-generated for the requested language
- Falls back to auto-generated captions if no manual track exists in that language
- Falls back to any manual track in another language if none exist for the requested language
- `text` is truncated to **100,000 characters**; the full `segments` array is always preserved
- Both yt-dlp calls (metadata + subtitle download) are routed through the project's Oxylabs residential proxy by default. From a datacenter IP without a proxy, YouTube will frequently return a "Sign in to confirm you're not a bot" challenge that surfaces here as `404 VIDEO_UNAVAILABLE`

### Response

```json
{
  "platform": "youtube",
  "videoId": "abc123",
  "language": "en",
  "isGenerated": false,
  "segmentCount": 142,
  "text": "full concatenated transcript text...",
  "segments": [
    { "start": 0.52, "duration": 4.12, "text": "chapter one..." }
  ]
}
```

### Errors

| Status | When |
|---|---|
| `400` | Neither `videoId` nor a valid YouTube `url` was provided |
| `404` | Transcript disabled, missing, empty, or video unavailable |
| `502` | Upstream fetch/parse failure (YouTube watch page or transcript URL) |

### Upstream calls

- **`yt-dlp`** (invoked via `yt-dlp-wrap`) — makes two subprocess calls: one to list available caption tracks, one to download the chosen track in `json3` format. **No YouTube Data API quota is consumed** — this endpoint hits YouTube's public watch page and captions endpoints via yt-dlp.
- **Oxylabs residential proxy** — both yt-dlp calls are routed through the proxy by default when `OXYLABS_*` credentials are set (bypass with `proxy=0`).

---

## `GET /api/video/:videoId/comments`

Fetch comments for a YouTube video.

### Path params

- `videoId` (required)

### Query params

- `maxResults` (optional, default `20`)

### Upstream calls

**YouTube Data API v3** via `googleapis` (`src/youtubeClient.js#getVideoComments`).

| Call | Parts | Quota units |
|---|---|---|
| `youtube.commentThreads.list` (order=relevance) | `snippet` | 1 |

Total quota cost: **1 unit per request**. Note: only top-level comment threads are returned — replies are not fetched.

---

## `GET /api/trending`

Fetch trending YouTube videos.

### Query params

- `regionCode` (optional, default `US`)
- `maxResults` (optional, default `10`)

### Upstream calls

**YouTube Data API v3** via `googleapis` (`src/youtubeClient.js#getTrendingVideos`).

| Call | Parts | Quota units |
|---|---|---|
| `youtube.videos.list` (chart=mostPopular) | `snippet, statistics` | 1 |

Total quota cost: **1 unit per request**.

---

## `GET /api/playlist/:playlistId`

Fetch playlist items.

### Path params

- `playlistId` (required)

### Query params

- `maxResults` (optional, default `50`)

### Upstream calls

**YouTube Data API v3** via `googleapis` (`src/youtubeClient.js#getPlaylistItems`).

| Call | Parts | Quota units |
|---|---|---|
| `youtube.playlistItems.list` | `snippet` | 1 |

Total quota cost: **1 unit per request** (single non-paginated call — for paginated fetches see `#getPlaylistItemsAll`, used by `/api/youtube/discover-siblings`).

---

# TikTok

## `GET /api/tiktok/video/metrics`

Fetch TikTok video metrics by scraping/parsing.

### Query params

- `url` (required): TikTok video URL
- `verbose` (optional): set `verbose=1` for extra debugging/fields
- `debugProxy` (optional): set `debugProxy=1` to include proxy diagnostic info
- `proxy` (optional):
  - omitted: default behavior (proxy used if configured)
  - `proxy=0` or `proxy=false`: disable proxy

### Upstream calls

**No third-party API.** This endpoint fetches the TikTok video's public HTML
page directly (`src/tiktokMetrics.js`), parses the embedded `SIGI_STATE` /
`__UNIVERSAL_DATA_FOR_REHYDRATION__` JSON blob, and extracts metrics from it.

- **Oxylabs residential proxy** is used by default when configured; disable
  with `proxy=0`.

### Errors

- `400` if `url` is missing

---

## `GET /api/tiktok/ytdlp`

Fetch TikTok video metadata via `yt-dlp`.

### Query params

- `url` (required)
- `verbose` (optional)
- `debugProxy` (optional)
- `proxy` (optional): same semantics as `/api/tiktok/video/metrics`

### Notes

- This endpoint uses `yt-dlp-wrap` and may be unsuitable for some serverless environments.

### Upstream calls

- **`yt-dlp`** subprocess invocation via `yt-dlp-wrap` (`src/tiktokYtdlp.js`).
  Single call to yt-dlp with `--dump-single-json` to extract the full metadata
  envelope (video info, author, stats, formats, music).
- **Oxylabs residential proxy** used by default; disable with `proxy=0`.
- **No third-party API keys required** for this endpoint.

---

## `GET /api/tiktok/profiles`

Search TikTok profiles by keyword (discovery) via EnsembleData and normalize results.

### Query params

- `query` (required): search term
- `maxResults` (optional, default `50`, max `100`)
- `cursor` (optional, default `0`): starting cursor for EnsembleData pagination
- `thumbnail` (optional):
  - `thumbnail=avatar`: return avatar/URL from EnsembleData (no screenshot generation)
- `screenshot` (optional):
  - `screenshot=0` or `screenshot=false`: disable screenshot generation
- `useScreenshotThumbnail` (optional):
  - `useScreenshotThumbnail=0` or `useScreenshotThumbnail=false`: disable screenshot thumbnail mode

### Behavior

- By default, screenshot thumbnails are enabled. The server will:
  - discover profiles via EnsembleData
  - compute the profile URL (`https://www.tiktok.com/@<handle>/`)
  - call `/api/screenshot` (meta mode) for each profile and use the returned `s3_url` as `thumbnailUrl`
- If screenshot mode is disabled (`thumbnail=avatar` or `screenshot=0` or `useScreenshotThumbnail=0`), it returns an avatar URL derived from the API response.

### Response

An array of normalized profile objects:

- `channelName`
- `channelUrl`
- `channelHandle`
- `thumbnailUrl`
- `description`
- `subscriberCount`
- `videoCount`

### Upstream calls

- **EnsembleData API** — `GET https://ensembledata.com/apis/tt/user/search` with `name=<query>&cursor=<cursor>`. Returns candidate TikTok users; the endpoint may make multiple calls to fill `maxResults`. Auth: `ENSEMBLE_DATA_API_KEY`.
- **Internal `/api/screenshot`** (default: on) — one call per profile in screenshot-thumbnail mode, hitting `https://www.tiktok.com/@<handle>/` with `meta=1&storage_provider=cloudflare`. Each nested call transitively invokes Playwright and Cloudflare R2 upload.
- **Cloudflare R2** (transitively via `/api/screenshot`) — one `PutObject` per profile thumbnail.

### Errors

- `400` if `query` is missing
- `503` if `ENSEMBLE_DATA_API_KEY` is not configured
- `502` `SCREENSHOT_UPLOAD_FAILED` if screenshot mode is enabled and one or more screenshot uploads fail

---

# Instagram

## `GET /api/instagram/video`

Scrape Instagram post/reel/tv metrics.

### Query params

- `url` (required): Instagram URL
- `debug` (optional): `debug=1` enables debug collection
- `verbose` (optional): treated like `debug=1`
- `debugProxy` (optional): `debugProxy=1` includes proxy diagnostic info
- `proxy` (optional):
  - omitted: default behavior
  - `proxy=0` or `proxy=false`: disable proxy

### Behavior

- Returns JSON by default.
- If `debug=1` and the request `Accept` header includes `text/html`, the endpoint returns an HTML debug page that includes captured screenshots and raw JSON.

### Upstream calls

- **Playwright** — headless Chromium navigates to the Instagram URL and reads the `sharedData` blob / GraphQL response embedded in the page (`src/instagramScraper.js`).
- **Oxylabs residential proxy** — Playwright is launched with the proxy when credentials exist; disable via `proxy=0`.
- **No Instagram-facing API key** — this is a plain page scrape, so login walls and IP-based rate limiting are the primary failure modes.

### Errors

- `400` if `url` is missing or invalid

---

## `GET /api/instagram/video/apify`

Fetch Instagram post/reel/tv metrics using Apify's `instagram-scraper` actor.

### Query params

- `url` (required): Instagram URL
- `verbose` (optional): `verbose=1` includes full Apify response data in `apifyData` field

### Behavior

- Uses Apify `apify/instagram-scraper` actor
- Returns normalized response matching `/api/instagram/video` shape
- When `verbose=1`, includes full Apify post data with additional fields like:
  - `hashtags`, `mentions`, `taggedUsers`
  - `latestComments` (array of recent comments)
  - `videoUrl`, `displayUrl`, `images`
  - `coauthorProducers`, `musicInfo`
  - `dimensionsHeight`, `dimensionsWidth`
  - `productType`, `videoDuration`

### Response

Same shape as `/api/instagram/video`:
- `platform`: "instagram"
- `inputUrl`: decoded URL
- `videoId`: shortcode
- `publishedAt`: ISO timestamp
- `description`: caption
- `authorHandle`: username
- `heroImageUrl`: display image URL
- `metrics`: { `views`, `likes`, `comments`, `shares` }
- `apifyData` (only if `verbose=1`): full Apify post object

### Upstream calls

- **Apify Platform API** — starts a synchronous run of the `apify/instagram-scraper` actor with `directUrls=[<url>]`, waits for completion, then fetches the actor's default dataset. Sequence:
  - `POST https://api.apify.com/v2/acts/apify~instagram-scraper/runs` (start)
  - `GET  https://api.apify.com/v2/actor-runs/<runId>` (poll until finished)
  - `GET  https://api.apify.com/v2/datasets/<defaultDatasetId>/items` (fetch)
  - Auth: `APIFY_API_KEY`. Actor billing: consumes Apify compute units per run.

### Errors

- `400` if `url` is missing or invalid
- `503` if `APIFY_API_KEY` not configured
- `502` if Apify actor run fails
- `404` if no data returned from Apify

---

## `GET /api/instagram/profiles`

Search Instagram profiles by keyword:

- discovery via EnsembleData
- enrichment via Apify Actor `apify/instagram-profile-scraper`

### Query params

- `query` (required): search term

### Behavior

- Discovers candidate usernames from EnsembleData.
- Runs the Apify actor to enrich and normalize profiles.

### Response

An array of normalized profile objects:

- `channelName`
- `channelUrl`
- `channelHandle`
- `thumbnailUrl`
- `description`
- `subscriberCount`
- `videoCount`

### Upstream calls

- **EnsembleData API** — `GET https://ensembledata.com/apis/instagram/search?text=<query>` for candidate handle discovery. Auth: `ENSEMBLE_DATA_API_KEY`.
- **Apify Platform API** — starts the `apify/instagram-profile-scraper` actor with the discovered usernames, waits for completion, and reads the dataset items:
  - `POST https://api.apify.com/v2/acts/apify~instagram-profile-scraper/runs`
  - `GET  https://api.apify.com/v2/actor-runs/<runId>` (poll)
  - `GET  https://api.apify.com/v2/datasets/<defaultDatasetId>/items`
  - Auth: `APIFY_API_KEY`.

### Errors

- `400` if `query` is missing
- `503` if `ENSEMBLE_DATA_API_KEY` or `APIFY_API_KEY` are not configured

---

# Twitter / X

## `GET /api/twitter/profiles`

Search Twitter/X profiles by keyword.

- Discovery via Apify actor `watcher.data/search-x-by-keywords` (`searchType: "users"`)

### Query params

- `query` (required): search term
- `maxResults` (optional, default `50`, max `100`)

### Behavior

- Calls the Apify actor which hits the Twitter People search tab directly, returning accounts whose name/bio matches the keyword.
- Results are deduplicated by username.

### Response

An array of normalized profile objects:

- `channelName`
- `channelUrl`
- `channelHandle`
- `thumbnailUrl`
- `description`
- `subscriberCount`
- `videoCount`

### Upstream calls

- **Apify Platform API** — runs the `watcher.data/search-x-by-keywords` actor with `keywords=[query]&searchType=users`. Same sync-run-and-fetch flow as the Instagram Apify endpoints:
  - `POST https://api.apify.com/v2/acts/watcher.data~search-x-by-keywords/runs`
  - `GET  https://api.apify.com/v2/actor-runs/<runId>` (poll)
  - `GET  https://api.apify.com/v2/datasets/<defaultDatasetId>/items`
  - Auth: `APIFY_API_KEY`.

### Errors

- `400` if `query` is missing
- `503` if `APIFY_API_KEY` is not configured
- `502` `APIFY_RUN_FAILED` if the Apify actor run fails
- `502` `APIFY_NO_DATASET_ID` if the actor response has no dataset ID
- `502` `APIFY_DATASET_FAILED` if fetching dataset items fails

---

# Screenshot / Rendering

## `GET /api/screenshot`

Render a web page in Playwright and return either an image response or a metadata JSON payload.

### Query params

- `url` (required): target URL
- `download` (optional): `download=1` sets `Content-Disposition: attachment`
- `fullPage` (optional): `fullPage=1` captures full page
- `meta` (optional): `meta=1` returns JSON metadata (and optionally upload URL) instead of raw image bytes
- `debug` (optional): `debug=1` prints extra logs and includes extra debug fields in metadata
- `includeImage` (optional): `includeImage=1` (meta mode only) includes `imageBase64` in JSON
- `selector` (optional): capture a specific element
- `format` (optional, default `jpeg`): `jpeg|png|webp`
- `quality` (optional, default `65`): for `jpeg`/`webp`
- `profileMode` (optional): `profileMode=persistent` uses a persistent profile
- `timeoutMs` (optional, default `30000`): navigation timeout
- `storage_provider` (optional):
  - `storage_provider=cloudflare` uploads the screenshot to Cloudflare R2 and includes `s3_url` in metadata
- `debugProxy` (optional): include proxy diagnostic info in meta mode
- `proxy` (optional):
  - omitted: default behavior
  - `proxy=0` or `proxy=false`: disable proxy

### Response modes

- `meta=1`: JSON metadata including `status`, `warnings`, `pageSignals`, and (when `storage_provider=cloudflare`) `s3_url`
- default: image bytes (`image/jpeg`, `image/png`, or `image/webp`)

### Upstream calls

- **Playwright / Chromium** — launches a headless browser, navigates to the target URL, captures the screenshot buffer.
- **Oxylabs residential proxy** — Playwright is launched through the proxy by default when credentials exist; disable with `proxy=0`.
- **Cloudflare R2** (only when `storage_provider=cloudflare`) — one `PutObject` via the AWS S3-compatible SDK (`src/r2-storage.js`) to the bucket named by `R2_BUCKET`, using `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` for auth. The public URL is derived from `R2_PUBLIC_BASE_URL`.
- **No third-party APIs** are called when `storage_provider` is omitted — the image is returned directly to the client.

---

# Proxy Debug

## `GET /api/proxy/status`

Debug endpoint to verify Playwright proxy configuration.

### Query params

- `proxy` (optional):
  - omitted: default behavior
  - `proxy=0` or `proxy=false`: disable proxy

### Response

- `proxyEnabled`
- `hasCredentials`
- `proxyServer`
- `requestedOverride`
- `message`

---

# Spotify

## `GET /api/spotify/metadata`

Fetch metadata for Spotify URLs using the Spotify Web API.

### Query params

- `url` (required): Spotify URL (track/album/artist/playlist/show/episode)
- `verbose` (optional): `verbose=1` returns raw SDK response

### Behavior

- Supports some `creators.spotify.com` URLs via an HTML resolver.

### Upstream calls

**Spotify Web API** (`src/spotify.js`). All calls are authenticated with a
client-credentials bearer token cached in-process until expiry.

| Call | Purpose |
|---|---|
| `POST https://accounts.spotify.com/api/token` (grant=client_credentials) | Fetches a bearer token; result is cached in memory until near expiry. |
| `GET  https://api.spotify.com/v1/tracks/{id}` | Track URLs |
| `GET  https://api.spotify.com/v1/albums/{id}` | Album URLs |
| `GET  https://api.spotify.com/v1/artists/{id}` | Artist URLs |
| `GET  https://api.spotify.com/v1/playlists/{id}` | Playlist URLs |
| `GET  https://api.spotify.com/v1/shows/{id}` | Show URLs |
| `GET  https://api.spotify.com/v1/episodes/{id}` | Episode URLs |

Exactly **one** metadata call is made per request (the token exchange only runs when the cached token is missing/expired). Auth: `SPOTIFY_CLIENT_ID` + `SPOTIFY_SECRET`.

### Errors

- `400` `unsupported_spotify_url` when URL type is unsupported
- `400` `unsupported_creators_url` when a creators URL can’t be resolved

---

# Chartmetric

## `GET /api/chartmetric/metadata`

Fetch enriched metadata (including streaming-related stats) for Spotify items via Chartmetric.

### Query params

- `url` (required): Spotify URL (track/album/artist/playlist)
- `verbose` (optional): `verbose=1` returns raw client response

### Notes

- Chartmetric is used for tracks/albums/artists/playlists. Spotify shows/episodes are handled via `/api/spotify/metadata`.

### Upstream calls

**Chartmetric API** (`src/chartmetric.js`). Auth: refresh-token exchange
producing a bearer token cached in-process.

| Call | Purpose |
|---|---|
| `POST https://api.chartmetric.com/api/token` (`refreshtoken`) | Bearer token exchange; result is cached in memory until near expiry. |

Then, per item type, Chartmetric requires a **two-step resolve** (Spotify ID → Chartmetric ID → entity), so each URL type costs **2 GET calls** (or 3 for playlists which use `/search`):

| Spotify item type | Calls |
|---|---|
| Track  | `GET /track/spotify/{spotifyId}/get-ids` → `GET /track/{cmId}` |
| Album  | `GET /album/spotify/{spotifyId}/get-ids` → `GET /album/{cmId}` |
| Artist | `GET /artist/spotify/{spotifyId}/get-ids` → `GET /artist/{cmId}` |
| Playlist | `GET /search?q=spotify:playlist:{id}&type=playlists` → `GET /playlist/spotify/{cmId}` |

**Typical cost**: **2 API calls per request** (3 for playlists), plus a token exchange the first time.

---

# Root

## `GET /`

Returns a JSON object describing the server and some example routes.

---

# UI Pages (Frontend)

This repo serves a set of static HTML pages from `public/` that call the API routes listed above. Each tool is a thin client over the same JSON endpoints, so anything the UI does is also available via direct HTTP calls.

| Page | Tool |
|---|---|
| `/sheets.html` | Vermillio Report Augmentation (Google Sheets) |
| `/csv.html` | CSV Generator (paste-URL batch processor) |
| `/channels.html` | Channel / profile search across platforms |
| `/discover-siblings.html` | Sibling discovery from a SERP CSV |
| `/screenshot.html` | Bulk screenshot capture |

---

## Report Augmentation UI: `GET /sheets.html`

Source: `public/sheets.html` · Backend module: `src/sheetsService.js`

A Google-Sheets-driven processor that reads URLs out of a sheet, fetches normalized metadata for each, writes the results back into the same row, and (optionally) lets an LLM evaluate the resulting report and edit cells directly.

### Sheet requirements

The Sheet must have:

1. A tab literally named **`report`** (case-sensitive).
2. A header row in row 1 of `report` that includes a column literally named **`page_url`**. Other column positions don't matter — the writer matches by header name, not by column letter.
3. The sheet must be shared with the service account email (read **and** write) referenced by the server's Google credentials. A read-only share will fail at write time, not preflight.

The header row may contain any subset of the augmentation columns the server knows how to write — missing headers are silently skipped, so partial schemas are fine.

### Column mapping

When a row is processed, the normalized payload from the per-platform fetch is mapped onto the following headers in the `report` tab. Headers not present in row 1 are skipped; row positions are matched by header name.

| Sheet header | Normalized field | Source |
|---|---|---|
| `Title` | `title` | platform fetch |
| `content_url` | `heroImageUrl` | platform fetch |
| `likeness_match` | `channelHandle` | platform fetch |
| `likeness_label` | `durationSeconds` | platform fetch |
| `likeness_score` | `viewCount` | platform fetch |
| `recommendation` | `publishedAt` | platform fetch |

This mapping lives in `COLUMN_MAP` in `src/sheetsService.js` — that array is the source of truth.

### Workflow

The UI runs in three phases: **Validate Sheet → Process Rows → (optional) Ask the LLM**.

#### 1. Validate Sheet (preflight)

Calls `POST /api/sheets/preflight` with `{ sheetUrl }`. The server:

- Extracts the spreadsheet ID from the pasted URL.
- Lists every tab in the spreadsheet (with row counts) so the LLM panel can offer them as additional context.
- Confirms the `report` tab exists and that row 1 contains a `page_url` header.
- Returns every row with a non-empty `page_url`, paired with its 1-based spreadsheet row number.

The UI then renders a row table (one row per source row) and reveals the LLM Q&A panel.

#### 2. Process Rows

The UI splits work into two independent pipelines so writes are batched cheaply against the Sheets API:

- **Fetch pipeline (parallel, `FETCH_CONCURRENCY = 25`).**
  Unique `page_url` values are deduped first — multiple sheet rows pointing to the same URL share a single fetch. Each unique URL is sent to `POST /api/sheets/fetch-row`, which internally routes through the same per-platform endpoints the CSV Generator uses (`/api/video/...`, `/api/tiktok/ytdlp`, `/api/instagram/video`, etc.). Per-row failures return `ok: false` with `error`/`message` rather than aborting the batch.

- **Write pipeline (chunked, `WRITE_BATCH_SIZE = 25`).**
  Successful results accumulate into chunks; each chunk is flushed via `POST /api/sheets/write-rows`, which performs **one** `spreadsheets.values.batchUpdate` call (one Sheets-API quota unit) covering up to 25 rows × N columns. This is the key cost optimization: a 500-row sheet costs 20 write calls instead of 500.

The UI updates each row's status pill in real time: `pending → running → fetched → ok` (or `err`).

#### 3. Ask the LLM (optional)

Once preflight succeeds, an "Ask the LLM about this report" panel appears. It calls `POST /api/sheets/ask` with the user's prompt, the sheet URL, and a tab-selector list. See the `/api/sheets/ask` section below for full behavior; the short version:

- Always includes the `report` tab (as TSV) plus any extra tabs the user selects.
- Per-tab cap: ~80 KB; total cap: ~240 KB. Truncation is reported back in the response.
- If **"Let the LLM write changes back to the report tab"** is checked (default: on), Claude is given an `update_report_cells` tool. The server runs an agentic loop (up to 8 turns, up to 2,000 cells written total), executing each `tool_use` block against the `report` tab via `writeCellsByHeader` and feeding results back into the conversation until Claude stops emitting tool calls.
- Only headers that already exist in row 1 of `report` can be written. Claude is told the exact list of valid headers and is instructed to refuse rather than invent new columns.
- The UI surfaces a per-header summary of what was written (`status: row 7 → "looks pretty bad", row 12 → "not enough info" …`).

### Backend endpoints

The Sheets Processor UI is a thin client over these routes. They are also documented in their own sections, but listed together here for convenience.

| Endpoint | Purpose |
|---|---|
| `POST /api/sheets/preflight` | Validate sheet, list tabs, return rows-with-`page_url` |
| `POST /api/sheets/fetch-row` | Fetch normalized metadata for a single URL (no Sheet I/O) |
| `POST /api/sheets/write-rows` | Batch-write up to N normalized results into the `report` tab in one Sheets API call |
| `POST /api/sheets/ask` | Claude Q&A over the sheet contents, with optional tool-use writeback |
| `POST /api/sheets/process-row` | Legacy single-shot fetch+write per row (kept for ad-hoc / scripted use) |

### Upstream calls

**Google Sheets API v4** (via `googleapis`, `src/sheetsService.js`) — authenticated with a service-account JSON key.

| Endpoint | Sheets API calls |
|---|---|
| `POST /api/sheets/preflight` | `spreadsheets.get` + `spreadsheets.values.get` (report tab range) |
| `POST /api/sheets/fetch-row` | None — pure metadata fetch via `processUrl`; no Sheet I/O |
| `POST /api/sheets/write-rows` | One `spreadsheets.values.batchUpdate` regardless of row count |
| `POST /api/sheets/ask` | `spreadsheets.values.get` per included tab (report + optional extras). If `writeBack=true`, each `update_report_cells` tool call issues an additional `spreadsheets.values.batchUpdate`. |
| `POST /api/sheets/process-row` | `spreadsheets.values.get` (or cached headerIndex) + `spreadsheets.values.batchUpdate` on success |

**Anthropic Messages API** (only for `/api/sheets/ask`) — `POST https://api.anthropic.com/v1/messages`, up to 8 iterations per request (agentic tool-use loop). Model: `claude-sonnet-4-5`. Auth: `ANTHROPIC_API_KEY`.

**Downstream metadata fetches** — `/api/sheets/fetch-row` and `/api/sheets/process-row` route the row's `page_url` through `src/urlProcessor.js`, which in turn calls the platform-specific endpoints documented above (`/api/video/:id`, `/api/tiktok/*`, `/api/instagram/*`, `/api/chartmetric/metadata`, `/api/spotify/metadata`, `/api/screenshot`, etc.). Upstream costs cascade accordingly.

### Implementation notes

- **Header-name-only writes.** The writer never assumes column positions. It builds `A1` ranges from `headerIndex[headerName]` at request time, so reordering columns in the Sheet does not break the integration.
- **Sticky duplicate handling.** If the same URL appears in N rows, only one fetch happens and the result is fanned out to all N rows. Each row's status pill still updates independently.
- **Quota accounting.** The Sheets API write cost is dominated by the number of `batchUpdate` calls, not the number of cells. With 25-row chunks, a typical 200-row sheet incurs ~8 write calls. Reads are cheap regardless.
- **Auth.** The server uses a service account (Google credentials configured server-side). The UI never sees credentials; it only handles the sheet URL.
- **LLM model.** `claude-sonnet-4-5` (Anthropic Messages API), called directly via `fetch` — no SDK dependency. Requires `ANTHROPIC_API_KEY` server-side.

### Errors

The UI surfaces backend error codes verbatim. Common ones:

| Code | Meaning |
|---|---|
| `BAD_SHEET_URL` | URL didn't contain a recognizable spreadsheet ID |
| `SHEET_NOT_ACCESSIBLE` | Service account isn't a viewer/editor on the sheet |
| `TAB_NOT_FOUND` | No tab literally named `report` |
| `TAB_EMPTY` | `report` tab has no rows |
| `COLUMN_NOT_FOUND` | `page_url` header is missing from row 1 |
| `MISSING_ANTHROPIC_KEY` | LLM panel was used but the server has no `ANTHROPIC_API_KEY` |
| `ANTHROPIC_ERROR` | Upstream Anthropic API error (forwarded verbatim) |
| `YOUTUBE_QUOTA_EXHAUSTED` | All configured YouTube API keys hit their daily quota; affects rows whose `page_url` is YouTube |

---

## CSV Generator UI: `GET /csv.html`

Source: `public/csv.html`

### Routes called

- **YouTube video metadata**
  - Calls: `GET /api/video/:videoId`
  - When: input URL is a supported YouTube video URL (`watch?v=...`, `youtu.be/...`, `shorts/...`)

- **TikTok video metadata**
  - Calls: `GET /api/tiktok/ytdlp?url=<TIKTOK_URL_ENCODED>`
  - When: input URL matches `https://www.tiktok.com/@<handle>/video/<id>`

- **Instagram post/reel metadata**
  - Calls: `GET /api/instagram/video?url=<INSTAGRAM_URL_ENCODED>`
  - When: input URL path matches `/p/<shortcode>/`, `/reel/<shortcode>/`, or `/tv/<shortcode>/`

- **Spotify / Chartmetric metadata**
  - Calls (tracks/albums/artists/playlists): `GET /api/chartmetric/metadata?url=<SPOTIFY_URL_ENCODED>`
  - Calls (shows/episodes): `GET /api/spotify/metadata?url=<SPOTIFY_URL_ENCODED>`
  - When: input URL is a supported Spotify URL

- **Generic screenshot fallback**
  - Calls: `GET /api/screenshot?url=<URL_ENCODED>&meta=1&storage_provider=cloudflare`
  - When:
    - input URL is not recognized as YouTube/TikTok/Instagram/Spotify, OR
    - input URL is recognized but not in a supported format (e.g., non-video YouTube URL)
  - Controlled by UI checkbox: **“Include screenshots for unsupported URLs”**

### Notes

- The CSV generator processes URLs concurrently (worker pool limit is `5` in the current UI implementation).

---

## Channel Search UI: `GET /channels.html`

Source: `public/channels.html`

### Routes called

- **YouTube channel search**
  - Calls: `GET /api/search/channels?q=<QUERY>&maxResults=50`

- **TikTok profile search**
  - Calls: `GET /api/tiktok/profiles?query=<QUERY>`
  - Note: this uses the default behavior of `/api/tiktok/profiles`, which generates screenshot thumbnails (via server-side calls to `/api/screenshot`) unless disabled.

- **Instagram profile search**
  - Calls: `GET /api/instagram/profiles?query=<QUERY>`

- **Twitter/X profile search**
  - Calls: `GET /api/twitter/profiles?query=<QUERY>`

### Notes

- The UI merges all results and adds a `platform` column to the generated CSV.

---

## Screenshot Tool UI: `GET /screenshot.html`

Source: `public/screenshot.html`

Paste one or more URLs into the textarea and capture Cloudflare R2-hosted screenshots.

- **Single URL**: calls `GET /api/screenshot?url=...&meta=1&storage_provider=cloudflare` and displays the resulting public `s3_url` with a copy button.
- **Multiple URLs**: processes each URL serially with a progress bar, then downloads a CSV with columns `originalUrl` and `screenshotUrl`.
- Optional **full page** checkbox sets `fullPage=1`.

---

# Artist Record Enrichment

Upload a CSV of artist / rights-holder records keyed on `Title Override`. The
service assesses whether each title is specific enough to identify an entity,
runs targeted Serper.dev searches, and asks Claude via a strict tool-use
schema to resolve identity, official properties, produced works, and media
affiliations. Ambiguous or generic titles are flagged for review rather than
enriched blindly.

- **UI**: `/enrichment.html`
- **Source**: `src/enrichmentWorker.js`, `src/enrichmentStore.js`, `src/enrichmentCsv.js`, `src/serpClient.js`, `public/enrichment.html`
- **Persistence**: file-based JSON under `data/enrichment/{jobId}/` (no database)
- **Required env**: `SERPER_API_KEY`, `ANTHROPIC_API_KEY`
- **Optional env**: `ENRICHMENT_CONCURRENCY` (default 3), `ENRICHMENT_MAX_ROWS` (500), `ENRICHMENT_MAX_BYTES` (2 MB), `ENRICHMENT_MAX_SERP_PER_ROW` (5), `ENRICHMENT_LLM_MODEL` (`claude-sonnet-4-5`), `ENRICHMENT_LLM_TIMEOUT_MS` (60000), `ENRICHMENT_DATA_DIR`

## Input schema

The uploaded CSV must include the following columns (exact names, exact order
in the exported CSV). Only `email` and `Title Override` are hard-required; the
other columns are preserved verbatim and populated where possible.

```
email, first_name, last_name, full_name, stage_name, Title Override, Country,
profession_of_artist, organization, produced_works, tiktok_url, instagram_url,
x_url, youtube_url, facebook_url, official_store_url, official_site_url,
media_affiliations, query_override
```

- `Country` is written as an **ISO 3166-1 alpha-2** code (e.g. `US`, `GB`, `KR`).
- List fields (`produced_works`, `media_affiliations`, exported `source_urls`)
  are **comma-delimited** (`"Fire for You, Hurricane, Bad Dream"`).
- `query_override` is **user-only** — the model never populates it. User-
  supplied values are preserved verbatim.

## Export schema

Full-export CSVs append the following review columns **after** the input
columns (never interleaved):

```
enrichment_status, title_quality_status, flag_reason, entity_type,
confidence, source_urls
```

CSV cells beginning with `= + - @ \t \r` are prefixed with a single quote at
export time to neutralize spreadsheet formula injection.

## `GET /api/enrichment/template.csv`

Downloads the blank template with the canonical column order and three sample
`Title Override` values (Central Cee, Michelle Joy (Cannons), Cannons).

## `POST /api/enrichment/upload`

Creates a new enrichment job from the uploaded CSV text.

### Body

```json
{ "csvText": "<CSV file contents as string>", "filename": "artists.csv" }
```

### Response

```json
{
  "jobId": "6dcc8dbb...",
  "filename": "artists.csv",
  "totalRows": 12,
  "detectedColumns": ["email", "Title Override", ...],
  "missingRequired": [],
  "unknownColumns": [],
  "preview": [ /* first 10 rows */ ],
  "limits": { "maxRows": 500, "maxBytes": 2097152 },
  "warnings": []
}
```

### Errors

| Status | Error code | Meaning |
|---|---|---|
| 400 | `MISSING_CSV` | `csvText` was missing or empty. |
| 400 | `INVALID_EXTENSION` | `filename` did not end in `.csv`. |
| 400 | `MALFORMED_CSV` | Parser failed on the file. |
| 400 | `MISSING_REQUIRED_COLUMNS` | `email` or `Title Override` missing. |
| 400 | `EMPTY_CSV` | Header present but zero data rows. |
| 413 | `FILE_TOO_LARGE` | Exceeded `ENRICHMENT_MAX_BYTES`. |
| 413 | `TOO_MANY_ROWS` | Exceeded `ENRICHMENT_MAX_ROWS`. |

## `GET /api/enrichment`

Lists all jobs (most recent first).

## `GET /api/enrichment/:jobId`

Returns job metadata and progress counters. Also includes `active: true|false`
so the UI can tell whether an in-process worker is currently running the job.

## `GET /api/enrichment/:jobId/rows`

### Query params

- `filter` — `all` (default), `enriched`, `flagged`, `needs_review`, or `failed`.
- `search` — case-insensitive substring match against `Title Override`, `full_name`, `stage_name`, `organization` (original + enriched).

Response `rows[]` includes each row's `original`, `enriched.row`,
`enriched.audit`, per-row `status`, `title_quality_status`, `flag_reason`,
`entity_type`, `confidence`, and `summary`.

## `GET /api/enrichment/:jobId/rows/:rowIndex`

Returns the full row detail plus its evidence sources (Serper organic results
and any LLM-cited URLs, grouped by `source_type`).

## `POST /api/enrichment/:jobId/start`

Kicks off the worker. Returns `409 ALREADY_RUNNING` if a worker is already
attached, or `409 JOB_TERMINAL` if the job has already completed (use
`/retry` instead).

### Body (all optional)

```json
{ "concurrency": 3, "maxSerpPerRow": 5, "model": "claude-sonnet-4-5" }
```

## `POST /api/enrichment/:jobId/cancel`

Sets `cancelRequested: true` on the job. The worker checks this flag between
rows and exits cleanly. Rows already enriched are preserved.

## `POST /api/enrichment/:jobId/retry`

Re-runs a subset of rows. Returns `409 ALREADY_RUNNING` if the worker is
active on this job.

### Body

```json
{ "scope": "failed" }
{ "scope": "flagged" }
{ "scope": "all" }
{ "scope": "rows", "rowIndexes": [3, 7, 12] }
```

The counters are rewound to exclude the retried rows so the final tallies stay
correct after the retry completes.

## `GET /api/enrichment/:jobId/export`

Downloads an enriched CSV. Content-Type is `text/csv; charset=utf-8`.

### Query params

- `scope` — `full` (default), `flagged`, or `failed`.

The full export always emits columns in canonical order (input columns first,
then review columns appended).

## Per-row pipeline

1. **Normalize + parse** `Title Override` (`parseTitleOverride`). Extracts a
   trailing `(...)` group as `parenthetical` (e.g. `Michelle Joy (Cannons)` →
   name=`Michelle Joy`, parenthetical=`Cannons`).
2. **Plan queries** (`planQueries`), bounded by `ENRICHMENT_MAX_SERP_PER_ROW`.
   The user's `query_override` (if non-empty) is prioritized first, followed
   by name + affiliation, official-site probe, and Instagram probe.
3. **Run SERP** — one Serper.dev call per query. Individual query failures do
   not fail the row; if *all* queries fail the row is marked `failed` with
   `error: SERP_FAILED`.
4. **Build evidence dossier** — knowledge-graph entries, top organic results
   (title/url/snippet, classified by `source_type`), and related searches.
5. **Call Claude** via `tool_choice: {type: "tool", name: "record_artist_enrichment"}`
   forcing structured output against a fixed JSON schema. On invalid output,
   the worker retries once with a repair nudge; a second failure marks the
   row `failed` with `error: LLM_BAD_OUTPUT`.
6. **Merge into row** (`mergeProposal`). Non-empty user fields are always
   preserved; the LLM's proposal is recorded in `enriched.audit` for later
   inspection. Official social URLs are only accepted if they pass
   `isProbablyOfficialUrl` (valid http(s), no `/search`, `/hashtag/`, etc.).
7. **Derive status** (`deriveEnrichmentStatus`): `valid_unique` /
   `valid_with_affiliation` map to `enriched` or `enriched_with_flags`; every
   other title-quality value maps to `needs_review`.
8. **Persist** — row + sources are written to disk via the enrichment store.
   Job counters (`completedRows`, `flaggedRows`, `failedRows`) are updated
   atomically.

## Prompt-injection defenses

- CSV cell values are wrapped in `<untrusted_csv_row>` blocks in the LLM
  prompt with an explicit instruction that the blocks are DATA, not
  instructions.
- SERP results are wrapped in `<untrusted_serp_evidence>` blocks with the
  same treatment. Snippets are trimmed to bound token cost and reduce
  injection surface.
- The model may only respond via the `record_artist_enrichment` tool call;
  free-form text is ignored. Rows where the model refuses to call the tool
  (or produces schema-invalid input) are marked `failed`.
- On export, all cells beginning with `= + - @ \t \r` are apostrophe-
  prefixed to neutralize spreadsheet formula injection.

## Ownership

There is no authentication in this repo. Job IDs are 128-bit random values,
served as the `?job=<id>` query param in the UI. Anyone with the ID can view
or download the results; anyone without it cannot enumerate jobs by ID.

## Startup reconciliation

`enrichmentStore.reconcileOnStartup()` runs on process boot and marks any job
that was `running` at shutdown as `failed` with an "Interrupted by server
restart" message. Users click **Retry failed** in the UI to resume such jobs
without re-uploading the CSV.

---

# Third-Party APIs and Tooling

## Google / YouTube Data API

- **Purpose**: YouTube video/channel search, metadata, playlists, comments, trending.
- **Used by**: `YouTubeClient`.

## Chartmetric

- **Purpose**: Enriched metadata for Spotify items (tracks/albums/artists/playlists).
- **Used by**: `/api/chartmetric/metadata`.

## EnsembleData

- **Purpose**: Profile discovery for TikTok and Instagram.
- **Used by**:
  - `/api/tiktok/profiles` (`/apis/tt/user/search`)
  - `/api/instagram/profiles` (`/apis/instagram/search`)
- **Auth**: `ENSEMBLE_DATA_API_KEY`.

## Apify

- **Purpose**: Instagram profile enrichment/scraping after discovery.
- **Used by**: `/api/instagram/profiles` via actor `apify/instagram-profile-scraper`.
- **Auth**: `APIFY_API_KEY`.

## Playwright

- **Purpose**: High-fidelity page rendering and screenshot capture.
- **Used by**: `/api/screenshot`.

## Cloudflare R2 (S3-compatible)

- **Purpose**: Optional screenshot storage and public URL generation.
- **Used by**:
  - `/api/screenshot` when `storage_provider=cloudflare`
  - `/api/tiktok/profiles` in screenshot-thumbnail mode (calls `/api/screenshot?meta=1&storage_provider=cloudflare`)

## Oxylabs Proxy

- **Purpose**: Route requests through a proxy to reduce blocking.
- **Used by**:
  - TikTok endpoints (metrics/ytdlp)
  - Instagram scraping endpoint
  - Screenshot endpoint
- **Configured via env**: `OXYLABS_PROXY_SERVER`, `OXYLABS_USERNAME`, `OXYLABS_PASSWORD`.

## yt-dlp / yt-dlp-wrap

- **Purpose**: Extract TikTok metadata via `yt-dlp`.
- **Used by**: `/api/tiktok/ytdlp`.

## Serper.dev

- **Purpose**: Google SERP results (organic, knowledge graph, related searches) used for artist-identity resolution.
- **Used by**: `/api/enrichment/*` via `src/serpClient.js`.
- **Auth**: `SERPER_API_KEY`.

## Anthropic Claude

- **Purpose**: Structured-output identity resolution for artist records; agentic Sheet writeback in the report augmentation tool.
- **Used by**: `/api/enrichment/*` (strict tool-use), `/api/sheets/ask` (tool-use loop).
- **Auth**: `ANTHROPIC_API_KEY`.
- **Default model**: `claude-sonnet-4-5`; override the enrichment model with `ENRICHMENT_LLM_MODEL`.
