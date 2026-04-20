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

---

## `GET /api/channel/:channelId`

Fetch YouTube channel details.

### Path params

- `channelId` (required)

---

## `GET /api/channel/:channelId/videos`

Fetch recent videos for a YouTube channel.

### Path params

- `channelId` (required)

### Query params

- `maxResults` (optional, default `10`)

---

## `GET /api/video/:videoId/comments`

Fetch comments for a YouTube video.

### Path params

- `videoId` (required)

### Query params

- `maxResults` (optional, default `20`)

---

## `GET /api/trending`

Fetch trending YouTube videos.

### Query params

- `regionCode` (optional, default `US`)
- `maxResults` (optional, default `10`)

---

## `GET /api/playlist/:playlistId`

Fetch playlist items.

### Path params

- `playlistId` (required)

### Query params

- `maxResults` (optional, default `50`)

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

---

# Root

## `GET /`

Returns a JSON object describing the server and some example routes.

---

# UI Pages (Frontend)

This repo serves a couple of static HTML pages from `public/` that call the API routes listed above.

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

# Third-Party APIs and Tooling

## Google / YouTube Data API

- **Purpose**: YouTube video/channel search, metadata, playlists, comments, trending.
- **Used by**: `YouTubeClient`.

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
