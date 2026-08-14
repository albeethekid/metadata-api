function makeFakeSheetsClient({ byPlatform, inUrls, domains }) {
  return {
    spreadsheets: {
      values: {
        get: jest.fn(async ({ range }) => {
          if (range.includes('handles by platform')) return { data: { values: byPlatform } };
          if (range.includes('handles in URLs')) return { data: { values: inUrls } };
          if (range.includes('domains')) return { data: { values: domains } };
          return { data: { values: [] } };
        })
      }
    }
  };
}

jest.mock('../src/sheetsService', () => ({
  getSheetsClient: jest.fn()
}));

const { getSheetsClient } = require('../src/sheetsService');
const {
  isSourceAuthorized,
  parseHandlesByPlatformRows,
  parseHandlesInUrlsRows,
  parseDomainsRows,
  normalizeHandle,
  extractHostname
} = require('../src/sourceAuthorization');

describe('pure parse helpers', () => {
  test('normalizeHandle strips @ and lowercases', () => {
    expect(normalizeHandle('@Foo')).toBe('foo');
    expect(normalizeHandle('  Bar  ')).toBe('bar');
  });

  test('extractHostname strips protocol/www and lowercases', () => {
    expect(extractHostname('https://www.Example.com/path')).toBe('example.com');
    expect(extractHostname('example.com')).toBe('example.com');
    expect(extractHostname('not a url at all')).toBe(null);
    expect(extractHostname('')).toBe(null);
  });

  test('parseHandlesByPlatformRows maps PLATFORM/HANDLE rows, normalized', () => {
    const map = parseHandlesByPlatformRows([
      ['INSTAGRAM', 'meghantrainor'],
      ['YOUTUBE', '@billyjoelVEVO'],
      ['', 'blank-platform-skipped']
    ]);
    expect(map.get('instagram')).toEqual(new Set(['meghantrainor']));
    expect(map.get('youtube')).toEqual(new Set(['billyjoelvevo']));
    expect(map.has('')).toBe(false);
  });

  test('parseHandlesInUrlsRows derives platform+handle from each URL', () => {
    const map = parseHandlesInUrlsRows([
      ['https://www.tiktok.com/@applemusic/video/7553818492273741086'],
      ['https://soundcloud.com/billyjoel/piano-man-1'],
      ['https://x.com/MarvelStudios/status/2041893839355642051'],
      ['https://www.facebook.com/meghantrainorsongs/videos/some-slug/1588461738515320/'],
      ['https://www.instagram.com/reel/DaCAj7cxJCo/'] // not URL-derivable -> skipped
    ]);
    expect(map.get('tiktok')).toEqual(new Set(['applemusic']));
    expect(map.get('soundcloud')).toEqual(new Set(['billyjoel']));
    expect(map.get('x')).toEqual(new Set(['marvelstudios']));
    expect(map.get('facebook')).toEqual(new Set(['meghantrainorsongs']));
    expect(map.has('instagram')).toBe(false);
  });

  test('parseDomainsRows extracts hostnames, ignores non-domain rows', () => {
    const set = parseDomainsRows([
      ['https://tylerthecreatormerchandise.com/'],
      ['DOMAIN'], // stray header-like text, no dot -> ignored
      ['']
    ]);
    expect(set).toEqual(new Set(['tylerthecreatormerchandise.com']));
  });
});

describe('isSourceAuthorized', () => {
  beforeAll(() => {
    getSheetsClient.mockResolvedValue(makeFakeSheetsClient({
      byPlatform: [
        ['PLATFORM', 'HANDLE'],
        ['INSTAGRAM', 'meghantrainor'],
        ['YOUTUBE', '@billyjoelVEVO']
      ],
      inUrls: [
        ['URL'],
        ['https://www.tiktok.com/@applemusic/video/7553818492273741086'],
        ['https://soundcloud.com/billyjoel/piano-man-1']
      ],
      domains: [
        ['https://tylerthecreatormerchandise.com/']
      ]
    }));
  });

  test('instagram handle match (exact) -> true', async () => {
    const authorized = await isSourceAuthorized({
      platform: 'instagram', channelHandle: 'meghantrainor', pageUrl: 'https://www.instagram.com/reel/xyz/'
    });
    expect(authorized).toBe(true);
  });

  test('youtube handle match (case/@ insensitive) -> true', async () => {
    const authorized = await isSourceAuthorized({
      platform: 'youtube', channelHandle: 'billyjoelvevo', pageUrl: 'https://www.youtube.com/watch?v=abc'
    });
    expect(authorized).toBe(true);
  });

  test('tiktok handle derived from URL, matched against handles-in-urls -> true', async () => {
    const authorized = await isSourceAuthorized({
      platform: 'tiktok', channelHandle: '@applemusic', pageUrl: 'https://www.tiktok.com/@applemusic/video/999'
    });
    expect(authorized).toBe(true);
  });

  test('soundcloud handle (screenshot/handle-only platform) derived from URL -> true', async () => {
    const authorized = await isSourceAuthorized({
      platform: 'handle-only', channelHandle: 'billyjoel', pageUrl: 'https://soundcloud.com/billyjoel/uptown-girl'
    });
    expect(authorized).toBe(true);
  });

  test('page_url on an authorized domain (exact) -> true', async () => {
    const authorized = await isSourceAuthorized({
      platform: 'screenshot', channelHandle: '', pageUrl: 'https://tylerthecreatormerchandise.com/shop/hoodie'
    });
    expect(authorized).toBe(true);
  });

  test('page_url on a subdomain of an authorized domain -> true', async () => {
    const authorized = await isSourceAuthorized({
      platform: 'screenshot', channelHandle: '', pageUrl: 'https://shop.tylerthecreatormerchandise.com/hoodie'
    });
    expect(authorized).toBe(true);
  });

  test('no match on handle or domain -> false', async () => {
    const authorized = await isSourceAuthorized({
      platform: 'tiktok', channelHandle: 'someRandomAccount', pageUrl: 'https://www.tiktok.com/@someRandomAccount/video/1'
    });
    expect(authorized).toBe(false);
  });

  test('sheets fetch throws -> resolves false, never propagates', async () => {
    // Use a fresh module instance so the module-level cache from the tests
    // above doesn't mask the rejection with already-cached data.
    let freshIsSourceAuthorized;
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../src/sheetsService', () => ({
        getSheetsClient: jest.fn().mockRejectedValue(new Error('boom'))
      }));
      freshIsSourceAuthorized = require('../src/sourceAuthorization').isSourceAuthorized;
    });
    await expect(freshIsSourceAuthorized({
      platform: 'instagram', channelHandle: 'x', pageUrl: 'https://instagram.com/reel/x'
    })).resolves.toBe(false);
  });
});
