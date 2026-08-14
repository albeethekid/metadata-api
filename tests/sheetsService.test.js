const { buildRowUpdates } = require('../src/sheetsService');

describe('buildRowUpdates', () => {
  const headerIndex = {
    title: 4,
    content_url: 10,
    handle: 42,
    duration: 43,
    view_count: 44,
    published_date: 45,
    like_count: 46,
    comment_count: 47,
    tagged_music: 48,
    client_category_override: 7
  };

  test('writes all COLUMN_MAP columns present in headerIndex, blank if empty', () => {
    const normalized = {
      title: 'A title', heroImageUrl: '', channelHandle: 'shakira',
      durationSeconds: '', viewCount: 100, publishedAt: '', likeCount: '', commentCount: '', taggedMusic: ''
    };
    const updates = buildRowUpdates(5, headerIndex, normalized);
    const byRange = Object.fromEntries(updates.map(u => [u.range, u.values[0][0]]));
    expect(byRange['report!E5']).toBe('A title');       // title -> col index 4 -> E
    expect(byRange['report!AQ5']).toBe('shakira');       // handle -> col index 42 -> AQ
    expect(byRange['report!AS5']).toBe('100');           // view_count -> col index 44 -> AS
  });

  test('client_category_override is written when set', () => {
    const normalized = { title: '', clientCategoryOverride: 'source_authorized' };
    const updates = buildRowUpdates(5, headerIndex, normalized);
    const overrideUpdate = updates.find(u => u.range === 'report!H5');
    expect(overrideUpdate).toBeDefined();
    expect(overrideUpdate.values[0][0]).toBe('source_authorized');
  });

  test('client_category_override is NOT written (not even blank) when unset', () => {
    const normalized = { title: 'A title', clientCategoryOverride: '' };
    const updates = buildRowUpdates(5, headerIndex, normalized);
    const overrideUpdate = updates.find(u => u.range === 'report!H5');
    expect(overrideUpdate).toBeUndefined();
  });

  test('client_category_override skipped entirely if header missing from sheet', () => {
    const { client_category_override, ...headerIndexNoOverride } = headerIndex;
    const normalized = { title: '', clientCategoryOverride: 'source_authorized' };
    const updates = buildRowUpdates(5, headerIndexNoOverride, normalized);
    expect(updates.find(u => u.range.includes('H5'))).toBeUndefined();
  });

  test('missing headers are skipped silently', () => {
    const partialHeaderIndex = { title: 0 };
    const normalized = { title: 'Only title header exists' };
    const updates = buildRowUpdates(2, partialHeaderIndex, normalized);
    expect(updates).toEqual([{ range: 'report!A2', values: [['Only title header exists']] }]);
  });
});
