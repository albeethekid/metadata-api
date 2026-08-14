// Checks a report row against a fixed reference Google Sheet of
// pre-authorized sources, to decide whether client_category_override
// should be set to "source_authorized".
//
// The reference sheet has 3 tabs:
//   - "handles by platform"  (columns: PLATFORM, HANDLE)
//   - "handles in URLs"      (column: URL — the handle is embedded in the URL)
//   - "domains"              (column: a domain or full URL)
//
// A row is authorized if either:
//   - its (platform, handle) appears in "handles by platform" or "handles in URLs", or
//   - its page_url's hostname matches (or is a subdomain of) an entry in "domains".

const { getSheetsClient } = require('./sheetsService');
const { deriveHandleFromUrl } = require('./urlProcessor');

const AUTHORIZED_SOURCES_SHEET_ID =
  process.env.AUTHORIZED_SOURCES_SHEET_ID || '1ywzW-DUhDm3XFTvipDcIQ27c-pJxQxrhKFN0WgIGnIY';

const HANDLES_BY_PLATFORM_TAB = 'handles by platform';
const HANDLES_IN_URLS_TAB = 'handles in URLs';
const DOMAINS_TAB = 'domains';

const CACHE_TTL_MS = 5 * 60 * 1000;

function normalizeHandle(h) {
  return String(h || '').trim().replace(/^@/, '').toLowerCase();
}

function extractHostname(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const host = new URL(s).hostname.toLowerCase().replace(/^www\./, '');
    return host || null;
  } catch (_) {
    return null;
  }
}

function addHandle(map, platform, handle) {
  const plat = String(platform || '').trim().toLowerCase();
  const h = normalizeHandle(handle);
  if (!plat || !h) return;
  if (!map.has(plat)) map.set(plat, new Set());
  map.get(plat).add(h);
}

// rows: raw values from the "handles by platform" tab, header row excluded.
function parseHandlesByPlatformRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    addHandle(map, row && row[0], row && row[1]);
  }
  return map;
}

// rows: raw values from the "handles in URLs" tab, header row excluded.
function parseHandlesInUrlsRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const url = row && row[0];
    if (!url) continue;
    const derived = deriveHandleFromUrl(url);
    if (derived) addHandle(map, derived.platform, derived.handle);
  }
  return map;
}

// rows: raw values from the "domains" tab. No header row is assumed (every
// row is a domain/URL) but a stray label without a dot (e.g. "DOMAIN") is
// still ignored defensively rather than treated as a real hostname.
function parseDomainsRows(rows) {
  const set = new Set();
  for (const row of rows || []) {
    const host = extractHostname(row && row[0]);
    if (host && host.includes('.')) set.add(host);
  }
  return set;
}

function mergeHandleMaps(a, b) {
  const merged = new Map(a);
  for (const [platform, handles] of b) {
    if (!merged.has(platform)) merged.set(platform, new Set());
    for (const h of handles) merged.get(platform).add(h);
  }
  return merged;
}

async function loadAuthorizationData() {
  const sheets = await getSheetsClient();
  const [byPlatformResp, inUrlsResp, domainsResp] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: AUTHORIZED_SOURCES_SHEET_ID, range: `'${HANDLES_BY_PLATFORM_TAB}'!A2:B` }),
    sheets.spreadsheets.values.get({ spreadsheetId: AUTHORIZED_SOURCES_SHEET_ID, range: `'${HANDLES_IN_URLS_TAB}'!A2:A` }),
    sheets.spreadsheets.values.get({ spreadsheetId: AUTHORIZED_SOURCES_SHEET_ID, range: `'${DOMAINS_TAB}'!A1:A` })
  ]);

  const handles = mergeHandleMaps(
    parseHandlesByPlatformRows(byPlatformResp.data.values),
    parseHandlesInUrlsRows(inUrlsResp.data.values)
  );
  const domains = parseDomainsRows(domainsResp.data.values);

  return { handles, domains };
}

let cache = null; // { data, loadedAt }
let inFlight = null;

async function getAuthorizationData() {
  const now = Date.now();
  if (cache && (now - cache.loadedAt) < CACHE_TTL_MS) return cache.data;
  if (inFlight) return inFlight;
  inFlight = loadAuthorizationData()
    .then(data => {
      cache = { data, loadedAt: Date.now() };
      inFlight = null;
      return data;
    })
    .catch(err => {
      inFlight = null;
      throw err;
    });
  return inFlight;
}

/**
 * @param {{platform:?string, channelHandle:?string, pageUrl:?string}} row
 * @returns {Promise<boolean>}
 */
async function isSourceAuthorized({ platform, channelHandle, pageUrl }) {
  try {
    const data = await getAuthorizationData();

    let checkPlatform = platform;
    let checkHandle = channelHandle;
    if (platform !== 'youtube' && platform !== 'instagram') {
      const derived = deriveHandleFromUrl(pageUrl);
      if (derived) {
        checkPlatform = derived.platform;
        checkHandle = derived.handle;
      }
    }
    if (checkPlatform && checkHandle) {
      const set = data.handles.get(String(checkPlatform).toLowerCase());
      if (set && set.has(normalizeHandle(checkHandle))) return true;
    }

    const host = extractHostname(pageUrl);
    if (host) {
      for (const domain of data.domains) {
        if (host === domain || host.endsWith(`.${domain}`)) return true;
      }
    }

    return false;
  } catch (e) {
    console.error('Source authorization check failed:', e.message);
    return false;
  }
}

module.exports = {
  isSourceAuthorized,
  AUTHORIZED_SOURCES_SHEET_ID,
  // exported for testing
  parseHandlesByPlatformRows,
  parseHandlesInUrlsRows,
  parseDomainsRows,
  normalizeHandle,
  extractHostname
};
