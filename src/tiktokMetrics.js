const fetch = require('node-fetch');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const ACCEPT_LANGUAGE = 'en-US,en;q=0.9';

class TikTokMetricsError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

async function getTikTokVideoMetrics(encodedUrl, verbose = false) {
  const { decodedUrl, videoId } = normalizeUrl(encodedUrl);
  const html = await fetchTikTokHtml(decodedUrl);
  const embeddedJson = extractEmbeddedJson(html);
  const video = resolveVideoObject(embeddedJson, videoId);

  return formatResponse(decodedUrl, videoId, video, verbose);
}

function normalizeUrl(encodedUrl) {
  let decodedUrl;
  try {
    decodedUrl = decodeURIComponent(encodedUrl);
  } catch (error) {
    throw new TikTokMetricsError(400, 'INVALID_URL');
  }

  let parsed;
  try {
    parsed = new URL(decodedUrl);
  } catch (error) {
    throw new TikTokMetricsError(400, 'INVALID_URL');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname.endsWith('tiktok.com')) {
    throw new TikTokMetricsError(400, 'INVALID_URL');
  }

  if (!/\/video\//.test(parsed.pathname)) {
    throw new TikTokMetricsError(400, 'INVALID_URL');
  }

  const videoId = extractVideoId(parsed.pathname);

  return { decodedUrl: parsed.toString(), videoId };
}

async function fetchTikTokHtml(url) {
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': ACCEPT_LANGUAGE
      }
    });
  } catch (error) {
    throw new TikTokMetricsError(502, 'PAGE_FETCH_FAILED');
  }

  if (!response.ok) {
    throw new TikTokMetricsError(502, 'PAGE_FETCH_FAILED');
  }

  return await response.text();
}

function extractEmbeddedJson(html) {
  const sigiMatch = html.match(/<script id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/);
  const rehydrateMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  const payload = (sigiMatch && sigiMatch[1]) || (rehydrateMatch && rehydrateMatch[1]);

  if (!payload) {
    throw new TikTokMetricsError(502, 'NO_REHYDRATION_DATA');
  }

  try {
    return JSON.parse(payload);
  } catch (error) {
    throw new TikTokMetricsError(502, 'NO_REHYDRATION_DATA');
  }
}

function resolveVideoObject(json, videoId) {
  if (!json || typeof json !== 'object') {
    throw new TikTokMetricsError(404, 'VIDEO_NOT_FOUND');
  }

  if (json.ItemModule && typeof json.ItemModule === 'object' && json.ItemModule[videoId]) {
    return json.ItemModule[videoId];
  }

  const visited = new Set();
  const queue = [json];

  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') continue;
    if (visited.has(current)) continue;
    visited.add(current);

    if (!Array.isArray(current) && (current.id === videoId || current.videoId === videoId)) {
      return current;
    }

    const values = Array.isArray(current) ? current : Object.values(current);

    for (const value of values) {
      if (value && typeof value === 'object') {
        queue.push(value);
      }
    }
  }

  throw new TikTokMetricsError(404, 'VIDEO_NOT_FOUND');
}

function formatResponse(inputUrl, videoId, video, verbose = false) {
  const base = {
    platform: 'tiktok',
    input_url: inputUrl,
    video_id: videoId,
    published_at: toIso(video?.createTime),
    metrics: {
      views: toNumber(video?.stats?.playCount),
      likes: toNumber(video?.stats?.diggCount),
      comments: toNumber(video?.stats?.commentCount),
      shares: toNumber(video?.stats?.shareCount)
    }
  };

  if (verbose) {
    base.raw = video;
  }

  return base;
}

function toNumber(value) {
  if (value === undefined || value === null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toIso(epochSeconds) {
  if (epochSeconds === undefined || epochSeconds === null) return null;
  const seconds = Number(epochSeconds);
  if (!Number.isFinite(seconds)) return null;
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function extractVideoId(urlString) {
  const match = /\/video\/(\d+)/.exec(urlString);
  if (!match) {
    throw new TikTokMetricsError(400, 'CANNOT_EXTRACT_VIDEO_ID');
  }
  return match[1];
}

(function verifyVideoIdExtraction() {
  const sampleUrl = 'https://www.tiktok.com/@demo/video/1234567890123456789';
  const expected = '1234567890123456789';
  if (extractVideoId(sampleUrl) !== expected) {
    throw new Error('extractVideoId failed regression sample');
  }
})();

module.exports = {
  getTikTokVideoMetrics,
  TikTokMetricsError,
  extractVideoId
};
