const { parseTaggedMusic, TikTokParseError } = require('../src/tiktokMetadataParser');

function htmlWithRehydration(data) {
  return `<!DOCTYPE html><html><body>
    <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(data)}</script>
  </body></html>`;
}

function videoDetailPayload(itemStruct) {
  return {
    __DEFAULT_SCOPE__: {
      'webapp.video-detail': {
        itemInfo: { itemStruct }
      }
    }
  };
}

describe('parseTaggedMusic', () => {
  test('tagged music present → maps title/authorName to song_title/artist', () => {
    const html = htmlWithRehydration(videoDetailPayload({
      music: {
        id: '6751217784547461122',
        title: 'Rolling in the Deep',
        authorName: 'Adele',
        album: '21',
        duration: 60,
        original: false
      }
    }));

    const result = parseTaggedMusic(html);
    expect(result).toEqual({
      id: '6751217784547461122',
      song_title: 'Rolling in the Deep',
      artist: 'Adele',
      album: '21',
      duration: 60,
      original: false
    });
  });

  test('music object absent → returns null (not an error)', () => {
    const html = htmlWithRehydration(videoDetailPayload({ id: '123', desc: 'no sound here' }));
    expect(parseTaggedMusic(html)).toBeNull();
  });

  test('malformed JSON in rehydration script → INVALID_JSON', () => {
    const html = `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">{not valid json</script>`;
    expect(() => parseTaggedMusic(html)).toThrow(TikTokParseError);
    try {
      parseTaggedMusic(html);
      throw new Error('expected throw');
    } catch (e) {
      expect(e.code).toBe('INVALID_JSON');
    }
  });

  test('rehydration script absent → MISSING_REHYDRATION_DATA', () => {
    const html = `<!DOCTYPE html><html><body><p>hello</p></body></html>`;
    try {
      parseTaggedMusic(html);
      throw new Error('expected throw');
    } catch (e) {
      expect(e.code).toBe('MISSING_REHYDRATION_DATA');
    }
  });

  test('challenge/block page instead of rehydration script → TIKTOK_CHALLENGE_PAGE', () => {
    const html = `<!DOCTYPE html><html><body><h1>Please verify to continue</h1><div class="captcha"></div></body></html>`;
    try {
      parseTaggedMusic(html);
      throw new Error('expected throw');
    } catch (e) {
      expect(e.code).toBe('TIKTOK_CHALLENGE_PAGE');
    }
  });

  test('missing webapp.video-detail → MISSING_VIDEO_DETAIL', () => {
    const html = htmlWithRehydration({ __DEFAULT_SCOPE__: {} });
    try {
      parseTaggedMusic(html);
      throw new Error('expected throw');
    } catch (e) {
      expect(e.code).toBe('MISSING_VIDEO_DETAIL');
    }
  });

  test('missing itemInfo.itemStruct (no status) → MISSING_ITEM_STRUCT', () => {
    const html = htmlWithRehydration({
      __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: {} } }
    });
    try {
      parseTaggedMusic(html);
      throw new Error('expected throw');
    } catch (e) {
      expect(e.code).toBe('MISSING_ITEM_STRUCT');
    }
  });

  test('video unavailable/deleted/private → VIDEO_UNAVAILABLE', () => {
    const html = htmlWithRehydration({
      __DEFAULT_SCOPE__: {
        'webapp.video-detail': {
          statusMsg: 'This video is no longer available',
          itemInfo: {}
        }
      }
    });
    try {
      parseTaggedMusic(html);
      throw new Error('expected throw');
    } catch (e) {
      expect(e.code).toBe('VIDEO_UNAVAILABLE');
    }
  });

  test('empty html → EMPTY_HTML', () => {
    try {
      parseTaggedMusic('');
      throw new Error('expected throw');
    } catch (e) {
      expect(e.code).toBe('EMPTY_HTML');
    }
  });
});
