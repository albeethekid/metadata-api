// Serper.dev SERP client — thin wrapper around https://google.serper.dev/search.
//
// Usage:
//   const { search } = require('./serpClient');
//   const results = await search('"Michelle Joy" Cannons', { num: 10 });
//
// Returns a normalized shape independent of the underlying provider so the
// enrichment worker only depends on this contract:
//
//   {
//     query, provider, took_ms,
//     knowledge: { title, type, description, url } | null,
//     organic: [{ title, url, snippet, position, site_links? }],
//     people_also_ask: [{ question, url? }],
//     related: [{ query }],
//     top_stories: [{ title, url, source, date? }],
//     raw: <verbatim JSON>
//   }

const DEFAULT_ENDPOINT = 'https://google.serper.dev/search';

class SerpError extends Error {
  constructor(message, { status, code, cause } = {}) {
    super(message);
    this.name = 'SerpError';
    this.status = status || 500;
    this.code = code || 'SERP_ERROR';
    if (cause) this.cause = cause;
  }
}

function getApiKey() {
  const key = (process.env.SERPER_API_KEY || '').trim();
  if (!key) {
    throw new SerpError('SERPER_API_KEY is not set on the server.', {
      status: 500,
      code: 'MISSING_SERPER_KEY'
    });
  }
  return key;
}

async function fetchWithTimeout(url, opts, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

function normalizeResponse(query, json, provider, tookMs) {
  const organic = Array.isArray(json.organic) ? json.organic.map((r, i) => ({
    title: r.title || '',
    url: r.link || r.url || '',
    snippet: r.snippet || '',
    position: r.position || (i + 1),
    site_links: Array.isArray(r.sitelinks)
      ? r.sitelinks.map(s => ({ title: s.title || '', url: s.link || '' }))
      : []
  })) : [];

  const kg = json.knowledgeGraph || null;
  const knowledge = kg ? {
    title: kg.title || '',
    type: kg.type || '',
    description: kg.description || '',
    url: kg.website || kg.descriptionLink || ''
  } : null;

  const people_also_ask = Array.isArray(json.peopleAlsoAsk)
    ? json.peopleAlsoAsk.map(p => ({ question: p.question || '', url: p.link || '' }))
    : [];

  const related = Array.isArray(json.relatedSearches)
    ? json.relatedSearches.map(r => ({ query: r.query || '' })).filter(r => r.query)
    : [];

  const top_stories = Array.isArray(json.topStories)
    ? json.topStories.map(s => ({
        title: s.title || '',
        url: s.link || '',
        source: s.source || '',
        date: s.date || ''
      }))
    : [];

  return {
    query,
    provider,
    took_ms: tookMs,
    knowledge,
    organic,
    people_also_ask,
    related,
    top_stories,
    raw: json
  };
}

/**
 * Run a Google search via Serper.dev.
 *
 * @param {string} query   Search phrase.
 * @param {object} [opts]
 * @param {number} [opts.num]        Max results (default 10).
 * @param {string} [opts.gl]         Country code (e.g. 'us').
 * @param {string} [opts.hl]         Language code (e.g. 'en').
 * @param {number} [opts.timeoutMs]  Request timeout, default 15000.
 * @param {number} [opts.retries]    Retries on 5xx / network errors, default 1.
 */
async function search(query, opts = {}) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    throw new SerpError('query is required', { status: 400, code: 'MISSING_QUERY' });
  }
  const num = Math.min(Math.max(1, opts.num || 10), 20);
  const timeoutMs = opts.timeoutMs || 15000;
  const maxRetries = opts.retries != null ? opts.retries : 1;
  const apiKey = getApiKey();

  const body = { q: query, num };
  if (opts.gl) body.gl = String(opts.gl).toLowerCase();
  if (opts.hl) body.hl = String(opts.hl).toLowerCase();

  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const started = Date.now();
    try {
      const r = await fetchWithTimeout(DEFAULT_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': apiKey
        },
        body: JSON.stringify(body)
      }, timeoutMs);

      const took = Date.now() - started;
      const text = await r.text();
      let json;
      try {
        json = text ? JSON.parse(text) : {};
      } catch (_) {
        json = {};
      }

      if (!r.ok) {
        const msg = (json && json.message) || `Serper.dev HTTP ${r.status}`;
        // Retry 5xx once; return a hard error on 4xx.
        if (r.status >= 500 && attempt < maxRetries) {
          lastErr = new SerpError(msg, { status: r.status, code: 'SERP_UPSTREAM' });
          continue;
        }
        throw new SerpError(msg, { status: r.status, code: 'SERP_UPSTREAM' });
      }
      return normalizeResponse(query, json, 'serper', took);
    } catch (e) {
      if (e && e.name === 'AbortError') {
        lastErr = new SerpError('Serper.dev request timed out', { status: 504, code: 'SERP_TIMEOUT' });
      } else if (e instanceof SerpError) {
        lastErr = e;
      } else {
        lastErr = new SerpError('Serper.dev network error: ' + (e && e.message ? e.message : String(e)), {
          status: 502, code: 'SERP_NETWORK', cause: e
        });
      }
      if (attempt >= maxRetries) throw lastErr;
    }
  }
  throw lastErr || new SerpError('SERP request failed', { code: 'SERP_ERROR' });
}

module.exports = { search, SerpError };
