const { parseTaggedMusic, InstagramParseError } = require('../src/instagramMetadataParser');

describe('parseTaggedMusic', () => {
  test('tagged music present → maps song_name/artist_name to song_title/artist', () => {
    const post = {
      shortCode: 'C6Kg9FKt8lt',
      musicInfo: {
        artist_name: 'Sabrina Carpenter',
        song_name: 'Espresso',
        uses_original_audio: false,
        should_mute_audio: false,
        audio_id: '1467739367151376'
      }
    };

    expect(parseTaggedMusic(post)).toEqual({
      id: '1467739367151376',
      song_title: 'Espresso',
      artist: 'Sabrina Carpenter',
      original: false
    });
  });

  test('musicInfo absent → returns null (not an error)', () => {
    const post = { shortCode: 'abc', caption: 'no sound here' };
    expect(parseTaggedMusic(post)).toBeNull();
  });

  test('post unavailable/deleted/private (Apify error item) → POST_UNAVAILABLE', () => {
    const post = { error: 'not_found', errorDescription: 'Post does not exist' };
    try {
      parseTaggedMusic(post);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(InstagramParseError);
      expect(e.code).toBe('POST_UNAVAILABLE');
      expect(e.message).toBe('Post does not exist');
    }
  });

  test('post unavailable without errorDescription → falls back to a generic message', () => {
    const post = { error: 'rate_limited' };
    try {
      parseTaggedMusic(post);
      throw new Error('expected throw');
    } catch (e) {
      expect(e.code).toBe('POST_UNAVAILABLE');
      expect(e.message).toContain('rate_limited');
    }
  });

  test('empty/malformed post data → EMPTY_POST', () => {
    try {
      parseTaggedMusic(null);
      throw new Error('expected throw');
    } catch (e) {
      expect(e.code).toBe('EMPTY_POST');
    }
  });

  test('original audio uses true value correctly', () => {
    const post = { musicInfo: { artist_name: 'Me', song_name: 'My Song', uses_original_audio: true, audio_id: '1' } };
    expect(parseTaggedMusic(post).original).toBe(true);
  });
});
