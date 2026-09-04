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
  ['title',          'title'],
  ['content_url',    'heroImageUrl'],
  ['handle',         'channelHandle'],
  ['duration',       'durationSeconds'],
  ['view_count',     'viewCount'],
  ['published_date', 'publishedAt'],
  ['like_count',     'likeCount'],
  ['comment_count',  'commentCount'],
  ['tagged_music',   'taggedMusic']
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
async function readReportTab(spreadsheetId, columnMap = COLUMN_MAP) {
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
  const finalRelevanceCol  = headerIndex['final_relevance'];
  const finalAuthorizedCol = headerIndex['final_authorized'];
  // Mapped columns actually present in this sheet — used to snapshot each
  // row's current values so the write step can skip cells that are already
  // populated instead of overwriting them with a fresh fetch.
  const mappedCols = columnMap.map(([sheetCol]) => sheetCol).filter(c => c in headerIndex);
  const rows = [];
  let skippedFiltered = 0;
  for (let i = 1; i < values.length; i++) {
    const rowVals = values[i] || [];
    const pageUrl = String(rowVals[pageUrlCol] || '').trim();
    if (!pageUrl) continue;
    // Skip rows already triaged: final_relevance=FALSE or final_authorized=TRUE.
    if (finalRelevanceCol !== undefined &&
        String(rowVals[finalRelevanceCol] || '').trim().toUpperCase() === 'FALSE') {
      skippedFiltered++;
      continue;
    }
    if (finalAuthorizedCol !== undefined &&
        String(rowVals[finalAuthorizedCol] || '').trim().toUpperCase() === 'TRUE') {
      skippedFiltered++;
      continue;
    }
    const existing = {};
    for (const c of mappedCols) existing[c] = String(rowVals[headerIndex[c]] || '').trim();
    rows.push({
      rowIndex: i + 1, // 1-based spreadsheet row number (header is row 1)
      pageUrl,
      existing
    });
  }

  return { spreadsheetId, headers, headerIndex, rows, skippedFiltered, tabs: tabsMeta };
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
 * is left untouched. Same for individual fields: a field that came back
 * null/empty from this fetch is skipped rather than written as blank, so
 * a transient upstream miss (e.g. a platform response missing a thumbnail
 * or description) can't clobber good data already in that cell. And when
 * `existing` is given, a field already populated in the Sheet is left
 * alone even if the fresh fetch has a (possibly different) value — this
 * tool only fills in blanks, it never overwrites what's already there.
 *
 * @param {?Object<string,string>} existing  current value per sheetCol
 *   (from readReportTab's per-row snapshot), or null/undefined to skip
 *   this check (e.g. callers that never captured a snapshot).
 */
const CLIENT_CATEGORY_OVERRIDE_HEADER = 'client_category_override';

function buildRowUpdates(rowIndex, headerIndex, normalized, existing, columnMap = COLUMN_MAP) {
  if (!normalized) return [];
  const data = [];
  for (const [sheetCol, normKey] of columnMap) {
    if (!(sheetCol in headerIndex)) continue;
    if (existing && existing[sheetCol]) continue; // already populated — never overwrite
    const v = normalized[normKey];
    if (v === '' || v == null) continue;
    const a1 = `${TAB_NAME}!${colLetter(headerIndex[sheetCol])}${rowIndex}`;
    data.push({ range: a1, values: [[String(v)]] });
  }
  // client_category_override may already hold a manually-entered value
  // unrelated to source authorization (it's a general override column) —
  // only ever write it when we have a positive value; never blank it out.
  if (normalized.clientCategoryOverride && CLIENT_CATEGORY_OVERRIDE_HEADER in headerIndex &&
      !(existing && existing[CLIENT_CATEGORY_OVERRIDE_HEADER])) {
    data.push({
      range: `${TAB_NAME}!${colLetter(headerIndex[CLIENT_CATEGORY_OVERRIDE_HEADER])}${rowIndex}`,
      values: [[String(normalized.clientCategoryOverride)]]
    });
  }
  return data;
}

/**
 * Snapshot a single row's current values for every mapped column present
 * in the Sheet, so a caller can pass it to buildRowUpdates and avoid
 * overwriting cells that are already populated.
 */
async function getExistingMappedValues(spreadsheetId, rowIndex, headerIndex, columnMap = COLUMN_MAP) {
  const sheets = await getSheetsClient();
  let resp;
  try {
    resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${TAB_NAME}!${rowIndex}:${rowIndex}`
    });
  } catch (e) {
    throw wrapApiError(e, 502);
  }
  const rowVals = (resp.data.values && resp.data.values[0]) || [];
  const existing = {};
  for (const [sheetCol] of columnMap) {
    if (!(sheetCol in headerIndex)) continue;
    existing[sheetCol] = String(rowVals[headerIndex[sheetCol]] || '').trim();
  }
  if (CLIENT_CATEGORY_OVERRIDE_HEADER in headerIndex) {
    existing[CLIENT_CATEGORY_OVERRIDE_HEADER] = String(rowVals[headerIndex[CLIENT_CATEGORY_OVERRIDE_HEADER]] || '').trim();
  }
  return existing;
}

/**
 * Write the mapped values back to the given row. Failures (no normalized)
 * are no-ops — the row is left untouched. Reads the row's current values
 * first so already-populated cells are never overwritten.
 * @param {string} spreadsheetId
 * @param {number} rowIndex            1-based row in the `report` tab
 * @param {Object<string,number>} headerIndex
 * @param {?Object} normalized         result of urlProcessor.normalizeResponse
 */
async function writeRowMappedValues(spreadsheetId, rowIndex, headerIndex, normalized) {
  const existing = await getExistingMappedValues(spreadsheetId, rowIndex, headerIndex);
  const data = buildRowUpdates(rowIndex, headerIndex, normalized, existing);
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
 * @param {Array<{rowIndex:number, normalized:?Object, existing:?Object<string,string>}>} rowOutputs
 *   `existing` is each row's pre-fetch snapshot from readReportTab, used to
 *   skip cells that are already populated instead of overwriting them.
 * @returns {Promise<{updated:number, rows:number}>}
 */
// `overrideRows` are rows whose main fetch failed (or whose URL wasn't even
// a recognized platform) but that were still flagged source_authorized —
// e.g. { rowIndex, clientCategoryOverride: 'source_authorized' }. These get
// a surgical single-column write, merged into the same batchUpdate call, so
// nothing else on that row is touched.
async function writeRowsBatch(spreadsheetId, headerIndex, rowOutputs, overrideRows, columnMap = COLUMN_MAP) {
  const rows = Array.isArray(rowOutputs) ? rowOutputs : [];
  const overrides = Array.isArray(overrideRows) ? overrideRows : [];
  if (rows.length === 0 && overrides.length === 0) {
    return { updated: 0, rows: 0 };
  }
  const data = [];
  for (const r of rows) {
    const updates = buildRowUpdates(r.rowIndex, headerIndex, r.normalized, r.existing, columnMap);
    for (const u of updates) data.push(u);
  }
  for (const o of overrides) {
    if (!o || !o.clientCategoryOverride || !(CLIENT_CATEGORY_OVERRIDE_HEADER in headerIndex)) continue;
    data.push({
      range: `${TAB_NAME}!${colLetter(headerIndex[CLIENT_CATEGORY_OVERRIDE_HEADER])}${o.rowIndex}`,
      values: [[String(o.clientCategoryOverride)]]
    });
  }
  if (data.length === 0) return { updated: 0, rows: rows.length };
  const sheets = await getSheetsClient();
  try {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'RAW', data }
    });
  } catch (e) {
    throw wrapApiError(e, 502);
  }
  return { updated: data.length, rows: rows.length };
}

/**
 * Generic per-cell writer. `edits` is an array of { rowIndex, header, value }.
 * Edits whose header is missing from `headerIndex` (or otherwise malformed)
 * are reported back via `skipped` instead of failing the whole batch.
 *
 * @returns {Promise<{ updated:number, skipped:Array<{edit:object, reason:string}> }>}
 */
async function writeCellsByHeader(spreadsheetId, headerIndex, edits) {
  if (!Array.isArray(edits) || edits.length === 0) {
    return { updated: 0, skipped: [] };
  }
  const data = [];
  const skipped = [];
  for (const e of edits) {
    if (!e || typeof e !== 'object') {
      skipped.push({ edit: e, reason: 'INVALID_EDIT' });
      continue;
    }
    const rowIndex = Number(e.rowIndex);
    if (!Number.isInteger(rowIndex) || rowIndex < 2) {
      skipped.push({ edit: e, reason: 'INVALID_ROW_INDEX' });
      continue;
    }
    if (!e.header || typeof e.header !== 'string') {
      skipped.push({ edit: e, reason: 'INVALID_HEADER' });
      continue;
    }
    if (!(e.header in headerIndex)) {
      skipped.push({ edit: e, reason: 'HEADER_NOT_FOUND' });
      continue;
    }
    const a1 = `${TAB_NAME}!${colLetter(headerIndex[e.header])}${rowIndex}`;
    const v = (e.value === '' || e.value == null) ? '' : String(e.value);
    data.push({ range: a1, values: [[v]] });
  }
  if (data.length === 0) return { updated: 0, skipped };
  const sheets = await getSheetsClient();
  try {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'USER_ENTERED', data }
    });
  } catch (e) {
    throw wrapApiError(e, 502);
  }
  return { updated: data.length, skipped };
}

/**
 * Add any of `columnNames` that isn't already in `headerIndex` as a new
 * column at the end of the `report` tab's header row (row 1). Idempotent:
 * names already present are left untouched (and their existing position
 * kept), so it's safe to call on every run.
 *
 * Google Sheets does NOT auto-expand a sheet's grid when a values write
 * lands beyond its current `gridProperties.columnCount` — it errors with
 * "Range exceeds grid limits" instead. So when the new columns would land
 * past the tab's current bounds, this grows the grid first via
 * `updateSheetProperties`, then writes the header names.
 *
 * @returns {Promise<{headers:string[], headerIndex:Object<string,number>, added:string[]}>}
 *   Updated headers/headerIndex reflecting the new columns — pass these on
 *   to buildRowUpdates/writeRowsBatch instead of the pre-call values.
 */
async function ensureColumns(spreadsheetId, headers, headerIndex, columnNames) {
  const toAdd = (columnNames || []).filter(c => !(c in headerIndex));
  if (toAdd.length === 0) return { headers: headers.slice(), headerIndex: { ...headerIndex }, added: [] };

  const newHeaders = headers.slice();
  const newHeaderIndex = { ...headerIndex };
  const data = [];
  for (const name of toAdd) {
    const colIdx = newHeaders.length; // 0-based, next open column
    data.push({ range: `${TAB_NAME}!${colLetter(colIdx)}1`, values: [[name]] });
    newHeaderIndex[name] = colIdx;
    newHeaders.push(name);
  }

  const sheets = await getSheetsClient();
  const neededColumnCount = newHeaders.length;

  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties(sheetId,title,gridProperties(columnCount))'
    });
    const reportSheet = (meta.data.sheets || []).find(s => s.properties && s.properties.title === TAB_NAME);
    const currentColumnCount = (reportSheet && reportSheet.properties.gridProperties && reportSheet.properties.gridProperties.columnCount) || 0;
    if (reportSheet && neededColumnCount > currentColumnCount) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            updateSheetProperties: {
              properties: {
                sheetId: reportSheet.properties.sheetId,
                gridProperties: { columnCount: neededColumnCount }
              },
              fields: 'gridProperties.columnCount'
            }
          }]
        }
      });
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'RAW', data }
    });
  } catch (e) {
    throw wrapApiError(e, 502);
  }
  return { headers: newHeaders, headerIndex: newHeaderIndex, added: toAdd };
}

module.exports = {
  TAB_NAME,
  PAGE_URL_HEADER,
  COLUMN_MAP,
  CLIENT_CATEGORY_OVERRIDE_HEADER,
  extractSpreadsheetId,
  readReportTab,
  readTabAsText,
  writeRowMappedValues,
  writeRowsBatch,
  writeCellsByHeader,
  buildRowUpdates,
  getExistingMappedValues,
  ensureColumns,
  colLetter,
  wrapApiError,
  getSheetsClient
};
