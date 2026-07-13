// CSV parse/build helpers for the Artist Record Enrichment feature.
//
// Notes on the canonical schema:
//   - INPUT_COLUMNS is the exact required input/output ordering (including
//     "Title Override" and "Country" with their original casing/spacing).
//   - REVIEW_COLUMNS are appended after the input columns in the full-export
//     CSV. They are never interleaved with input columns.
//
// Formula injection: any exported cell that begins with `= + - @ \t \r`
// is prefixed with a single apostrophe. This matches the OWASP CSV
// injection guidance and is safe for Excel/Sheets/Numbers.

const INPUT_COLUMNS = [
  'email',
  'first_name',
  'last_name',
  'full_name',
  'stage_name',
  'Title Override',
  'Country',
  'profession_of_artist',
  'organization',
  'produced_works',
  'tiktok_url',
  'instagram_url',
  'x_url',
  'youtube_url',
  'facebook_url',
  'official_store_url',
  'official_site_url',
  'media_affiliations',
  'query_override'
];

const REQUIRED_COLUMNS = ['email', 'Title Override'];

const REVIEW_COLUMNS = [
  'enrichment_status',
  'title_quality_status',
  'flag_reason',
  'entity_type',
  'confidence',
  'source_urls'
];

const FULL_EXPORT_COLUMNS = [...INPUT_COLUMNS, ...REVIEW_COLUMNS];

// ─── Parsing ───────────────────────────────────────────────────────────────

// Robust CSV parser: handles quoted commas, embedded newlines, "" escapes,
// CRLF, UTF-8 BOM, and stray trailing whitespace on lines.
function parseCsv(text) {
  if (typeof text !== 'string') throw new Error('parseCsv: input must be a string');
  // Strip UTF-8 BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const rows = [];
  let cur = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < len && text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') { inQuotes = true; i += 1; continue; }
    if (ch === ',') { cur.push(field); field = ''; i += 1; continue; }
    if (ch === '\r') { i += 1; continue; }
    if (ch === '\n') {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = '';
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // Flush trailing field/row (if the file didn't end with a newline).
  if (field !== '' || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  if (rows.length === 0) return { headers: [], rows: [] };

  const headers = rows[0].map(h => (h || '').trim());
  const dataRows = [];
  for (let r = 1; r < rows.length; r++) {
    const raw = rows[r];
    // Skip fully-empty lines (no field has content).
    if (raw.every(v => v === '' || v == null)) continue;
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = raw[c] != null ? raw[c] : '';
    }
    dataRows.push(obj);
  }
  return { headers, rows: dataRows };
}

// ─── Building ──────────────────────────────────────────────────────────────

// CSV formula-injection guard. Any cell that begins with a "trigger" char is
// prefixed with a single quote so spreadsheet apps treat it as text.
function escapeFormula(value) {
  const s = value == null ? '' : String(value);
  if (!s.length) return s;
  const first = s.charAt(0);
  if (first === '=' || first === '+' || first === '-' || first === '@' ||
      first === '\t' || first === '\r') {
    return "'" + s;
  }
  return s;
}

function toCsvField(value) {
  const safe = escapeFormula(value);
  // Quote if it contains special chars OR starts/ends with whitespace.
  if (/[",\n\r]/.test(safe) || /^\s|\s$/.test(safe)) {
    return '"' + safe.replace(/"/g, '""') + '"';
  }
  return safe;
}

function buildCsv(columns, rows) {
  const header = columns.map(c => toCsvField(c)).join(',');
  const body = rows.map(row => columns.map(c => toCsvField(row[c])).join(',')).join('\n');
  return body ? header + '\n' + body + '\n' : header + '\n';
}

// Merge a joinable list (produced_works, media_affiliations, source_urls) with
// the app's chosen comma-delimited format:
//   Enjoy the Silence, Personal Jesus, Violator
// The whole field is CSV-quoted on export so commas inside items don't break
// parsing at the row level.
function joinList(list) {
  if (!Array.isArray(list)) return list == null ? '' : String(list);
  return list.filter(v => v != null && String(v).trim() !== '')
    .map(v => String(v).trim())
    .join(', ');
}

// ─── Sample template ───────────────────────────────────────────────────────

function sampleTemplateCsv() {
  const sample = {};
  INPUT_COLUMNS.forEach(c => { sample[c] = ''; });
  sample.email = 'you@example.com';
  sample['Title Override'] = 'Central Cee';
  return buildCsv(INPUT_COLUMNS, [
    sample,
    { ...sample, 'Title Override': 'Michelle Joy (Cannons)' },
    { ...sample, 'Title Override': 'Cannons' }
  ]);
}

// ─── Validation ────────────────────────────────────────────────────────────

// Returns { missingRequired: [], unknownColumns: [], present: [] } — the caller
// decides whether to reject or warn. Only 'email' and 'Title Override' are
// hard-required.
function validateHeaders(headers) {
  const missingRequired = REQUIRED_COLUMNS.filter(c => !headers.includes(c));
  const present = INPUT_COLUMNS.filter(c => headers.includes(c));
  const unknownColumns = headers.filter(h => h && !INPUT_COLUMNS.includes(h));
  return { missingRequired, unknownColumns, present };
}

module.exports = {
  INPUT_COLUMNS,
  REQUIRED_COLUMNS,
  REVIEW_COLUMNS,
  FULL_EXPORT_COLUMNS,
  parseCsv,
  buildCsv,
  toCsvField,
  escapeFormula,
  joinList,
  sampleTemplateCsv,
  validateHeaders
};
