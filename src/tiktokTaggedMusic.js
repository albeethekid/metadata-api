// TikTokTaggedMusicService — determines the music/sound tagged on a
// TikTok video.
//
//   ScrapingProvider.fetchPageHtml(url)      → raw HTML
//   TikTokMetadataParser.parseTaggedMusic(html) → normalized tagged music
//   TikTokTaggedMusicService.fetchTaggedMusic(url) → API response
//
// URL validation is intentionally strict: only tiktok.com hosts and paths
// that look like a video URL are allowed, so this service can't be used as
// a general-purpose server-side URL fetcher.

const { fetchPageHtml, SUPPORTED_PROVIDERS, DEFAULT_PROVIDER, ScrapingProviderError } = require('./scrapingProviders');
const { parseTaggedMusic, TikTokParseError } = require('./tiktokMetadataParser');

class TikTokTaggedMusicError extends Error {
  constructor(message, { status, code, cause } = {}) {
    super(message);
    this.name = 'TikTokTaggedMusicError';
    this.status = status || 500;
    this.code = code || 'TIKTOK_TAGGED_MUSIC_ERROR';
    if (cause) this.cause = cause;
  }
}

// Matches /@handle/video/<id>, the canonical TikTok video URL shape.
const VIDEO_PATH_RE = /^\/@[^/]+\/video\/\d+\/?$/;

function normalizeAndValidateUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new TikTokTaggedMusicError('url is required.', { status: 400, code: 'MISSING_URL' });
  }

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (error) {
    throw new TikTokTaggedMusicError('url is not a valid URL.', { status: 400, code: 'INVALID_URL' });
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new TikTokTaggedMusicError('url must use http or https.', { status: 400, code: 'INVALID_URL' });
  }

  const hostname = parsed.hostname.toLowerCase();
  const isTikTokHost = hostname === 'tiktok.com' || hostname.endsWith('.tiktok.com');
  if (!isTikTokHost) {
    throw new TikTokTaggedMusicError('url must be a tiktok.com URL.', { status: 400, code: 'NOT_TIKTOK_URL' });
  }

  if (!VIDEO_PATH_RE.test(parsed.pathname)) {
    throw new TikTokTaggedMusicError(
      'url does not look like a TikTok video URL (expected .../@handle/video/<id>).',
      { status: 400, code: 'UNSUPPORTED_TIKTOK_URL_FORMAT' }
    );
  }

  return parsed.toString();
}

function resolveProvider(provider) {
  if (provider === undefined || provider === null) return DEFAULT_PROVIDER;
  if (typeof provider !== 'string' || !SUPPORTED_PROVIDERS.includes(provider)) {
    throw new TikTokTaggedMusicError(`Unsupported provider: ${provider}`, {
      status: 400,
      code: 'UNSUPPORTED_PROVIDER'
    });
  }
  return provider;
}

// TikTok occasionally serves a bot-detection interstitial (or a
// partially-rendered page) instead of the real video page — a fresh
// fetch of the same URL usually gets through. These parse error codes
// look like that transient case rather than a permanent one (e.g. a
// genuinely deleted video, which is not retried).
const RETRYABLE_PARSE_CODES = new Set([
  'MISSING_REHYDRATION_DATA',
  'TIKTOK_CHALLENGE_PAGE',
  'MISSING_VIDEO_DETAIL',
  'MISSING_ITEM_STRUCT'
]);
const MAX_ATTEMPTS = 2;

/**
 * Fetch the tagged music/sound for a TikTok video.
 *
 * @param {string} rawUrl
 * @param {object} [opts]
 * @param {string} [opts.provider]  'scrapingbee' (default) or 'oxylabs'
 * @returns {Promise<{ platform: 'tiktok', url: string, tagged_music: object|null }>}
 * @throws {TikTokTaggedMusicError}
 */
async function fetchTaggedMusic(rawUrl, opts = {}) {
  const url = normalizeAndValidateUrl(rawUrl);
  const provider = resolveProvider(opts.provider);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let html;
    try {
      html = await fetchPageHtml(url, { provider });
    } catch (error) {
      if (error instanceof ScrapingProviderError) {
        throw new TikTokTaggedMusicError(error.message, { status: error.status, code: error.code, cause: error });
      }
      throw new TikTokTaggedMusicError('Failed to fetch the TikTok page.', {
        status: 502,
        code: 'PAGE_FETCH_FAILED',
        cause: error
      });
    }

    try {
      const taggedMusic = parseTaggedMusic(html);
      return { platform: 'tiktok', url, tagged_music: taggedMusic };
    } catch (error) {
      if (!(error instanceof TikTokParseError)) {
        throw new TikTokTaggedMusicError('Failed to parse the TikTok page.', {
          status: 502,
          code: 'PARSE_FAILED',
          cause: error
        });
      }

      if (attempt < MAX_ATTEMPTS && RETRYABLE_PARSE_CODES.has(error.code)) {
        console.warn(`[TikTokTaggedMusic] ${error.code} on attempt ${attempt}, retrying with a fresh fetch`);
        continue;
      }

      throw new TikTokTaggedMusicError(error.message, {
        status: error.code === 'VIDEO_UNAVAILABLE' ? 404 : 502,
        code: error.code,
        cause: error
      });
    }
  }
}

module.exports = { fetchTaggedMusic, TikTokTaggedMusicError };
