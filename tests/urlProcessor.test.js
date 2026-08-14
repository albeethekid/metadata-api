const { normalizeResponse, formatTaggedMusic, classifyUrl, processUrl } = require('../src/urlProcessor');

describe('formatTaggedMusic', () => {
  test('artist + song_title → "Artist - Song Title"', () => {
    expect(formatTaggedMusic({ artist: 'Adele', song_title: 'Rolling in the Deep' }))
      .toBe('Adele - Rolling in the Deep');
  });

  test('artist only → artist alone', () => {
    expect(formatTaggedMusic({ artist: 'Adele', song_title: null })).toBe('Adele');
  });

  test('song_title only → title alone', () => {
    expect(formatTaggedMusic({ artist: null, song_title: 'Rolling in the Deep' })).toBe('Rolling in the Deep');
  });

  test('neither field → empty string', () => {
    expect(formatTaggedMusic({ artist: null, song_title: null })).toBe('');
  });

  test('null input → empty string', () => {
    expect(formatTaggedMusic(null)).toBe('');
  });

  test('trims whitespace from both fields', () => {
    expect(formatTaggedMusic({ artist: '  Adele  ', song_title: '  Rolling in the Deep  ' }))
      .toBe('Adele - Rolling in the Deep');
  });
});

describe('normalizeResponse taggedMusic mapping', () => {
  test('tiktok entry with taggedMusic → formatted into out.taggedMusic', () => {
    const entry = { platform: 'tiktok', channelHandle: '@adele' };
    const item = {
      description: 'a video',
      metrics: { views: 1, likes: 2, comments: 3 },
      taggedMusic: { artist: 'Adele', song_title: 'Rolling in the Deep' }
    };
    expect(normalizeResponse(entry, item).taggedMusic).toBe('Adele - Rolling in the Deep');
  });

  test('tiktok entry with no taggedMusic → blank', () => {
    const entry = { platform: 'tiktok', channelHandle: '@adele' };
    const item = { description: 'a video', metrics: {} };
    expect(normalizeResponse(entry, item).taggedMusic).toBe('');
  });

  test('instagram entry with taggedMusic → formatted into out.taggedMusic', () => {
    const entry = { platform: 'instagram' };
    const item = {
      description: 'a reel',
      metrics: {},
      taggedMusic: { artist: 'Sabrina Carpenter', song_title: 'Espresso' }
    };
    expect(normalizeResponse(entry, item).taggedMusic).toBe('Sabrina Carpenter - Espresso');
  });

  test('non-tiktok/instagram platforms leave taggedMusic blank', () => {
    const entry = { platform: 'youtube' };
    const item = { title: 'a video' };
    expect(normalizeResponse(entry, item).taggedMusic).toBe('');
  });
});

describe('classifyUrl channelHandle for screenshot-fallback platforms', () => {
  test('soundcloud track URL → handle from first path segment', () => {
    const entry = classifyUrl('https://soundcloud.com/shakira/suerte-whenever-wherever');
    expect(entry.platform).toBe('screenshot');
    expect(entry.channelHandle).toBe('shakira');
  });

  test('x.com status URL → handle from first path segment', () => {
    const entry = classifyUrl('https://x.com/aaliyah/status/1724232617531478405');
    expect(entry.channelHandle).toBe('aaliyah');
  });

  test('twitter.com (legacy domain) → same handle extraction as x.com', () => {
    const entry = classifyUrl('https://twitter.com/aaliyah/status/1724232617531478405');
    expect(entry.channelHandle).toBe('aaliyah');
  });

  test('facebook post URL with page name → handle from first path segment', () => {
    const entry = classifyUrl('https://www.facebook.com/ABCNews/posts/meta-announced-a-new-safety-feature-called-parent-alerts-which-notifies-parents-/1469796851673857/');
    expect(entry.channelHandle).toBe('ABCNews');
  });

  test('facebook watch/profile.php URLs with no handle → blank', () => {
    expect(classifyUrl('https://www.facebook.com/watch/?v=123456789').channelHandle).toBeUndefined();
    expect(classifyUrl('https://www.facebook.com/profile.php?id=100064860875397').channelHandle).toBeUndefined();
  });

  test('threads post URL → @-prefixed handle', () => {
    const entry = classifyUrl('https://www.threads.com/@instylemagazine/post/DZLJXb1FCZr/there-is-no-fifa-world-cup-without-the-voice-of-shakira-in-preparation-for-the/');
    expect(entry.channelHandle).toBe('@instylemagazine');
  });

  test('unrelated host (e.g. a news site) → no handle', () => {
    const entry = classifyUrl('https://example.com/some/article');
    expect(entry.channelHandle).toBeUndefined();
  });

  test('normalizeResponse maps the parsed handle into out.channelHandle', () => {
    const entry = classifyUrl('https://soundcloud.com/shakira/suerte-whenever-wherever');
    const normalized = normalizeResponse(entry, { title: 'Suerte', s3_url: 'https://example.com/img.png' });
    expect(normalized.channelHandle).toBe('shakira');
  });

  test('handle still parses when includeScreenshots is false (the Sheets Processor UI default)', () => {
    const entry = classifyUrl('https://soundcloud.com/shakira/suerte-whenever-wherever', false);
    expect(entry.platform).toBe('handle-only');
    expect(entry.channelHandle).toBe('shakira');
  });

  test('unrelated host with includeScreenshots false → still unsupported (null)', () => {
    expect(classifyUrl('https://example.com/some/article', false)).toBeNull();
  });
});

describe('processUrl handle-only path (includeScreenshots: false)', () => {
  const CASES = [
    ['https://soundcloud.com/shakira/suerte-whenever-wherever', 'shakira'],
    ['https://x.com/aaliyah/status/1724232617531478405', 'aaliyah'],
    ['https://www.facebook.com/ABCNews/posts/meta-announced-a-new-safety-feature-called-parent-alerts-which-notifies-parents-/1469796851673857/', 'ABCNews'],
    ['https://www.threads.com/@instylemagazine/post/DZLJXb1FCZr/there-is-no-fifa-world-cup-without-the-voice-of-shakira-in-preparation-for-the/', '@instylemagazine']
  ];

  test.each(CASES)('%s → handle %s, no network fetch needed', async (url, expectedHandle) => {
    const result = await processUrl(url, { includeScreenshots: false });
    expect(result.ok).toBe(true);
    expect(result.platform).toBe('handle-only');
    expect(result.normalized.channelHandle).toBe(expectedHandle);
    expect(result.normalized.title).toBe('');
  });
});
