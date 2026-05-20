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
  return parts.length >= 2 && (parts[0] === 'p' || parts[0] === 'reel' || parts[0] === 'tv');
}

function extractInstagramShortcode(parsedUrl) {
  const parts = parsedUrl.pathname.split('/').filter(Boolean);
  if (parts.length >= 2 && (parts[0] === 'p' || parts[0] === 'reel' || parts[0] === 'tv') && parts[1]) {
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
  // Unknown platform
  if (includeScreenshots) return { platform: 'screenshot', id: '', url: trimmed };
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
    links: ''
  };
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
    return out;
  }

  if (platform === 'screenshot') {
    const links = item.pageSignals?.links || [];
    out.title        = item.title ?? '';
    out.heroImageUrl = item.s3_url ?? '';
    out.links        = links.map(l => l && l.href).filter(Boolean).join(', ');
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

  let data;
  try {
    data = await fetchForEntry(entry, baseUrl);
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
  SELF_BASE_URL
};
