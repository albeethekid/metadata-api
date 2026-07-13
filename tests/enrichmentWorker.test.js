const {
  parseTitleOverride, planQueries, classifyUrl, buildEvidence,
  mergeProposal, deriveEnrichmentStatus, processRow
} = require('../src/enrichmentWorker');

// Mock the two external dependencies so tests never hit real providers.
jest.mock('../src/serpClient', () => ({
  search: jest.fn(),
  SerpError: class SerpError extends Error {}
}));
const serp = require('../src/serpClient');

// ─── parseTitleOverride ─────────────────────────────────────────────────────

describe('parseTitleOverride', () => {
  test('plain stage name', () => {
    const p = parseTitleOverride('Central Cee');
    expect(p.name).toBe('Central Cee');
    expect(p.parenthetical).toBeNull();
    expect(p.malformed).toBe(false);
  });

  test('member with affiliation', () => {
    const p = parseTitleOverride('Michelle Joy (Cannons)');
    expect(p.name).toBe('Michelle Joy');
    expect(p.parenthetical).toBe('Cannons');
  });

  test('band name only', () => {
    const p = parseTitleOverride('Cannons');
    expect(p.name).toBe('Cannons');
    expect(p.parenthetical).toBeNull();
  });

  test('B-Real (Cypress Hill) — hyphen inside name', () => {
    const p = parseTitleOverride('B-Real (Cypress Hill)');
    expect(p.name).toBe('B-Real');
    expect(p.parenthetical).toBe('Cypress Hill');
  });

  test('stylized numeral (ASC2NT)', () => {
    const p = parseTitleOverride('ASC2NT');
    expect(p.name).toBe('ASC2NT');
  });

  test('non-ASCII name (Park Hyun Chul (ASC2NT))', () => {
    const p = parseTitleOverride('Park Hyun Chul (ASC2NT)');
    expect(p.name).toBe('Park Hyun Chul');
    expect(p.parenthetical).toBe('ASC2NT');
  });

  test('malformed parens: unbalanced open', () => {
    const p = parseTitleOverride('Michelle Joy (Cannons');
    expect(p.malformed).toBe(true);
  });

  test('nested parens: keeps the whole string as name, no parenthetical extracted', () => {
    // Only balanced *flat* trailing groups are recognized. Nested parens fall
    // through — the LLM sees the raw title and can flag it.
    const p = parseTitleOverride('Foo (Bar (Baz))');
    expect(p.malformed).toBe(false); // paren counts are balanced
    expect(p.name).toBe('Foo (Bar (Baz))');
    expect(p.parenthetical).toBeNull();
  });

  test('blank title', () => {
    const p = parseTitleOverride('');
    expect(p.name).toBe('');
  });

  test('extra whitespace and unicode dashes', () => {
    const p = parseTitleOverride('   Central   Cee   ');
    expect(p.name).toBe('Central Cee');
  });
});

// ─── planQueries ────────────────────────────────────────────────────────────

describe('planQueries', () => {
  test('includes affiliation for group members', () => {
    const p = parseTitleOverride('Michelle Joy (Cannons)');
    const qs = planQueries(p, {});
    expect(qs[0]).toMatch(/Michelle Joy.*Cannons/);
    expect(qs.some(q => /instagram/i.test(q))).toBe(true);
  });

  test('bare artist gets official-site probe', () => {
    const p = parseTitleOverride('Central Cee');
    const qs = planQueries(p, {});
    expect(qs.some(q => /official site/i.test(q))).toBe(true);
  });

  test('prioritizes existing query_override', () => {
    const p = parseTitleOverride('Cannons');
    const qs = planQueries(p, { query_override: '"Cannons" band Los Angeles' });
    expect(qs[0]).toBe('"Cannons" band Los Angeles');
  });

  test('deduplicates queries case-insensitively', () => {
    const p = parseTitleOverride('Cannons');
    const qs = planQueries(p, { query_override: '"Cannons"' });
    const lc = qs.map(q => q.toLowerCase());
    expect(new Set(lc).size).toBe(lc.length);
  });

  test('empty title returns no queries', () => {
    expect(planQueries({ name: '' }, {})).toEqual([]);
  });
});

// ─── classifyUrl ────────────────────────────────────────────────────────────

