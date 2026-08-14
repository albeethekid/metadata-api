// InstagramMetadataParser — extracts tagged music from an Apify
// instagram-scraper dataset item.
//
//   parseTaggedMusic(post) → normalized tagged music, or null if the post
//                             has no tagged music.
//
// Kept independent of the Apify HTTP client (see apifyInstagramClient.js)
// so it can be reused regardless of how the post data was retrieved.
//
// Apify's instagram-scraper puts tagged-music data at post.musicInfo, e.g.:
//   { "artist_name": "Adele", "song_name": "Rolling in the Deep",
//     "uses_original_audio": false, "audio_id": "..." }
// Unavailable/deleted/private posts come back as
//   { "error": "not_found", "errorDescription": "Post does not exist" }
// instead of real post data.

class InstagramParseError extends Error {
  constructor(message, { code, cause } = {}) {
    super(message);
    this.name = 'InstagramParseError';
    this.code = code || 'PARSE_ERROR';
    if (cause) this.cause = cause;
  }
}

function normalizeMusic(music) {
  if (!music || typeof music !== 'object') {
    return null;
  }

  return {
    id: music.audio_id != null ? String(music.audio_id) : null,
    song_title: music.song_name != null ? music.song_name : null,
    artist: music.artist_name != null ? music.artist_name : null,
    original: typeof music.uses_original_audio === 'boolean' ? music.uses_original_audio : null
  };
}

/**
 * Parse the tagged music/sound for an Instagram post/reel from its raw
 * Apify instagram-scraper dataset item.
 *
 * @param {object} post
 * @returns {object|null} normalized tagged-music object, or null if the
 *   post has no tagged music.
 * @throws {InstagramParseError}
 */
function parseTaggedMusic(post) {
  if (!post || typeof post !== 'object') {
    throw new InstagramParseError('No post data to parse.', { code: 'EMPTY_POST' });
  }

  if (post.error) {
    throw new InstagramParseError(post.errorDescription || `Instagram post is unavailable: ${post.error}`, {
      code: 'POST_UNAVAILABLE'
    });
  }

  return normalizeMusic(post.musicInfo);
}

module.exports = { parseTaggedMusic, InstagramParseError };
