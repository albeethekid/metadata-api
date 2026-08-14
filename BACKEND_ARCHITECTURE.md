# Vermillio — Backend Database Architecture

## Overview

This document proposes a PostgreSQL schema for persisting the data that the Vermillio platform currently fetches on-the-fly. The design has two parallel storage layers for every piece of platform data:

1. **Raw layer** — the verbatim JSON blob returned by each upstream API / scraper call, preserved forever for auditing, replay, and future field extraction.
2. **Normalized layer** — typed, queryable columns extracted from the raw response, matching the shape that `urlProcessor.normalizeResponse()` already produces plus all the richer per-platform fields the APIs return.

Platform-specific metadata lives in its own supplemental table (e.g. `platform_youtube_videos`) so the core content table stays clean while every API-native field is still available.

---

## Entity Map

```
content_items (one row per unique URL/platform)
  ├── raw_api_responses        (1:many — one per fetch attempt)
  ├── platform_youtube_videos  (1:1 supplement)
  ├── platform_tiktok_videos   (1:1 supplement)
  ├── platform_instagram_posts (1:1 supplement)
  └── platform_spotify_items   (1:1 supplement, covers track/album/artist/playlist/show/episode)

profiles (one row per unique handle/platform)
  ├── raw_api_responses        (shared table, discriminated by entity_type)
  ├── platform_youtube_channels   (1:1 supplement)
  ├── platform_tiktok_profiles    (1:1 supplement)
  ├── platform_instagram_profiles (1:1 supplement)
  └── platform_twitter_profiles   (1:1 supplement)

report_jobs (one per Google Sheets augmentation run)
  └── report_rows (one per sheet row processed in the job)

screenshots (one per /api/screenshot call)
```

---

## SQL Schema

### Shared enums

```sql
CREATE TYPE platform_type AS ENUM (
  'youtube', 'tiktok', 'instagram', 'twitter', 'spotify', 'screenshot', 'unknown'
);

CREATE TYPE spotify_item_type AS ENUM (
  'track', 'album', 'artist', 'playlist', 'show', 'episode'
);

CREATE TYPE fetch_status AS ENUM (
  'success', 'error', 'partial'
);

CREATE TYPE report_job_status AS ENUM (
  'pending', 'running', 'completed', 'failed'
);

CREATE TYPE report_row_status AS ENUM (
  'pending', 'running', 'fetched', 'written', 'error'
);
```

---

### Core: `content_items`

One row per unique content URL. This is the canonical normalized record — the same shape
`urlProcessor.normalizeResponse()` already produces, promoted to typed columns.

```sql
CREATE TABLE content_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform              platform_type NOT NULL,
  platform_id           TEXT NOT NULL,          -- videoId, shortcode, spotify track id, etc.
  url                   TEXT NOT NULL,
  canonical_url         TEXT,                   -- resolved/cleaned URL after redirect

  -- Core normalized fields (mirrors urlProcessor.emptyNormalized())
  title                 TEXT,
  description           TEXT,
  published_at          TIMESTAMPTZ,
  duration_iso          TEXT,
  duration_seconds      INTEGER,
  view_count            BIGINT,
  like_count            BIGINT,
  comment_count         BIGINT,
  share_count           BIGINT,
  engagement_like_rate  NUMERIC(10,6),
  engagement_comment_rate NUMERIC(10,6),
  hero_image_url        TEXT,
  channel_handle        TEXT,                   -- @handle of the author/channel
  channel_id            TEXT,                   -- platform-native channel/author ID

  -- Housekeeping
  first_fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  fetch_count           INTEGER NOT NULL DEFAULT 1,

  UNIQUE (platform, platform_id)
);

CREATE INDEX idx_content_items_platform    ON content_items (platform);
CREATE INDEX idx_content_items_channel     ON content_items (channel_handle);
CREATE INDEX idx_content_items_published   ON content_items (published_at);
CREATE INDEX idx_content_items_url         ON content_items (url);
```

---

### Raw responses: `raw_api_responses`

Every upstream API call is logged here. Linked to either a `content_item` or a `profile`
via nullable FKs + an `entity_type` discriminator. The `endpoint` column records exactly
which Vermillio route was called so failures are reproducible.