describe('classifyUrl', () => {
  test.each([
    ['https://www.instagram.com/cannonsband/', 'instagram'],
    ['https://tiktok.com/@centralcee', 'tiktok'],
    ['https://x.com/central_cee', 'x'],
    ['https://twitter.com/central_cee', 'x'],
    ['https://youtube.com/@cannons', 'youtube'],
    ['https://open.spotify.com/artist/xyz', 'spotify'],
    ['https://en.wikipedia.org/wiki/Cannons', 'wikipedia'],
    ['https://cannons.band', 'web'],
    ['', 'unknown']
  ])('classifies %s → %s', (url, expected) => {
    expect(classifyUrl(url)).toBe(expected);
  });
});

// ─── buildEvidence ──────────────────────────────────────────────────────────

describe('buildEvidence', () => {
  test('trims long snippets and drops raw', () => {
    const evidence = buildEvidence([{
      query: 'test',
      knowledge: { title: 'Cannons', type: 'Band', description: 'x', url: 'https://cannons.band' },
      organic: [{
        title: 'a'.repeat(500),
        url: 'https://example.com',
        snippet: 'b'.repeat(500)
      }]
    }]);
    expect(evidence[0].organic[0].title.length).toBeLessThanOrEqual(300);
    expect(evidence[0].organic[0].snippet.length).toBeLessThanOrEqual(400);
    expect(evidence[0].organic[0].source_type).toBe('web');
  });
});

// ─── mergeProposal ──────────────────────────────────────────────────────────

describe('mergeProposal', () => {
  const emptyRow = { email: 'a@b.com', 'Title Override': 'Cannons' };

  test('accepts LLM values for empty fields', () => {
    const proposal = {
      full_name: 'Cannons',
      country: 'United States',
      profession_of_artist: 'Indie pop band',
      produced_works: ['Fire for You', 'Bad Dream'],
      media_affiliations: ['Columbia Records'],
      official_properties: {
        instagram_url: 'https://instagram.com/cannonsband/',
        official_site_url: 'https://cannonsband.com/'
      },
      sources: [{ url: 'https://instagram.com/cannonsband/', supports: ['identity'] }]
    };
    const parsed = parseTitleOverride('Cannons');
    const { row } = mergeProposal(emptyRow, proposal, parsed);
    expect(row.full_name).toBe('Cannons');
    expect(row.Country).toBe('United States');
    expect(row.produced_works).toBe('Fire for You, Bad Dream');
    expect(row.media_affiliations).toBe('Columbia Records');
    expect(row.instagram_url).toBe('https://instagram.com/cannonsband/');
    expect(row.official_site_url).toBe('https://cannonsband.com/');
  });

  test('does not overwrite user-supplied values, records audit', () => {
    const userRow = { ...emptyRow, full_name: 'Cannons (user override)', instagram_url: 'https://instagram.com/legacy/' };
    const proposal = {
      full_name: 'Cannons',
      official_properties: { instagram_url: 'https://instagram.com/cannonsband/' }
    };
    const parsed = parseTitleOverride('Cannons');
    const { row, audit } = mergeProposal(userRow, proposal, parsed);
    expect(row.full_name).toBe('Cannons (user override)');
    expect(row.instagram_url).toBe('https://instagram.com/legacy/');
    expect(audit.full_name.kept).toBe('user_supplied');
    expect(audit.instagram_url.kept).toBe('user_supplied');
  });

  test('preserves user-supplied query_override', () => {
    const userRow = { ...emptyRow, query_override: '"Cannons" band LA' };
    const proposal = { query_override: '"Cannons"' };
    const { row } = mergeProposal(userRow, proposal, parseTitleOverride('Cannons'));
    expect(row.query_override).toBe('"Cannons" band LA');
  });

  test('leaves query_override blank when user did not supply one', () => {
    const proposal = { query_override: 'ignored' };
    const parsed = parseTitleOverride('Michelle Joy (Cannons)');
    const { row } = mergeProposal(emptyRow, proposal, parsed);
    expect(row.query_override || '').toBe('');
  });
});

// ─── deriveEnrichmentStatus ────────────────────────────────────────────────

