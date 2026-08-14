// Scraping provider abstraction — lets callers fetch a page's raw HTML
// through either ScrapingBee or the project's existing Oxylabs residential
// proxy, without depending on provider-specific request details.
//
//   fetchPageHtml(url, { provider: 'scrapingbee' | 'oxylabs' }) → html
//
// Each provider is responsible only for retrieving the page; parsing is
// handled elsewhere (e.g. tiktokMetadataParser.js) so it can be reused
// regardless of which provider fetched the HTML.

const fetch = require('node-fetch');
const scrapingBeeClient = require('./scrapingBeeClient');
const { getAxiosProxyConfig, isProxyEnabled } = require('./proxy-config');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const ACCEPT_LANGUAGE = 'en-US,en;q=0.9';

const SUPPORTED_PROVIDERS = ['scrapingbee', 'oxylabs'];
const DEFAULT_PROVIDER = 'scrapingbee';

class ScrapingProviderError extends Error {
  constructor(message, { status, code, cause } = {}) {
    super(message);
    this.name = 'ScrapingProviderError';
    this.status = status || 502;
    this.code = code || 'SCRAPING_PROVIDER_ERROR';
    if (cause) this.cause = cause;
  }
}

async function fetchViaOxylabsProxy(targetUrl, { timeoutMs = 20000 } = {}) {
  const proxyConfig = getAxiosProxyConfig('oxylabs', null);
  if (!proxyConfig || !isProxyEnabled(null)) {
    throw new ScrapingProviderError('Oxylabs credentials are not configured on the server.', {
      status: 500,
      code: 'MISSING_OXYLABS_CREDENTIALS'
    });
  }

  const HttpsProxyAgent = require('https-proxy-agent');
  const proxyUrl = `${proxyConfig.protocol}://${proxyConfig.auth.username}:${proxyConfig.auth.password}@${proxyConfig.host}:${proxyConfig.port}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': ACCEPT_LANGUAGE
      },
      agent: new HttpsProxyAgent(proxyUrl),
      signal: controller.signal
    });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new ScrapingProviderError('Oxylabs proxy request timed out', { status: 504, code: 'OXYLABS_TIMEOUT' });
    }
    throw new ScrapingProviderError('Oxylabs proxy network error', { status: 502, code: 'OXYLABS_NETWORK', cause: error });
  } finally {
    clearTimeout(t);
  }

  const html = await response.text();

  if (!response.ok) {
    throw new ScrapingProviderError(`Oxylabs proxy upstream request failed (HTTP ${response.status})`, {
      status: 502,
      code: 'OXYLABS_UPSTREAM_ERROR'
    });
  }

  if (!html) {
    throw new ScrapingProviderError('Oxylabs proxy returned an empty response', {
      status: 502,
      code: 'OXYLABS_EMPTY_RESPONSE'
    });
  }

  return html;
}

async function fetchViaScrapingBee(targetUrl, { timeoutMs } = {}) {
  try {
    const { html } = await scrapingBeeClient.fetchHtml(targetUrl, { timeoutMs });
    return html;
  } catch (error) {
    if (error instanceof scrapingBeeClient.ScrapingBeeError) {
      throw new ScrapingProviderError(error.message, { status: error.status, code: error.code, cause: error });
    }
    throw error;
  }
}

/**
 * Fetch a page's raw HTML through the given scraping provider.
 *
 * @param {string} targetUrl
 * @param {object} [opts]
 * @param {string} [opts.provider]   'scrapingbee' (default) or 'oxylabs'
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<string>} raw HTML
 */
async function fetchPageHtml(targetUrl, opts = {}) {
  const provider = opts.provider || DEFAULT_PROVIDER;

  if (provider === 'scrapingbee') {
    return fetchViaScrapingBee(targetUrl, opts);
  }

  if (provider === 'oxylabs') {
    return fetchViaOxylabsProxy(targetUrl, opts);
  }

  throw new ScrapingProviderError(`Unsupported scraping provider: ${provider}`, {
    status: 400,
    code: 'UNSUPPORTED_PROVIDER'
  });
}

module.exports = { fetchPageHtml, SUPPORTED_PROVIDERS, DEFAULT_PROVIDER, ScrapingProviderError };
