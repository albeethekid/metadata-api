// Google Sheets service helpers backing the Sheets Processor UI.
//
// Auth: uses GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY env vars (service
// account). The target Sheet must be shared with the service account
// email (Editor access) for both read and write to work.
//
// Conventions enforced by this module:
//   - Reads/writes happen exclusively on the tab named `report`
//   - The input URL column is `page_url`
//   - All other columns are matched by header name, never by index

const { google } = require('googleapis');

const TAB_NAME = 'report';
const PAGE_URL_HEADER = 'page_url';

// Mapping from spreadsheet header → key on the normalized response from
// urlProcessor.normalizeResponse(). Failures are NOT written to the sheet:
// rows whose URL could not be resolved are skipped entirely so existing
// cell content is never clobbered.
// Header-name based mapping (column position doesn't matter — columns
// are located by their row-1 header). Missing headers are silently skipped.
const COLUMN_MAP = [
  ['Title',          'title'],
  ['content_url',    'heroImageUrl'],
  ['likeness_match', 'channelHandle'],
  ['likeness_label', 'durationSeconds'],
  ['likeness_score', 'viewCount'],
  ['recommendation', 'publishedAt']
];

/**
 * Extract the spreadsheetId from any standard Google Sheets URL.
 * Examples:
 *   https://docs.google.com/spreadsheets/d/<ID>/edit#gid=0
 *   https://docs.google.com/spreadsheets/d/<ID>/
 * @returns {?string}
 */
function extractSpreadsheetId(sheetUrl) {
  if (!sheetUrl) return null;
  const m = String(sheetUrl).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

function getAuth() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !rawKey) {
    const err = new Error(
      'Missing GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY env vars. ' +
      'Set the service account credentials before using the Sheets Processor.'
    );
    err.status = 500;
    err.code = 'MISSING_GOOGLE_CREDENTIALS';
    throw err;
  }
  // Private keys stored in env vars typically have `\n` escape sequences
  // instead of real newlines — restore them before passing to JWT.
  const privateKey = rawKey.replace(/\\n/g, '\n');
  return new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    projectId: process.env.GOOGLE_PROJECT_ID || undefined
  });
}

let cachedAuth = null;
async function getSheetsClient() {
  if (!cachedAuth) cachedAuth = getAuth();
  return google.sheets({ version: 'v4', auth: cachedAuth });
}

// Convert a zero-based column index to A1 letter (0 -> A, 26 -> AA).
function colLetter(idx0) {
  let n = idx0 + 1, s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function wrapApiError(e, fallbackStatus = 500) {
  const status = (e && (e.code || e.status)) || fallbackStatus;
  if (status === 403 || status === 404) {
    const err = new Error(
      'Sheet not accessible. Share the Sheet with ' +
      `${process.env.GOOGLE_CLIENT_EMAIL || '<service account email>'} (Editor access) and try again.`
    );
    err.status = 403;
    err.code = 'SHEET_NOT_ACCESSIBLE';
    return err;
  }
  const err = new Error(`Google Sheets API error: ${e && e.message ? e.message : String(e)}`);
  err.status = typeof status === 'number' ? status : 500;
  err.code = 'SHEETS_API_ERROR';
  return err;
}

/**
 * Read the `report` tab. Validates that the tab and the `page_url` column
 * exist. Returns headers, a header→index map, and rows with a non-empty
 * `page_url`.
 *
 * Throws Error objects with `.status` and `.code` for clean API mapping:
 *   SHEET_NOT_ACCESSIBLE  → 403  (service account not shared in)
 *   TAB_NOT_FOUND         → 400
 *   TAB_EMPTY             → 400
 *   COLUMN_NOT_FOUND      → 400
 */
async function readReportTab(spreadsheetId) {
  const sheets = await getSheetsClient();

  let meta;
  try {
    meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties(title,gridProperties(rowCount,columnCount))'
    });
  } catch (e) {
    throw wrapApiError(e, 502);
  }

  const tabsMeta = (meta.data.sheets || []).map(s => ({
    title:       s.properties && s.properties.title,
    rowCount:    s.properties && s.properties.gridProperties && s.properties.gridProperties.rowCount    || 0,
    columnCount: s.properties && s.properties.gridProperties && s.properties.gridProperties.columnCount || 0
  })).filter(t => t.title);
  const tabs = tabsMeta.map(t => t.title);
  if (!tabs.includes(TAB_NAME)) {
    const err = new Error(
      `Tab "${TAB_NAME}" not found in this Sheet. Available tabs: ${tabs.join(', ') || '(none)'}`
    );
    err.status = 400;
    err.code = 'TAB_NOT_FOUND';
    throw err;
  }

  let resp;
  try {
    resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: TAB_NAME
    });
  } catch (e) {
    throw wrapApiError(e, 502);
  }

  const values = resp.data.values || [];
  if (values.length === 0) {
    const err = new Error(`Tab "${TAB_NAME}" is empty.`);
    err.status = 400;
    err.code = 'TAB_EMPTY';
    throw err;
  }

  const headers = values[0].map(h => String(h == null ? '' : h).trim());
  const headerIndex = {};
  headers.forEach((h, i) => { if (h && !(h in headerIndex)) headerIndex[h] = i; });

  if (!(PAGE_URL_HEADER in headerIndex)) {
    const err = new Error(
      `Column "${PAGE_URL_HEADER}" not found in the "${TAB_NAME}" tab. ` +
      `Found columns: ${headers.filter(Boolean).join(', ') || '(none)'}`
    );
    err.status = 400;
    err.code = 'COLUMN_NOT_FOUND';
    throw err;
  }

  const pageUrlCol = headerIndex[PAGE_URL_HEADER];
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const pageUrl = String((values[i] || [])[pageUrlCol] || '').trim();
    if (!pageUrl) continue;
    rows.push({
      rowIndex: i + 1, // 1-based spreadsheet row number (header is row 1)
      pageUrl
    });
  }

  return { spreadsheetId, headers, headerIndex, rows, tabs: tabsMeta };
}