describe('deriveEnrichmentStatus', () => {
  test('valid_unique with no flag → enriched', () => {
    expect(deriveEnrichmentStatus({ title_quality_status: 'valid_unique' })).toBe('enriched');
  });
  test('valid_with_affiliation with flag → enriched_with_flags', () => {
    expect(deriveEnrichmentStatus({
      title_quality_status: 'valid_with_affiliation',
      flag_reason: 'Verified but confidence low'
    })).toBe('enriched_with_flags');
  });
  test('ambiguous → needs_review', () => {
    expect(deriveEnrichmentStatus({ title_quality_status: 'ambiguous' })).toBe('needs_review');
  });
  test('too_generic → needs_review', () => {
    expect(deriveEnrichmentStatus({ title_quality_status: 'too_generic' })).toBe('needs_review');
  });
  test('null → needs_review', () => {
    expect(deriveEnrichmentStatus({})).toBe('needs_review');
  });
});

// ─── processRow (with mocked SERP + LLM) ───────────────────────────────────

describe('processRow', () => {
  const origAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const origFetch = global.fetch;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    serp.search.mockReset();
    serp.search.mockResolvedValue({
      query: 'x',
      knowledge: null,
      organic: [{ title: 'Cannons band', url: 'https://cannonsband.com', snippet: 'Official site' }],
      related: [], people_also_ask: []
    });
  });
  afterEach(() => {
    global.fetch = origFetch;
    process.env.ANTHROPIC_API_KEY = origAnthropicKey;
  });

  test('empty Title Override → failed with EMPTY_TITLE', async () => {
    const result = await processRow('job', { original: { 'Title Override': '' } });
    expect(result.status).toBe('failed');
    expect(result.error).toBe('EMPTY_TITLE');
  });

  test('SERP all fail → failed with SERP_FAILED', async () => {
    serp.search.mockRejectedValue(Object.assign(new Error('down'), { code: 'SERP_UPSTREAM' }));
    const result = await processRow('job', { original: { 'Title Override': 'Cannons' } });
    expect(result.status).toBe('failed');
    expect(result.error).toBe('SERP_FAILED');
  });

  test('happy path → enriched with resolved fields', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      text: async () => JSON.stringify({
        model: 'claude-sonnet-4-5',
        content: [{
          type: 'tool_use', name: 'record_artist_enrichment',
          input: {
            entity_type: 'band',
            title_quality_status: 'valid_unique',
            flag_reason: null,
            full_name: 'Cannons',
            country: 'United States',
            profession_of_artist: 'Indie pop band',
            produced_works: ['Fire for You'],
            media_affiliations: ['Columbia Records'],
            official_properties: {
              instagram_url: 'https://instagram.com/cannonsband/',
              official_site_url: 'https://cannonsband.com/'
            },
            query_override: null,
            confidence: 0.9,
            summary: 'Cannons is an indie pop band from Los Angeles.',
            sources: [{ url: 'https://cannonsband.com/', source_type: 'web', supports: ['identity'] }]
          }
        }]
      })
    });
    const result = await processRow('job', {
      original: { email: 'a@b.com', 'Title Override': 'Cannons' }
    });
    expect(result.status).toBe('enriched');
    expect(result.enrichedRow.full_name).toBe('Cannons');
    expect(result.enrichedRow.instagram_url).toBe('https://instagram.com/cannonsband/');
    expect(result.enrichedRow.produced_works).toBe('Fire for You');
    expect(result.confidence).toBe(0.9);
  });

  test('LLM invalid response then repair success', async () => {
    let call = 0;
    global.fetch = jest.fn().mockImplementation(async () => ({
      ok: true, status: 200,
      text: async () => {
        call++;
        if (call === 1) return JSON.stringify({ content: [{ type: 'text', text: 'oops' }] });
        return JSON.stringify({
          content: [{
            type: 'tool_use', name: 'record_artist_enrichment',
            input: {
              entity_type: 'band',
              title_quality_status: 'valid_unique',
              produced_works: [],
              media_affiliations: [],
              official_properties: {},
              confidence: 0.6,
              summary: 'ok',
              sources: []
            }
          }]
        });
      }
    }));
    const result = await processRow('job', {
      original: { email: 'a@b.com', 'Title Override': 'Cannons' }
    });
    expect(result.status).toBe('enriched');
    expect(call).toBe(2);
  });

  test('LLM invalid twice → failed', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      text: async () => JSON.stringify({ content: [{ type: 'text', text: 'no tool' }] })
    });
    const result = await processRow('job', {
      original: { email: 'a@b.com', 'Title Override': 'Cannons' }
    });
    expect(result.status).toBe('failed');
    expect(result.flag_reason).toMatch(/twice/);
  });
});