```sql
CREATE TABLE raw_api_responses (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type      TEXT NOT NULL CHECK (entity_type IN ('content_item', 'profile', 'screenshot', 'search')),
  content_item_id  UUID REFERENCES content_items (id) ON DELETE SET NULL,
  profile_id       UUID,                              -- FK added after profiles table is created
  platform         platform_type NOT NULL,
  endpoint         TEXT NOT NULL,                    -- e.g. '/api/tiktok/ytdlp', '/api/instagram/video/apify'
  input_url        TEXT,
  http_status      INTEGER,
  fetch_status     fetch_status NOT NULL,
  raw_response     JSONB NOT NULL,                   -- verbatim upstream JSON
  error_code       TEXT,
  error_message    TEXT,
  fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  latency_ms       INTEGER
);

CREATE INDEX idx_raw_responses_content_item ON raw_api_responses (content_item_id);
CREATE INDEX idx_raw_responses_profile      ON raw_api_responses (profile_id);
CREATE INDEX idx_raw_responses_platform     ON raw_api_responses (platform, fetched_at DESC);
CREATE INDEX idx_raw_responses_status       ON raw_api_responses (fetch_status);
-- Partial GIN index for fast JSONB field inspection
CREATE INDEX idx_raw_responses_json         ON raw_api_responses USING GIN (raw_response jsonb_path_ops);
```

---

### Platform supplement: `platform_youtube_videos`

Stores every typed field from the YouTube Data API `videos.list` response
(parts: `snippet`, `contentDetails`, `statistics`).

