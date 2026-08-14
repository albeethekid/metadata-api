// Unit tests for the Instagram tagged-music service. Apify is mocked via
// apifyInstagramClient — no real (billable) network calls.

jest.mock('../src/apifyInstagramClient', () => ({
  fetchPost: jest.fn(),
  ApifyInstagramError: class ApifyInstagramError extends Error {
    constructor(message, { status, code } = {}) {
      super(message);
      this.status = status || 502;
      this.code = code || 'APIFY_ERROR';
    }
  }
}));

const { fetchPost, ApifyInstagramError } = require('../src/apifyInstagramClient');
const { fetchTaggedMusic, InstagramTaggedMusicError } = require('../src/instagramTaggedMusic');

const TEST_URL = 'https://www.instagram.com/reels/C6Kg9FKt8lt/';

beforeEach(() => {
  fetchPost.mockReset();
});

describe('fetchTaggedMusic — URL validation (no network call made)', () => {
  test('missing url', async () => {
    await expect(fetchTaggedMusic(undefined)).rejects.toMatchObject({ code: 'MISSING_URL', status: 400 });
    expect(fetchPost).not.toHaveBeenCalled();
  });

  test('invalid url', async () => {
    await expect(fetchTaggedMusic('not a url')).rejects.toMatchObject({ code: 'INVALID_URL', status: 400 });
    expect(fetchPost).not.toHaveBeenCalled();
  });

  test('non-instagram url', async () => {
    await expect(fetchTaggedMusic('https://example.com/reels/x/')).rejects.toMatchObject({ code: 'NOT_INSTAGRAM_URL', status: 400 });
    expect(fetchPost).not.toHaveBeenCalled();
  });

  test('instagram url that is not a post/reel/tv url', async () => {
    await expect(fetchTaggedMusic('https://www.instagram.com/someuser/')).rejects.toMatchObject({
      code: 'UNSUPPORTED_INSTAGRAM_URL_FORMAT',
      status: 400
    });
    expect(fetchPost).not.toHaveBeenCalled();
  });

  test('accepts the plural /reels/ form', async () => {
    fetchPost.mockResolvedValue({ musicInfo: { song_name: 'X', artist_name: 'Y' } });
    await fetchTaggedMusic(TEST_URL);
    expect(fetchPost).toHaveBeenCalledWith(TEST_URL);
  });

  test('accepts the singular /reel/ form', async () => {
    fetchPost.mockResolvedValue({ musicInfo: { song_name: 'X', artist_name: 'Y' } });
    await fetchTaggedMusic('https://www.instagram.com/reel/C6Kg9FKt8lt/');
    expect(fetchPost).toHaveBeenCalled();
  });

  test('accepts /p/ posts', async () => {
    fetchPost.mockResolvedValue({ musicInfo: { song_name: 'X', artist_name: 'Y' } });
    await fetchTaggedMusic('https://www.instagram.com/p/CgtXoBxr_FU/');
    expect(fetchPost).toHaveBeenCalled();
  });

  test('rejects a lookalike host to prevent SSRF (e.g. evilinstagram.com)', async () => {
    await expect(fetchTaggedMusic('https://evilinstagram.com/p/x/')).rejects.toMatchObject({ code: 'NOT_INSTAGRAM_URL' });
    expect(fetchPost).not.toHaveBeenCalled();
  });
});

describe('fetchTaggedMusic — upstream errors', () => {
  test('Apify fetch failure propagates as InstagramTaggedMusicError', async () => {
    fetchPost.mockRejectedValue(new ApifyInstagramError('Apify actor run failed (HTTP 500)', {
      status: 502, code: 'APIFY_RUN_FAILED'
    }));

    await expect(fetchTaggedMusic(TEST_URL)).rejects.toMatchObject({
      code: 'APIFY_RUN_FAILED',
      status: 502
    });
  });

  test('APIFY_API_KEY_NOT_CONFIGURED propagates with its own status', async () => {
    fetchPost.mockRejectedValue(new ApifyInstagramError('APIFY_API_KEY is not set on the server.', {
      status: 503, code: 'APIFY_API_KEY_NOT_CONFIGURED'
    }));

    await expect(fetchTaggedMusic(TEST_URL)).rejects.toMatchObject({
      code: 'APIFY_API_KEY_NOT_CONFIGURED',
      status: 503
    });
  });
});

describe('fetchTaggedMusic — happy path / example integration test', () => {
  test('C6Kg9FKt8lt reel → Espresso by Sabrina Carpenter', async () => {
    fetchPost.mockResolvedValue({
      shortCode: 'C6Kg9FKt8lt',
      musicInfo: {
        artist_name: 'Sabrina Carpenter',
        song_name: 'Espresso',
        uses_original_audio: false,
        audio_id: '1467739367151376'
      }
    });

    const result = await fetchTaggedMusic(TEST_URL);

    expect(fetchPost).toHaveBeenCalledWith(TEST_URL);
    expect(result).toEqual({
      platform: 'instagram',
      url: TEST_URL,
      tagged_music: {
        id: '1467739367151376',
        song_title: 'Espresso',
        artist: 'Sabrina Carpenter',
        original: false
      }
    });
    // Minimum contract, mirroring the TikTok endpoint's spec.
    expect(result.tagged_music.song_title).toBe('Espresso');
    expect(result.tagged_music.artist).toBe('Sabrina Carpenter');
  });

  test('post with no tagged music → successful response with tagged_music: null', async () => {
    fetchPost.mockResolvedValue({ shortCode: 'abc', caption: 'no sound here' });
    const result = await fetchTaggedMusic(TEST_URL);
    expect(result).toEqual({ platform: 'instagram', url: TEST_URL, tagged_music: null });
  });
});

describe('fetchTaggedMusic — parse failures surface distinct error codes', () => {
  test('deleted/private/unavailable post', async () => {
    fetchPost.mockResolvedValue({ error: 'not_found', errorDescription: 'Post does not exist' });
    await expect(fetchTaggedMusic(TEST_URL)).rejects.toMatchObject({ code: 'POST_UNAVAILABLE', status: 404 });
  });
});
