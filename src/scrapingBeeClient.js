// ScrapingBee client — thin wrapper around the ScrapingBee HTML API.
// https://app.scrapingbee.com/api/v1/
//
// Usage:
//   const { fetchHtml } = require('./scrapingBeeClient');
//   const { html, status } = await fetchHtml('https://www.tiktok.com/@user/video/123');
//
// Auth comes from SCRAPINGBEE_API_KEY (never logged, never included in errors).

const fetch = require('node-fetch');

const SCRAPINGBEE_ENDPOINT = 'https://app.scrapingbee.com/api/v1/';

class ScrapingBeeError extends Error {
  constructor(message, { status, code, cause } = {}) {
    super(message);
    this.name = 'ScrapingBeeError';
    this.status = status || 502;
    this.code = code || 'SCRAPINGBEE_ERROR';
    if (cause) this.cause = cause;
  }
}

function getApiKey() {
  const key = (process.env.SCRAPINGBEE_API_KEY || '').trim();
  if (!key) {
    throw new ScrapingBeeError('SCRAPINGBEE_API_KEY is not set on the server.', {
      status: 500,
      code: 'MISSING_SCRAPINGBEE_KEY'
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

/**
 * Fetch a URL's HTML via ScrapingBee's HTML API.
 *
 * @param {string} targetUrl  The page to scrape.
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]  Request timeout, default 20000.
 * @param {object} [opts.params]    Extra ScrapingBee query params to pass
 *   through verbatim (e.g. { render_js: 'false', premium_proxy: 'true' }).
 * @returns {Promise<{ html: string, status: number }>}
 */
async function fetchHtml(targetUrl, opts = {}) {
  const apiKey = getApiKey();
  const timeoutMs = opts.timeoutMs || 20000;

  const requestUrl = new URL(SCRAPINGBEE_ENDPOINT);
  requestUrl.searchParams.set('url', targetUrl);
  if (opts.params && typeof opts.params === 'object') {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v !== undefined && v !== null) requestUrl.searchParams.set(k, String(v));
    }
  }

  let response;
  try {
    response = await fetchWithTimeout(requestUrl.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    }, timeoutMs);
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new ScrapingBeeError('ScrapingBee request timed out', { status: 504, code: 'SCRAPINGBEE_TIMEOUT' });
    }
    throw new ScrapingBeeError('ScrapingBee network error', { status: 502, code: 'SCRAPINGBEE_NETWORK', cause: error });
  }

  const html = await response.text();

  if (!response.ok) {
    throw new ScrapingBeeError(`ScrapingBee upstream request failed (HTTP ${response.status})`, {
      status: 502,
      code: 'SCRAPINGBEE_UPSTREAM_ERROR'
    });
  }

  if (!html) {
    throw new ScrapingBeeError('ScrapingBee returned an empty response', {
      status: 502,
      code: 'SCRAPINGBEE_EMPTY_RESPONSE'
    });
  }

  return { html, status: response.status };
}

module.exports = { fetchHtml, ScrapingBeeError };
