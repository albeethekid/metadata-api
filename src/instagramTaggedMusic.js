// InstagramTaggedMusicService — determines the music/sound tagged on an
// Instagram post/reel.
//
//   ApifyInstagramClient.fetchPost(url)            → raw Apify post item
//   InstagramMetadataParser.parseTaggedMusic(post) → normalized tagged music
//   InstagramTaggedMusicService.fetchTaggedMusic(url) → API response
//
// URL validation is intentionally strict: only instagram.com hosts and
// paths that look like a post/reel/tv URL are allowed, so this service
// can't be used as a general-purpose server-side URL fetcher.

const { fetchPost, ApifyInstagramError } = require('./apifyInstagramClient');
const { parseTaggedMusic, InstagramParseError } = require('./instagramMetadataParser');

class InstagramTaggedMusicError extends Error {
  constructor(message, { status, code, cause } = {}) {
    super(message);
    this.name = 'InstagramTaggedMusicError';
    this.status = status || 500;
    this.code = code || 'INSTAGRAM_TAGGED_MUSIC_ERROR';
    if (cause) this.cause = cause;
  }
}

// Matches /p/{shortcode}/, /reel/{shortcode}/, /reels/{shortcode}/, /tv/{shortcode}/.
const POST_PATH_RE = /^\/(p|reel|reels|tv)\/([^/]+)\/?$/;

function normalizeAndValidateUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new InstagramTaggedMusicError('url is required.', { status: 400, code: 'MISSING_URL' });
  }

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (error) {
    throw new InstagramTaggedMusicError('url is not a valid URL.', { status: 400, code: 'INVALID_URL' });
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new InstagramTaggedMusicError('url must use http or https.', { status: 400, code: 'INVALID_URL' });
  }

  const hostname = parsed.hostname.toLowerCase();
  const isInstagramHost = hostname === 'instagram.com' || hostname.endsWith('.instagram.com');
  if (!isInstagramHost) {
    throw new InstagramTaggedMusicError('url must be an instagram.com URL.', { status: 400, code: 'NOT_INSTAGRAM_URL' });
  }

  if (!POST_PATH_RE.test(parsed.pathname)) {
    throw new InstagramTaggedMusicError(
      'url does not look like a supported Instagram post URL (expected /p/, /reel/, /reels/, or /tv/).',
      { status: 400, code: 'UNSUPPORTED_INSTAGRAM_URL_FORMAT' }
    );
  }

  return parsed.toString();
}

/**
 * Fetch the tagged music/sound for an Instagram post/reel.
 *
 * @param {string} rawUrl
 * @returns {Promise<{ platform: 'instagram', url: string, tagged_music: object|null }>}
 * @throws {InstagramTaggedMusicError}
 */
async function fetchTaggedMusic(rawUrl) {
  const url = normalizeAndValidateUrl(rawUrl);

  let post;
  try {
    post = await fetchPost(url);
  } catch (error) {
    if (error instanceof ApifyInstagramError) {
      throw new InstagramTaggedMusicError(error.message, { status: error.status, code: error.code, cause: error });
    }
    throw new InstagramTaggedMusicError('Failed to fetch the Instagram post.', {
      status: 502,
      code: 'POST_FETCH_FAILED',
      cause: error
    });
  }

  let taggedMusic;
  try {
    taggedMusic = parseTaggedMusic(post);
  } catch (error) {
    if (error instanceof InstagramParseError) {
      throw new InstagramTaggedMusicError(error.message, {
        status: error.code === 'POST_UNAVAILABLE' ? 404 : 502,
        code: error.code,
        cause: error
      });
    }
    throw new InstagramTaggedMusicError('Failed to parse the Instagram post.', {
      status: 502,
      code: 'PARSE_FAILED',
      cause: error
    });
  }

  return { platform: 'instagram', url, tagged_music: taggedMusic };
}

module.exports = { fetchTaggedMusic, InstagramTaggedMusicError };
