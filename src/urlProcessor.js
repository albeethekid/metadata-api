// Server-side mirror of the per-platform dispatch + normalization that
// lives client-side in public/csv.html. The Google Sheets workflow uses
// this helper to call exactly the same backend endpoints the CSV
// Generator UI calls, and to produce the same normalized response shape.
//
// Important: this module does NOT duplicate platform business logic. It
// reuses the existing HTTP endpoints (`/api/video/:id`, `/api/tiktok/ytdlp`,
// `/api/instagram/video/apify`, `/api/{spotify,chartmetric}/metadata`,
// `/api/screenshot`) by self-calling them over localhost.

const fetch = require('node-fetch');

const SELF_BASE_URL =
  process.env.SELF_BASE_URL ||
  `http://127.0.0.1:${process.env.PORT || 8080}`;

// ---------- URL classification (ported from csv.html) ----------

function detectPlatform(parsedUrl) {
  const host = parsedUrl.hostname.replace(/^www\./, '').toLowerCase();
  if (host === 'youtu.be' || host.endsWith('youtube.com')) return 'youtube';
  if (host.endsWith('tiktok.com'))    return 'tiktok';
  if (host.endsWith('instagram.com')) return 'instagram';
  if (host.endsWith('spotify.com'))   return 'spotify';
  return 'screenshot';
}

function extractYouTubeId(parsedUrl) {
  const host = parsedUrl.hostname.replace(/^www\./, '').toLowerCase();
  if (host === 'youtu.be') {
    const id = parsedUrl.pathname.split('/').filter(Boolean)[0];
    return id || null;
  }
  if (host.endsWith('youtube.com')) {
    if (parsedUrl.pathname === '/watch') return parsedUrl.searchParams.get('v') || null;
    const parts = parsedUrl.pathname.split('/').filter(Boolean);
    if (parts[0] === 'shorts' && parts[1]) return parts[1];
  }
  return null;
}

function extractTikTokInfo(parsedUrl) {
  const parts = parsedUrl.pathname.split('/').filter(Boolean);
  if (parts.length >= 3 && parts[1] === 'video' && /^\d+$/.test(parts[2]) && parts[0].startsWith('@')) {
    return { videoId: parts[2], channelHandle: parts[0] };
  }
  return null;
}

function isSupportedInstagramPath(parsedUrl) {
  const parts = parsedUrl.pathname.split('/').filter(Boolean);
  return parts.length >= 2 && (parts[0] === 'p' || parts[0] === 'reel' || parts[0] === 'reels' || parts[0] === 'tv');
}

function extractInstagramShortcode(parsedUrl) {
  const parts = parsedUrl.pathname.split('/').filter(Boolean);
  if (parts.length >= 2 && (parts[0] === 'p' || parts[0] === 'reel' || parts[0] === 'reels' || parts[0] === 'tv') && parts[1]) {
    return parts[1];
  }
  return null;
}

function extractSpotifyInfo(parsedUrl) {
  const m = parsedUrl.pathname.match(/\/(track|album|artist|playlist|show|episode)\/([a-zA-Z0-9]+)/);
  if (!m) return null;
  const type = m[1];
  const id = m[2];
  const useChartmetric = ['track', 'album', 'artist', 'playlist'].includes(type);
  return { type, id, useChartmetric };
}

// Platforms with no dedicated API integration fall back to the screenshot
// endpoint, but their handle can still be parsed for free straight out of
// the URL path — no network call needed.
const SOUNDCLOUD_RESERVED_PATHS = new Set([
  'you', 'stream', 'discover', 'charts', 'search', 'tags', 'people',
  'upload', 'pro', 'notifications', 'messages', 'settings', 'jobs',
  'legal', 'imprint', 'pages', 'terms-of-use', 'connect', 'signin', 'logout'
]);
const X_RESERVED_PATHS = new Set([
  'i', 'home', 'explore', 'notifications', 'messages', 'settings',
  'search', 'compose', 'account', 'tos', 'privacy'
]);
const FACEBOOK_NON_HANDLE_PATHS = new Set([
  'watch', 'profile.php', 'permalink.php', 'groups', 'pages', 'photo.php',
  'story.php', 'plugins', 'dialog', 'login', 'help', 'policies', 'ads',
  'business', 'marketplace', 'gaming', 'reel', 'share', 'events', 'l.php', 'media'
]);

