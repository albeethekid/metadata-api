// Unit tests for the TikTok tagged-music service. ScrapingBee/Oxylabs are
// mocked via scrapingProviders — no real (billable) network calls.

jest.mock('../src/scrapingProviders', () => ({
  fetchPageHtml: jest.fn(),
  SUPPORTED_PROVIDERS: ['scrapingbee', 'oxylabs'],
  DEFAULT_PROVIDER: 'scrapingbee',
  ScrapingProviderError: class ScrapingProviderError extends Error {
    constructor(message, { status, code } = {}) {
      super(message);
      this.status = status || 502;
      this.code = code || 'SCRAPING_PROVIDER_ERROR';
    }
  }
}));

const { fetchPageHtml, ScrapingProviderError } = require('../src/scrapingProviders');
const { fetchTaggedMusic, TikTokTaggedMusicError } = require('../src/tiktokTaggedMusic');

const TEST_URL = 'https://www.tiktok.com/@whynowworld/video/7371482618690391329';

function htmlWithMusic(music) {
  const data = {
    __DEFAULT_SCOPE__: {
      'webapp.video-detail': {
        itemInfo: { itemStruct: { id: '7371482618690391329', music } }
      }
    }
  };
  return `<!DOCTYPE html><html><body><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
}

beforeEach(() => {
  fetchPageHtml.mockReset();
});

describe('fetchTaggedMusic — URL validation (no network call made)', () => {
  test('missing url', async () => {
    await expect(fetchTaggedMusic(undefined)).rejects.toMatchObject({ code: 'MISSING_URL', status: 400 });
    expect(fetchPageHtml).not.toHaveBeenCalled();
  });

  test('invalid url', async () => {
    await expect(fetchTaggedMusic('not a url')).rejects.toMatchObject({ code: 'INVALID_URL', status: 400 });
    expect(fetchPageHtml).not.toHaveBeenCalled();
  });

  test('non-tiktok url', async () => {
    await expect(fetchTaggedMusic('https://example.com/@x/video/123')).rejects.toMatchObject({ code: 'NOT_TIKTOK_URL', status: 400 });
    expect(fetchPageHtml).not.toHaveBeenCalled();
  });

  test('tiktok url that is not a video url', async () => {
    await expect(fetchTaggedMusic('https://www.tiktok.com/@whynowworld')).rejects.toMatchObject({
      code: 'UNSUPPORTED_TIKTOK_URL_FORMAT',
      status: 400
    });
    expect(fetchPageHtml).not.toHaveBeenCalled();
  });

  test('rejects a lookalike host to prevent SSRF (e.g. eviltiktok.com)', async () => {
    await expect(fetchTaggedMusic('https://eviltiktok.com/@x/video/123')).rejects.toMatchObject({ code: 'NOT_TIKTOK_URL' });
    expect(fetchPageHtml).not.toHaveBeenCalled();
  });
});

describe('fetchTaggedMusic — upstream errors', () => {
  test('provider fetch failure propagates as TikTokTaggedMusicError', async () => {
    fetchPageHtml.mockRejectedValue(new ScrapingProviderError('ScrapingBee upstream request failed (HTTP 500)', {
      status: 502, code: 'SCRAPINGBEE_UPSTREAM_ERROR'
    }));

    await expect(fetchTaggedMusic(TEST_URL)).rejects.toMatchObject({
      code: 'SCRAPINGBEE_UPSTREAM_ERROR',
      status: 502
    });
  });

  test('unsupported provider is rejected before fetching', async () => {
    await expect(fetchTaggedMusic(TEST_URL, { provider: 'bogus' })).rejects.toMatchObject({
      code: 'UNSUPPORTED_PROVIDER',
      status: 400
    });
    expect(fetchPageHtml).not.toHaveBeenCalled();
  });
});

describe('fetchTaggedMusic — happy path / example integration test', () => {
  test('whynowworld video → Rolling in the Deep by Adele', async () => {
    fetchPageHtml.mockResolvedValue(htmlWithMusic({
      id: '6751217784547461122',
      title: 'Rolling in the Deep',
      authorName: 'Adele',
      album: '21',
      original: false,
      duration: 60
    }));

    const result = await fetchTaggedMusic(TEST_URL);

    expect(fetchPageHtml).toHaveBeenCalledWith(TEST_URL, { provider: 'scrapingbee' });
    expect(result).toEqual({
      platform: 'tiktok',
      url: TEST_URL,
      tagged_music: {
        id: '6751217784547461122',
        song_title: 'Rolling in the Deep',
        artist: 'Adele',
        album: '21',
        duration: 60,
        original: false
      }
    });
    // Minimum contract from the spec.
    expect(result.tagged_music.song_title).toBe('Rolling in the Deep');
    expect(result.tagged_music.artist).toBe('Adele');
  });

  test('provider param is forwarded to the scraping provider', async () => {
    fetchPageHtml.mockResolvedValue(htmlWithMusic({ title: 'X', authorName: 'Y' }));
    await fetchTaggedMusic(TEST_URL, { provider: 'oxylabs' });
    expect(fetchPageHtml).toHaveBeenCalledWith(TEST_URL, { provider: 'oxylabs' });
  });

  test('video with no tagged music → successful response with tagged_music: null', async () => {
    fetchPageHtml.mockResolvedValue(htmlWithMusic(undefined));
    const result = await fetchTaggedMusic(TEST_URL);
    expect(result).toEqual({ platform: 'tiktok', url: TEST_URL, tagged_music: null });
  });
});

describe('fetchTaggedMusic — parse failures surface distinct error codes', () => {
  test('challenge/block page that persists across the retry still surfaces TIKTOK_CHALLENGE_PAGE', async () => {
    fetchPageHtml.mockResolvedValue('<html><body>Please verify to continue. captcha</body></html>');
    await expect(fetchTaggedMusic(TEST_URL)).rejects.toMatchObject({ code: 'TIKTOK_CHALLENGE_PAGE', status: 502 });
    expect(fetchPageHtml).toHaveBeenCalledTimes(2);
  });

  test('deleted/private video is terminal — not retried', async () => {
    const data = {
      __DEFAULT_SCOPE__: {
        'webapp.video-detail': { statusMsg: 'This video is unavailable', itemInfo: {} }
      }
    };
    fetchPageHtml.mockResolvedValue(`<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(data)}</script>`);
    await expect(fetchTaggedMusic(TEST_URL)).rejects.toMatchObject({ code: 'VIDEO_UNAVAILABLE', status: 404 });
    expect(fetchPageHtml).toHaveBeenCalledTimes(1);
  });
});

describe('fetchTaggedMusic — transient scrape failures are retried once', () => {
  test('TikTok anti-bot interstitial on first attempt, real page on retry → succeeds', async () => {
    // First fetch returns TikTok's bot-detection interstitial (no rehydration
    // data at all); a fresh fetch on retry gets the real page.
    fetchPageHtml
      .mockResolvedValueOnce('<!DOCTYPE html><html><body><script id="pumbaa-rule" type="application/json">{}</script></body></html>')
      .mockResolvedValueOnce(htmlWithMusic({ title: 'Rolling in the Deep', authorName: 'Adele', album: '21', duration: 60, original: false, id: '6751217784547461122' }));

    const result = await fetchTaggedMusic(TEST_URL);

    expect(fetchPageHtml).toHaveBeenCalledTimes(2);
    expect(result.tagged_music.song_title).toBe('Rolling in the Deep');
    expect(result.tagged_music.artist).toBe('Adele');
  });

  test('missing webapp.video-detail on first attempt, real page on retry → succeeds', async () => {
    const incomplete = { __DEFAULT_SCOPE__: { 'webapp.app-context': {} } };
    fetchPageHtml
      .mockResolvedValueOnce(`<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(incomplete)}</script>`)
      .mockResolvedValueOnce(htmlWithMusic({ title: 'X', authorName: 'Y' }));

    const result = await fetchTaggedMusic(TEST_URL);

    expect(fetchPageHtml).toHaveBeenCalledTimes(2);
    expect(result.tagged_music.song_title).toBe('X');
  });

  test('retryable failure on both attempts → throws after the retry, not before', async () => {
    const incomplete = { __DEFAULT_SCOPE__: { 'webapp.app-context': {} } };
    fetchPageHtml.mockResolvedValue(`<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(incomplete)}</script>`);

    await expect(fetchTaggedMusic(TEST_URL)).rejects.toMatchObject({ code: 'MISSING_VIDEO_DETAIL', status: 502 });
    expect(fetchPageHtml).toHaveBeenCalledTimes(2);
  });
});