/**
 * Read any tab and return it as a TSV-style text blob, capped at `maxBytes`.
 * Used to feed sheet context into the LLM. Header row is the first row.
 *
 * @returns {Promise<{text:string, rows:number, totalRows:number, columns:number, truncated:boolean, bytes:number}>}
 */
async function readTabAsText(spreadsheetId, tabName, opts = {}) {
  const maxBytes = Math.max(1024, opts.maxBytes || 60_000);
  const sheets = await getSheetsClient();
  let resp;
  try {
    resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: tabName });
  } catch (e) {
    throw wrapApiError(e, 502);
  }
  const values = resp.data.values || [];
  const lines = [];
  let bytes = 0;
  let truncated = false;
  let columns = 0;
  for (const row of values) {
    if (Array.isArray(row) && row.length > columns) columns = row.length;
    const line = (row || []).map(v => (v == null ? '' : String(v).replace(/\t/g, ' ').replace(/\r?\n/g, ' '))).join('\t');
    const lineBytes = Buffer.byteLength(line, 'utf8') + 1;
    if (bytes + lineBytes > maxBytes) {
      truncated = true;
      break;
    }
    lines.push(line);
    bytes += lineBytes;
  }
  return {
    text:      lines.join('\n'),
    rows:      lines.length,
    totalRows: values.length,
    columns,
    truncated,
    bytes
  };
}

/**
 * Build the per-cell update payload for one row. Columns are matched by
 * header name (column position doesn't matter). Headers missing from the
 * Sheet are silently skipped, so partial schemas are fine.
 *
 * Rows with no normalized payload produce zero updates — the existing row
 * is left untouched.
 */
function buildRowUpdates(rowIndex, headerIndex, normalized) {
  if (!normalized) return [];
  const data = [];
  for (const [sheetCol, normKey] of COLUMN_MAP) {
    if (!(sheetCol in headerIndex)) continue;
    const a1 = `${TAB_NAME}!${colLetter(headerIndex[sheetCol])}${rowIndex}`;
    const v = normalized[normKey];
    const cellValue = (v === '' || v == null) ? '' : String(v);
    data.push({ range: a1, values: [[cellValue]] });
  }
  return data;
}

/**
 * Write the mapped values back to the given row. Failures (no normalized)
 * are no-ops — the row is left untouched.
 * @param {string} spreadsheetId
 * @param {number} rowIndex            1-based row in the `report` tab
 * @param {Object<string,number>} headerIndex
 * @param {?Object} normalized         result of urlProcessor.normalizeResponse
 */
async function writeRowMappedValues(spreadsheetId, rowIndex, headerIndex, normalized) {
  const data = buildRowUpdates(rowIndex, headerIndex, normalized);
  if (data.length === 0) return { updated: 0 };
  const sheets = await getSheetsClient();
  try {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'RAW', data }
    });
  } catch (e) {
    throw wrapApiError(e, 502);
  }
  return { updated: data.length };
}

/**
 * Write many rows in a single Sheets API call. Each entry in `rowOutputs`
 * produces its own set of per-cell updates; they are merged into one
 * `values.batchUpdate` request, which is dramatically cheaper than calling
 * writeRowMappedValues per row (1 quota unit instead of N).
 *
 * Rows whose `normalized` is null are skipped silently (their cells are
 * left untouched on the Sheet), so failed/unsupported URLs don't clobber
 * existing data.
 *
 * @param {string} spreadsheetId
 * @param {Object<string,number>} headerIndex
 * @param {Array<{rowIndex:number, normalized:?Object}>} rowOutputs
 * @returns {Promise<{updated:number, rows:number}>}
 */
async function writeRowsBatch(spreadsheetId, headerIndex, rowOutputs) {
  if (!Array.isArray(rowOutputs) || rowOutputs.length === 0) {
    return { updated: 0, rows: 0 };
  }
  const data = [];
  for (const r of rowOutputs) {
    const updates = buildRowUpdates(r.rowIndex, headerIndex, r.normalized);
    for (const u of updates) data.push(u);
  }
  if (data.length === 0) return { updated: 0, rows: rowOutputs.length };
  const sheets = await getSheetsClient();
  try {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'RAW', data }
    });
  } catch (e) {
    throw wrapApiError(e, 502);
  }
  return { updated: data.length, rows: rowOutputs.length };
}

module.exports = {
  TAB_NAME,
  PAGE_URL_HEADER,
  COLUMN_MAP,
  extractSpreadsheetId,
  readReportTab,
  readTabAsText,
  writeRowMappedValues,
  writeRowsBatch
};