function hostIs(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

// Like extractSocialHandle, but also names which of the 4 platforms matched.
// This is the canonical (platform, handle) pair for these hosts — reused
// both for classifyUrl's screenshot-fallback entries and for matching
// against the source-authorization reference sheet.
function extractSocialHandleWithPlatform(parsedUrl) {
  const host = parsedUrl.hostname.toLowerCase();
  const parts = parsedUrl.pathname.split('/').filter(Boolean);
  if (!parts.length) return null;
  const first = parts[0];

  if (hostIs(host, 'soundcloud.com')) {
    if (SOUNDCLOUD_RESERVED_PATHS.has(first.toLowerCase())) return null;
    return { platform: 'soundcloud', handle: first };
  }
  if (hostIs(host, 'x.com') || hostIs(host, 'twitter.com')) {
    if (X_RESERVED_PATHS.has(first.toLowerCase())) return null;
    return { platform: 'x', handle: first };
  }
  if (hostIs(host, 'facebook.com')) {
    if (FACEBOOK_NON_HANDLE_PATHS.has(first.toLowerCase()) || /^\d+$/.test(first)) return null;
    return { platform: 'facebook', handle: first };
  }
  if (hostIs(host, 'threads.com') || hostIs(host, 'threads.net')) {
    return first.startsWith('@') ? { platform: 'threads', handle: first } : null;
  }
  return null;
}

function extractSocialHandle(parsedUrl) {
  const result = extractSocialHandleWithPlatform(parsedUrl);
  return result ? result.handle : null;
}

// Canonical (platform, handle) pair derived purely from a URL's shape — no
// network call. Covers tiktok plus the 4 screenshot-fallback platforms
// (soundcloud, x/twitter, facebook, threads). Returns null for platforms
// whose handle can't be read off the URL alone (instagram, youtube).
function deriveHandleFromUrl(rawUrl) {
  let parsedUrl;
  try { parsedUrl = new URL(String(rawUrl).trim()); } catch (_) { return null; }

  if (detectPlatform(parsedUrl) === 'tiktok') {
    const info = extractTikTokInfo(parsedUrl);
    if (info) return { platform: 'tiktok', handle: info.channelHandle.replace(/^@/, '') };
    return null;
  }
  return extractSocialHandleWithPlatform(parsedUrl);
}

/**
 * Classify a raw URL into a fetchable entry, or return null if unparseable.
 * Mirrors the parseLinesToIds() logic in csv.html.
 *
 * @param {string} rawUrl
 * @param {boolean} includeScreenshots  if true (default), unsupported URLs
 *   fall back to the screenshot endpoint — same default as CSV Generator.
 * @returns {?{platform:string,id:string,url:string,channelHandle?:string,spotifyType?:string,useChartmetric?:boolean}}
 */
function classifyUrl(rawUrl, includeScreenshots = true) {
  if (!rawUrl) return null;
  const trimmed = String(rawUrl).trim();
  if (!trimmed) return null;

  let parsedUrl;
  try { parsedUrl = new URL(trimmed); } catch (_) { return null; }

  const platform = detectPlatform(parsedUrl);

  if (platform === 'youtube') {
    const id = extractYouTubeId(parsedUrl);
    if (id) return { platform, id, url: trimmed };
    if (includeScreenshots) return { platform: 'screenshot', id: '', url: trimmed };
    return null;
  }
  if (platform === 'tiktok') {
    const info = extractTikTokInfo(parsedUrl);
    if (info) return { platform, id: info.videoId, url: trimmed, channelHandle: info.channelHandle };
    if (includeScreenshots) return { platform: 'screenshot', id: '', url: trimmed };
    return null;
  }
  if (platform === 'instagram') {
    if (isSupportedInstagramPath(parsedUrl)) {
      return { platform, id: extractInstagramShortcode(parsedUrl) || '', url: trimmed };
    }
    if (includeScreenshots) return { platform: 'screenshot', id: '', url: trimmed };
    return null;
  }
  if (platform === 'spotify') {
    const info = extractSpotifyInfo(parsedUrl);
    if (info) return { platform, id: info.id, url: trimmed, spotifyType: info.type, useChartmetric: info.useChartmetric };
    if (includeScreenshots) return { platform: 'screenshot', id: '', url: trimmed };
    return null;
  }
  // Unknown platform. Handle extraction needs no network call, so it's
  // available regardless of includeScreenshots — only the title/image
  // screenshot fetch is gated by that flag.
  const channelHandle = extractSocialHandle(parsedUrl);
  if (includeScreenshots) {
    return channelHandle
      ? { platform: 'screenshot', id: '', url: trimmed, channelHandle }
      : { platform: 'screenshot', id: '', url: trimmed };
  }
  if (channelHandle) {
    return { platform: 'handle-only', id: '', url: trimmed, channelHandle };
  }
  return null;
}

// ---------- HTTP self-call to the platform endpoints ----------

async function fetchForEntry(entry, baseUrl) {
  const enc = encodeURIComponent;
  let url;
  if (entry.platform === 'youtube') {
    url = `${baseUrl}/api/video/${enc(entry.id)}`;
  } else if (entry.platform === 'tiktok') {
    url = `${baseUrl}/api/tiktok/ytdlp?url=${enc(entry.url)}`;
  } else if (entry.platform === 'instagram') {
    url = `${baseUrl}/api/instagram/video/apify?url=${enc(entry.url)}`;
  } else if (entry.platform === 'spotify') {
    const endpoint = entry.useChartmetric ? 'chartmetric' : 'spotify';
    url = `${baseUrl}/api/${endpoint}/metadata?url=${enc(entry.url)}`;
  } else if (entry.platform === 'screenshot') {
    url = `${baseUrl}/api/screenshot?url=${enc(entry.url)}&meta=1&storage_provider=cloudflare`;
  } else {
    throw new Error(`Unsupported platform: ${entry.platform}`);
  }
  const res = await fetch(url);
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch (_) { body = { error: 'NON_JSON_RESPONSE', raw: text.slice(0, 200) }; }
  if (!res.ok) {
    const msg = (body && (body.error || body.message)) || `HTTP ${res.status}`;
    const err = new Error(`upstream ${entry.platform} ${res.status}: ${msg}`);
    err.upstreamStatus = res.status;
    err.upstreamBody = body;
    throw err;
  }
  return body;
}

// TikTok's primary fetch (yt-dlp) carries no tagged-music data, so this
// self-calls the dedicated tagged-music endpoint separately. Never throws —
// a tagged-music lookup failure must not fail the row's primary metadata.
async function fetchTikTokTaggedMusic(entry, baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/api/tiktok/tagged-music?url=${encodeURIComponent(entry.url)}`);
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    return (body && body.tagged_music) || null;
  } catch (_) {
    return null;
  }
}

// ---------- Normalization (ported from csv.html mapToCsvRows) ----------

function normalizeDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch (_) {
    return '';
  }
}

function emptyNormalized() {
  return {
    title: '',
    publishedAt: '',
    durationIso: '',
    durationSeconds: '',
    viewCount: '',
    likeCount: '',
    commentCount: '',
    engagement_likeRate: '',
    engagement_commentRate: '',
    heroImageUrl: '',
    channelHandle: '',
    links: '',
    taggedMusic: '',
    clientCategoryOverride: ''
  };
}

// Formats a tagged_music object ({ artist, song_title, ... }) as "Artist -
// Song Title". Falls back to whichever single field is present.
function formatTaggedMusic(tm) {
  if (!tm) return '';
  const artist = (tm.artist || '').toString().trim();
  const title = (tm.song_title || '').toString().trim();
  if (artist && title) return `${artist} - ${title}`;
  return artist || title || '';
}

function normalizeResponse(entry, item) {
  const out = emptyNormalized();
  if (!item || item.error) return out;
  const platform = entry.platform;

  if (platform === 'tiktok') {
    const views    = item.metrics?.views;
    const likes    = item.metrics?.likes;
    const comments = item.metrics?.comments;
    out.title          = item.description ?? '';
    out.publishedAt    = normalizeDate(item.publishedAt);
    out.viewCount      = views ?? '';
    out.likeCount      = likes ?? '';
    out.commentCount   = comments ?? '';
    out.heroImageUrl   = item.heroImageUrl ?? '';
    out.channelHandle  = entry.channelHandle ?? '';
    out.taggedMusic    = formatTaggedMusic(item.taggedMusic);
    return out;
  }

  if (platform === 'instagram') {
    const views    = item.metrics?.views;
    const likes    = item.metrics?.likes;
    const comments = item.metrics?.comments;
    out.title         = item.description ?? '';
    out.publishedAt   = normalizeDate(item.publishedAt);
    out.viewCount     = views ?? '';
    out.likeCount     = likes ?? '';
    out.commentCount  = comments ?? '';
    out.heroImageUrl  = item.heroImageUrl ?? '';
    out.channelHandle = item.authorHandle ?? '';
    out.taggedMusic   = formatTaggedMusic(item.taggedMusic);
    return out;
  }

  if (platform === 'screenshot') {
    const links = item.pageSignals?.links || [];
    out.title         = item.title ?? '';
    out.heroImageUrl  = item.s3_url ?? '';
    out.links         = links.map(l => l && l.href).filter(Boolean).join(', ');
    out.channelHandle = entry.channelHandle ?? '';
    return out;
  }

  if (platform === 'handle-only') {
    out.channelHandle = entry.channelHandle ?? '';
    return out;
  }

  // YouTube + Spotify: already normalized server-side
  const engagement = item.engagement || {};
  out.title                    = item.title ?? '';
  out.publishedAt              = normalizeDate(item.publishedAt);
  out.durationIso              = item.durationIso ?? '';
  out.durationSeconds          = item.durationSeconds ?? '';
  out.viewCount                = item.viewCount ?? '';
  out.likeCount                = item.likeCount ?? '';
  out.commentCount             = item.commentCount ?? '';
  out.engagement_likeRate      = item.engagement_likeRate ?? engagement.likeRate ?? '';
  out.engagement_commentRate   = item.engagement_commentRate ?? engagement.commentRate ?? '';
  out.heroImageUrl             = item.heroImageUrl ?? '';
  out.channelHandle            = item.channelHandle ?? '';
  return out;
}

/**
 * Process a single URL exactly the way CSV Generator does, and return a
 * normalized object with the same keys CSV Generator uses.
 *
 * Never throws — always resolves with `{ ok, normalized, platform, error?, message? }`
 * so callers can write per-row outcomes without aborting a batch.
 *
 * @param {string} rawUrl
 * @param {{ baseUrl?: string, includeScreenshots?: boolean }} [opts]
 */
async function processUrl(rawUrl, opts = {}) {
  const baseUrl = opts.baseUrl || SELF_BASE_URL;
  const includeScreenshots = opts.includeScreenshots !== false;

  const entry = classifyUrl(rawUrl, includeScreenshots);
  if (!entry) {
    return {
      ok: false,
      platform: null,
      normalized: emptyNormalized(),
      error: 'UNSUPPORTED_URL',
      message: `Unsupported URL (no supported platform matched): ${rawUrl}`
    };
  }

  // Handle was parsed straight out of the URL — no fetch needed at all.
  if (entry.platform === 'handle-only') {
    return { ok: true, platform: entry.platform, normalized: normalizeResponse(entry, {}) };
  }

  let data;
  try {
    const [primary, taggedMusic] = await Promise.all([
      fetchForEntry(entry, baseUrl),
      entry.platform === 'tiktok' ? fetchTikTokTaggedMusic(entry, baseUrl) : Promise.resolve(null)
    ]);
    data = primary;
    if (entry.platform === 'tiktok' && data && !data.error) {
      data.taggedMusic = taggedMusic;
    }
  } catch (e) {
    return {
      ok: false,
      platform: entry.platform,
      normalized: emptyNormalized(),
      error: 'FETCH_FAILED',
      message: (e && e.message) || String(e)
    };
  }

  if (!data || data.error) {
    return {
      ok: false,
      platform: entry.platform,
      normalized: emptyNormalized(),
      error: 'UPSTREAM_ERROR',
      message: (data && (data.error || data.message)) || 'Empty response'
    };
  }

  const normalized = normalizeResponse(entry, data);
  return { ok: true, platform: entry.platform, normalized };
}

module.exports = {
  processUrl,
  classifyUrl,
  normalizeResponse,
  emptyNormalized,
  formatTaggedMusic,
  deriveHandleFromUrl,
  SELF_BASE_URL
};
