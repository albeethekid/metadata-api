// TikTokMetadataParser — parses TikTok's server-rendered HTML to extract
// the tagged music/sound for a video.
//
//   parseTaggedMusic(html) → normalized tagged music, or null if the video
//                             has no tagged music.
//
// Kept independent of any HTTP/provider client (see scrapingProviders.js)
// so the same parser works regardless of how the HTML was retrieved.
//
// TikTok embeds page data as JSON in:
//   <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">...</script>
// The tagged music lives at:
//   data.__DEFAULT_SCOPE__["webapp.video-detail"].itemInfo.itemStruct.music

class TikTokParseError extends Error {
  constructor(message, { code, cause } = {}) {
    super(message);
    this.name = 'TikTokParseError';
    this.code = code || 'PARSE_ERROR';
    if (cause) this.cause = cause;
  }
}

const REHYDRATION_SCRIPT_RE = /<script[^>]*id=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i;

// Substrings TikTok's challenge/block/captcha interstitial pages contain
// instead of the real video page markup.
const CHALLENGE_MARKERS = [
  'verify to continue',
  'captcha',
  'access denied',
  'security check'
];

function looksLikeChallengePage(html) {
  const lower = html.toLowerCase();
  return CHALLENGE_MARKERS.some(marker => lower.includes(marker));
}

function extractRehydrationJson(html) {
  const match = REHYDRATION_SCRIPT_RE.exec(html);
  if (!match) {
    if (looksLikeChallengePage(html)) {
      throw new TikTokParseError('TikTok returned a challenge/block page instead of the video page.', {
        code: 'TIKTOK_CHALLENGE_PAGE'
      });
    }
    throw new TikTokParseError('Could not find __UNIVERSAL_DATA_FOR_REHYDRATION__ in the page.', {
      code: 'MISSING_REHYDRATION_DATA'
    });
  }

  try {
    return JSON.parse(match[1]);
  } catch (error) {
    throw new TikTokParseError('Failed to parse TikTok rehydration JSON.', {
      code: 'INVALID_JSON',
      cause: error
    });
  }
}

function getVideoDetail(data) {
  const scope = data && data['__DEFAULT_SCOPE__'];
  const videoDetail = scope && scope['webapp.video-detail'];
  if (!videoDetail || typeof videoDetail !== 'object') {
    throw new TikTokParseError('Missing webapp.video-detail in TikTok data.', {
      code: 'MISSING_VIDEO_DETAIL'
    });
  }
  return videoDetail;
}

function getItemStruct(videoDetail) {
  const itemInfo = videoDetail.itemInfo;
  const itemStruct = itemInfo && itemInfo.itemStruct;

  if (itemStruct && typeof itemStruct === 'object') {
    return itemStruct;
  }

  // Unavailable/deleted/private videos report a status instead of itemStruct.
  const statusMsg = videoDetail.statusMsg || (itemInfo && itemInfo.statusMsg);
  if (statusMsg) {
    throw new TikTokParseError(`TikTok video is unavailable: ${statusMsg}`, {
      code: 'VIDEO_UNAVAILABLE'
    });
  }

  throw new TikTokParseError('Missing itemInfo.itemStruct in TikTok data.', {
    code: 'MISSING_ITEM_STRUCT'
  });
}

function normalizeMusic(music) {
  if (!music || typeof music !== 'object') {
    return null;
  }

  const duration = music.duration;

  return {
    id: music.id != null ? String(music.id) : null,
    song_title: music.title != null ? music.title : null,
    artist: music.authorName != null ? music.authorName : null,
    album: music.album != null ? music.album : null,
    duration: typeof duration === 'number' ? duration : (duration != null && !Number.isNaN(Number(duration)) ? Number(duration) : null),
    original: typeof music.original === 'boolean' ? music.original : null
  };
}

/**
 * Parse the tagged music/sound for a TikTok video from its rendered HTML.
 *
 * @param {string} html
 * @returns {object|null} normalized tagged-music object, or null if the
 *   video has no tagged music.
 * @throws {TikTokParseError}
 */
function parseTaggedMusic(html) {
  if (!html || typeof html !== 'string') {
    throw new TikTokParseError('No HTML provided to parse.', { code: 'EMPTY_HTML' });
  }

  const data = extractRehydrationJson(html);
  const videoDetail = getVideoDetail(data);
  const itemStruct = getItemStruct(videoDetail);

  return normalizeMusic(itemStruct.music);
}

module.exports = { parseTaggedMusic, TikTokParseError };