```sql
CREATE TABLE platform_youtube_videos (
  content_item_id        UUID PRIMARY KEY REFERENCES content_items (id) ON DELETE CASCADE,
  youtube_video_id       TEXT NOT NULL UNIQUE,

  -- snippet
  channel_id             TEXT,
  channel_title          TEXT,
  category_id            TEXT,
  tags                   TEXT[],
  live_broadcast_content TEXT,                      -- 'live' | 'none' | 'upcoming'
  default_language       TEXT,
  default_audio_language TEXT,
  localized_title        TEXT,
  localized_description  TEXT,

  -- contentDetails
  duration_iso           TEXT,
  dimension              TEXT,                      -- '2d' | '3d'
  definition             TEXT,                      -- 'hd' | 'sd'
  caption                BOOLEAN,
  licensed_content       BOOLEAN,
  projection             TEXT,                      -- 'rectangular' | '360'

  -- statistics
  view_count             BIGINT,
  like_count             BIGINT,
  dislike_count          BIGINT,
  favorite_count         BIGINT,
  comment_count          BIGINT,

  -- computed / enriched
  uploads_playlist_id    TEXT,                      -- from discover-siblings calls
  sibling_score          INTEGER,                   -- scoring result from /discover-siblings
  sibling_score_reasons  TEXT[],

  synced_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

### Platform supplement: `platform_tiktok_videos`

Fields from the yt-dlp JSON envelope and from the `tiktokMetrics` HTML scraper.

```sql
CREATE TABLE platform_tiktok_videos (
  content_item_id     UUID PRIMARY KEY REFERENCES content_items (id) ON DELETE CASCADE,
  tiktok_video_id     TEXT NOT NULL UNIQUE,
  author_handle       TEXT,
  author_id           TEXT,
  author_name         TEXT,
  author_avatar_url   TEXT,

  -- metrics (from yt-dlp or scraper)
  view_count          BIGINT,
  like_count          BIGINT,
  comment_count       BIGINT,
  share_count         BIGINT,
  repost_count        BIGINT,
  download_count      BIGINT,
  collect_count       BIGINT,               -- "saved" count

  -- content metadata
  description         TEXT,
  hashtags            TEXT[],
  mentions            TEXT[],
  music_title         TEXT,
  music_author        TEXT,
  music_id            TEXT,
  duration_seconds    INTEGER,
  width               INTEGER,
  height              INTEGER,
  fps                 NUMERIC(6,3),
  bitrate             BIGINT,
  format_id           TEXT,

  source              TEXT NOT NULL DEFAULT 'ytdlp' CHECK (source IN ('ytdlp', 'scraper')),
  synced_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

### Platform supplement: `platform_instagram_posts`

Fields from Apify `instagram-scraper` actor (the primary enrichment path)
and from the Playwright scraper fallback.

```sql
CREATE TABLE platform_instagram_posts (
  content_item_id       UUID PRIMARY KEY REFERENCES content_items (id) ON DELETE CASCADE,
  shortcode             TEXT NOT NULL UNIQUE,
  post_type             TEXT,                       -- 'post' | 'reel' | 'tv'

  -- author
  author_handle         TEXT,
  author_id             TEXT,
  author_full_name      TEXT,
  author_avatar_url     TEXT,

  -- metrics
  view_count            BIGINT,
  like_count            BIGINT,
  comment_count         BIGINT,
  share_count           BIGINT,

  -- content metadata (apify fields)
  caption               TEXT,
  hashtags              TEXT[],
  mentions              TEXT[],
  tagged_users          JSONB,                      -- array of {id, username, full_name}
  latest_comments       JSONB,                      -- array of recent comment objects
  video_url             TEXT,
  display_url           TEXT,
  images                JSONB,                      -- sidecar images array
  video_duration        NUMERIC(10,3),
  dimensions_height     INTEGER,
  dimensions_width      INTEGER,
  product_type          TEXT,                       -- 'clips' | 'feed' | 'igtv'

  -- music
  music_title           TEXT,
  music_artist          TEXT,
  music_id              TEXT,

  -- co-authoring
  coauthor_producers    JSONB,

  source                TEXT NOT NULL DEFAULT 'apify' CHECK (source IN ('apify', 'scraper')),
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

### Platform supplement: `platform_spotify_items`

Covers all Spotify entity types (track / album / artist / playlist / show / episode).
Source is either the Spotify Web API (via `src/spotify.js`) or Chartmetric enrichment
(via `src/chartmetric.js`).

```sql
CREATE TABLE platform_spotify_items (
  content_item_id       UUID PRIMARY KEY REFERENCES content_items (id) ON DELETE CASCADE,
  spotify_id            TEXT NOT NULL UNIQUE,
  item_type             spotify_item_type NOT NULL,

  -- common
  name                  TEXT,
  external_url          TEXT,
  image_url             TEXT,
  popularity            INTEGER,                    -- 0–100 Spotify popularity score
  markets               TEXT[],                     -- available_markets (tracks/albums)

  -- track-specific
  album_id              TEXT,
  album_name            TEXT,
  album_type            TEXT,                       -- 'album' | 'single' | 'compilation'
  disc_number           INTEGER,
  track_number          INTEGER,
  duration_ms           INTEGER,
  explicit              BOOLEAN,
  isrc                  TEXT,
  preview_url           TEXT,
  artist_ids            TEXT[],
  artist_names          TEXT[],

  -- album-specific
  label                 TEXT,
  release_date          DATE,
  release_date_precision TEXT,                      -- 'year' | 'month' | 'day'
  total_tracks          INTEGER,
  upc                   TEXT,
  copyrights            JSONB,

  -- artist-specific
  genres                TEXT[],
  followers_count       INTEGER,

  -- playlist-specific
  owner_id              TEXT,
  owner_display_name    TEXT,
  playlist_description  TEXT,
  snapshot_id           TEXT,
  tracks_total          INTEGER,
  playlist_public       BOOLEAN,

  -- show/episode-specific (podcast)
  publisher             TEXT,
  show_languages        TEXT[],
  episode_duration_ms   INTEGER,
  episode_explicit      BOOLEAN,

  -- Chartmetric enrichment fields
  chartmetric_id        TEXT,
  cm_artist_rank        INTEGER,
  cm_spotify_streams    BIGINT,
  cm_spotify_listeners  INTEGER,
  cm_track_rank         INTEGER,
  cm_data               JSONB,                      -- full Chartmetric payload

  source                TEXT NOT NULL DEFAULT 'spotify' CHECK (source IN ('spotify', 'chartmetric')),
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

### Profiles/channels

One row per unique creator account, shared across all profile-discovery endpoints
(`/api/search/channels`, `/api/tiktok/profiles`, `/api/instagram/profiles`, `/api/twitter/profiles`).

```sql
CREATE TABLE profiles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform          platform_type NOT NULL,
  platform_id       TEXT,                           -- platform-native user/channel ID
  handle            TEXT NOT NULL,                  -- @handle (without @)
  url               TEXT NOT NULL,

  -- normalized (mirrors channel search response shape)
  display_name      TEXT,
  description       TEXT,
  thumbnail_url     TEXT,                           -- avatar or screenshot URL
  subscriber_count  BIGINT,
  video_count       INTEGER,
  is_verified       BOOLEAN,

  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (platform, handle)
);

CREATE INDEX idx_profiles_platform ON profiles (platform);
CREATE INDEX idx_profiles_handle   ON profiles (handle);

-- Wire up the FK deferred above
ALTER TABLE raw_api_responses
  ADD CONSTRAINT fk_raw_responses_profile
  FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE SET NULL;
```

#### Profile supplements

```sql
CREATE TABLE platform_youtube_channels (
  profile_id             UUID PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,
  youtube_channel_id     TEXT NOT NULL UNIQUE,
  uploads_playlist_id    TEXT,
  custom_url             TEXT,
  country                TEXT,
  default_language       TEXT,
  subscriber_count       BIGINT,
  video_count            INTEGER,
  view_count             BIGINT,
  hidden_subscriber_count BOOLEAN,
  topic_categories       TEXT[],
  keywords               TEXT,
  synced_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE platform_tiktok_profiles (
  profile_id             UUID PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,
  tiktok_user_id         TEXT UNIQUE,
  nickname               TEXT,
  bio                    TEXT,
  follower_count         BIGINT,
  following_count        BIGINT,
  heart_count            BIGINT,                    -- total likes received
  video_count            INTEGER,
  digg_count             BIGINT,
  verified               BOOLEAN,
  private_account        BOOLEAN,
  avatar_url             TEXT,
  -- EnsembleData discovery fields
  ensemble_cursor        BIGINT,
  source                 TEXT DEFAULT 'ensemble',
  synced_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE platform_instagram_profiles (
  profile_id             UUID PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,
  instagram_user_id      TEXT UNIQUE,
  full_name              TEXT,
  biography              TEXT,
  follower_count         BIGINT,
  following_count        BIGINT,
  media_count            INTEGER,
  is_business            BOOLEAN,
  business_category      TEXT,
  external_url           TEXT,
  profile_pic_url        TEXT,
  highlight_reel_count   INTEGER,
  -- Apify enrichment
  apify_dataset_id       TEXT,
  source                 TEXT DEFAULT 'apify',
  synced_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE platform_twitter_profiles (
  profile_id             UUID PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,
  twitter_user_id        TEXT UNIQUE,
  name                   TEXT,
  bio                    TEXT,
  location               TEXT,
  follower_count         BIGINT,
  following_count        BIGINT,
  tweet_count            INTEGER,
  listed_count           INTEGER,
  verified               BOOLEAN,
  protected_account      BOOLEAN,
  profile_image_url      TEXT,
  banner_url             TEXT,
  created_at             TIMESTAMPTZ,
  -- Apify discovery fields
  apify_dataset_id       TEXT,
  synced_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

### Screenshots

Persists every `/api/screenshot` call and its Cloudflare R2 result.

```sql
CREATE TABLE screenshots (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  input_url        TEXT NOT NULL,
  s3_url           TEXT,                            -- Cloudflare R2 public URL
  storage_key      TEXT,                            -- R2 object key
  format           TEXT NOT NULL DEFAULT 'jpeg',
  full_page        BOOLEAN NOT NULL DEFAULT false,
  width_px         INTEGER,
  height_px        INTEGER,
  file_size_bytes  INTEGER,
  -- pageSignals extracted during capture
  page_title       TEXT,
  page_links       JSONB,                           -- array of {href, text}
  page_signals     JSONB,                           -- full pageSignals blob
  -- proxy / session
  proxy_used       BOOLEAN,
  playwright_profile TEXT,
  -- relation to content (optional — set when screenshot is a content thumbnail)
  content_item_id  UUID REFERENCES content_items (id) ON DELETE SET NULL,
  profile_id       UUID REFERENCES profiles (id) ON DELETE SET NULL,
  captured_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  http_status      INTEGER,
  error_code       TEXT
);

CREATE INDEX idx_screenshots_url        ON screenshots (input_url);
CREATE INDEX idx_screenshots_content    ON screenshots (content_item_id);
CREATE INDEX idx_screenshots_captured   ON screenshots (captured_at DESC);
```

---

### Report augmentation jobs

Mirrors the Google Sheets workflow in `src/sheetsService.js` and `src/index.js`.

```sql
CREATE TABLE report_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spreadsheet_id    TEXT NOT NULL,
  sheet_url         TEXT NOT NULL,
  tab_name          TEXT NOT NULL DEFAULT 'report',
  status            report_job_status NOT NULL DEFAULT 'pending',
  total_rows        INTEGER,
  fetched_rows      INTEGER NOT NULL DEFAULT 0,
  written_rows      INTEGER NOT NULL DEFAULT 0,
  error_rows        INTEGER NOT NULL DEFAULT 0,
  llm_prompt        TEXT,                           -- if Ask-the-LLM was used
  llm_model         TEXT,                           -- e.g. 'claude-sonnet-4-5'
  llm_turns         INTEGER,
  llm_cells_written INTEGER,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE report_rows (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           UUID NOT NULL REFERENCES report_jobs (id) ON DELETE CASCADE,
  sheet_row_index  INTEGER NOT NULL,               -- 1-based row number in the Sheet
  page_url         TEXT NOT NULL,
  platform         platform_type,
  status           report_row_status NOT NULL DEFAULT 'pending',

  -- link to the canonical content record (set after successful fetch)
  content_item_id  UUID REFERENCES content_items (id) ON DELETE SET NULL,

  -- snapshot of what was written back to the sheet (mirrors COLUMN_MAP)
  written_title          TEXT,
  written_content_url    TEXT,
  written_likeness_match TEXT,
  written_likeness_label TEXT,
  written_likeness_score TEXT,
  written_recommendation TEXT,

  -- LLM writeback (arbitrary header→value pairs from writeCellsByHeader)
  llm_edits        JSONB,                          -- [{header, value, rowIndex}, ...]

  error_code       TEXT,
  error_message    TEXT,
  fetched_at       TIMESTAMPTZ,
  written_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_report_rows_job    ON report_rows (job_id);
CREATE INDEX idx_report_rows_url    ON report_rows (page_url);
CREATE INDEX idx_report_rows_item   ON report_rows (content_item_id);
```

---

### Search results cache (optional but recommended)

Caches `/api/search`, `/api/search/channels`, and profile-discovery results to avoid
redundant upstream calls.

```sql
CREATE TABLE search_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform        platform_type NOT NULL,
  query           TEXT NOT NULL,
  endpoint        TEXT NOT NULL,                   -- '/api/search/channels', '/api/tiktok/profiles', etc.
  max_results     INTEGER,
  cursor          BIGINT,
  result_count    INTEGER,
  raw_response    JSONB NOT NULL,
  searched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- TTL helper: callers can skip re-fetching if searched_at is recent
  expires_at      TIMESTAMPTZ GENERATED ALWAYS AS (searched_at + interval '24 hours') STORED
);

CREATE INDEX idx_search_results_query    ON search_results (platform, query, searched_at DESC);
CREATE INDEX idx_search_results_expires  ON search_results (expires_at);
```

---

## Write Path Summary

| Trigger | Tables written |
|---|---|
| `POST /api/sheets/fetch-row` succeeds | `content_items` upsert → platform supplement insert/update → `raw_api_responses` insert → `report_rows` update |
| `POST /api/sheets/write-rows` | `report_rows` update (written_* cols) → `report_jobs` counters |
| `GET /api/screenshot` with `storage_provider=cloudflare` | `screenshots` insert |
| `GET /api/search/channels` / profile search | `search_results` insert → `profiles` upsert → platform profile supplement upsert |
| `GET /api/youtube/discover-siblings` | `raw_api_responses` insert → `platform_youtube_videos.sibling_score` update for matches |

---

## Upsert Strategy

All platform data is upserted on `(platform, platform_id)` so repeated fetches of the same
content update existing records rather than creating duplicates. `raw_api_responses` always
gets a new row on every call — it is the append-only audit log.

```sql
-- Example: upsert a content item after a YouTube fetch
INSERT INTO content_items (platform, platform_id, url, title, view_count, ...)
VALUES ('youtube', $1, $2, $3, $4, ...)
ON CONFLICT (platform, platform_id)
DO UPDATE SET
  title          = EXCLUDED.title,
  view_count     = EXCLUDED.view_count,
  last_fetched_at = now(),
  fetch_count    = content_items.fetch_count + 1;
```

---

## Indexing Notes

- All `platform_id` / `shortcode` / `spotify_id` unique constraints double as primary lookup indexes.
- `raw_api_responses.raw_response` carries a partial GIN index for ad-hoc JSONB queries during debugging; drop it if write throughput becomes a concern.
- `report_rows` is joined heavily by `job_id` and `page_url`; both are indexed.
- `screenshots.captured_at DESC` supports the common "show recent screenshots" query pattern.

---

## Migration Notes

1. Run the shared enum DDL first — all other tables depend on them.
2. `profiles` must be created before `raw_api_responses` FK is wired (the `ALTER TABLE` at the end of the profiles block handles this).
3. Platform supplement tables can be added incrementally — the core `content_items` / `profiles` / `raw_api_responses` triad is self-sufficient for an MVP.
4. The `search_results.expires_at` generated column requires PostgreSQL 12+.
5. `gen_random_uuid()` requires PostgreSQL 13+ (or the `pgcrypto` extension on older versions).
