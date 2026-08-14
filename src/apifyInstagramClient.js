// ApifyInstagramClient — thin wrapper around Apify's `apify/instagram-scraper`
// actor for fetching a single Instagram post/reel's structured metadata.
//
// Usage:
//   const { fetchPost } = require('./apifyInstagramClient');
//   const post = await fetchPost('https://www.instagram.com/reels/C6Kg9FKt8lt/');
//
// Auth comes from APIFY_API_KEY (never logged, never included in errors).
// This is a standalone client, independent of the /api/instagram/video/apify
// route (which inlines its own copy of this same run+fetch sequence) — kept
// separate deliberately so this new client can't regress that route.

const fetch = require('node-fetch');

const ACTOR_ID = 'apify/instagram-scraper';
const DEFAULT_TIMEOUT_MS = 120000;

class ApifyInstagramError extends Error {
  constructor(message, { status, code, cause } = {}) {
    super(message);
    this.name = 'ApifyInstagramError';
    this.status = status || 502;
    this.code = code || 'APIFY_ERROR';
    if (cause) this.cause = cause;
  }
}

function getApiKey() {
  const key = (process.env.APIFY_API_KEY || '').trim();
  if (!key) {
    throw new ApifyInstagramError('APIFY_API_KEY is not set on the server.', {
      status: 503,
      code: 'APIFY_API_KEY_NOT_CONFIGURED'
    });
  }
  return key;
}

async function fetchWithAbort(url, opts, signal) {
  try {
    return await fetch(url, { ...opts, signal });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new ApifyInstagramError('Apify request timed out', { status: 504, code: 'APIFY_TIMEOUT' });
    }
    throw new ApifyInstagramError('Apify network error', { status: 502, code: 'APIFY_NETWORK', cause: error });
  }
}

/**
 * Run the apify/instagram-scraper actor for a single Instagram post/reel URL
 * and return its raw dataset item (may itself describe an unavailable post
 * via an `error`/`errorDescription` field — that's left for the caller to
 * interpret, not this client).
 *
 * @param {string} targetUrl  Canonical Instagram post/reel/tv URL.
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]  Request timeout for the whole run+fetch
 *   sequence, default 120000.
 * @returns {Promise<object>} the raw Apify dataset item
 */
async function fetchPost(targetUrl, opts = {}) {
  const apiKey = getApiKey();
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const runUrl = new URL(`https://api.apify.com/v2/acts/${encodeURIComponent(ACTOR_ID)}/runs`);
    runUrl.searchParams.set('token', apiKey);
    runUrl.searchParams.set('waitForFinish', '120');

    const runResp = await fetchWithAbort(runUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directUrls: [targetUrl], resultsType: 'posts' })
    }, controller.signal);

    const runText = await runResp.text();
    let runBody = null;
    try { runBody = runText ? JSON.parse(runText) : null; } catch (_) { runBody = null; }

    if (!runResp.ok) {
      throw new ApifyInstagramError(`Apify actor run failed (HTTP ${runResp.status})`, {
        status: 502,
        code: 'APIFY_RUN_FAILED'
      });
    }

    const datasetId = runBody?.data?.defaultDatasetId || runBody?.defaultDatasetId || null;
    if (!datasetId) {
      throw new ApifyInstagramError('Apify run did not return a dataset id', {
        status: 502,
        code: 'APIFY_NO_DATASET_ID'
      });
    }

    const itemsUrl = new URL(`https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items`);
    itemsUrl.searchParams.set('token', apiKey);
    itemsUrl.searchParams.set('clean', 'true');
    itemsUrl.searchParams.set('format', 'json');

    const itemsResp = await fetchWithAbort(itemsUrl.toString(), {}, controller.signal);
    const itemsText = await itemsResp.text();
    let itemsBody = null;
    try { itemsBody = itemsText ? JSON.parse(itemsText) : []; } catch (_) { itemsBody = []; }

    if (!itemsResp.ok) {
      throw new ApifyInstagramError(`Apify dataset fetch failed (HTTP ${itemsResp.status})`, {
        status: 502,
        code: 'APIFY_DATASET_FAILED'
      });
    }

    if (!Array.isArray(itemsBody) || itemsBody.length === 0) {
      throw new ApifyInstagramError('No data returned from Apify', {
        status: 404,
        code: 'POST_NOT_FOUND'
      });
    }

    return itemsBody[0];
  } finally {
    clearTimeout(t);
  }
}

module.exports = { fetchPost, ApifyInstagramError };
