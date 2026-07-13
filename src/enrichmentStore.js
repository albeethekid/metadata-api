// File-based persistent store for artist-enrichment jobs.
//
// Layout under DATA_ROOT (default: <repo>/data/enrichment):
//
//   {jobId}/
//     job.json         Job metadata + counters (atomic overwrite).
//     original.csv     Verbatim uploaded file.
//     rows.jsonl       One JSON object per row. Rewritten as a whole on
//                      every update (rows are small; simpler than random-
//                      access editing). Index in file == row index.
//     sources.jsonl    One JSON object per source record. Append-only.
//
// This module is intentionally small and synchronous where it can be — the
// worker holds a per-job lock (`_jobLocks`) to serialize concurrent writes
// from the async pipeline.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_ROOT = process.env.ENRICHMENT_DATA_DIR ||
  path.join(__dirname, '..', 'data', 'enrichment');

function ensureRoot() {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
}
function jobDir(jobId) {
  return path.join(DATA_ROOT, jobId);
}
function jobPath(jobId, name) {
  return path.join(jobDir(jobId), name);
}

// Per-process serialization: prevent overlapping writes to the same job file.
const _jobLocks = new Map();
async function withLock(jobId, fn) {
  const prev = _jobLocks.get(jobId) || Promise.resolve();
  let release;
  const next = new Promise(res => { release = res; });
  _jobLocks.set(jobId, prev.then(() => next));
  try {
    await prev.catch(() => {});
    return await fn();
  } finally {
    release();
    // Clean up if we're at the tail of the queue.
    if (_jobLocks.get(jobId) === prev.then(() => next)) {
      _jobLocks.delete(jobId);
    }
  }
}

function newJobId() {
  return crypto.randomBytes(16).toString('hex');
}

function atomicWrite(target, contents) {
  const tmp = target + '.tmp-' + crypto.randomBytes(4).toString('hex');
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, target);
}

function safeReadJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
}

function safeReadLines(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw) return [];
    return raw.split('\n').filter(l => l.length > 0).map(l => JSON.parse(l));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Create a new job on disk.
 *
 * @param {object} params
 * @param {string} params.filename          Original filename (for display).
 * @param {string} params.originalCsv       Verbatim CSV text.
 * @param {string[]} params.detectedColumns Columns present in the upload.
 * @param {string[]} params.missingRequired Any missing required columns.
 * @param {object[]} params.rows            Parsed input rows (input columns).
 */
async function createJob(params) {
  ensureRoot();
  const id = newJobId();
  fs.mkdirSync(jobDir(id), { recursive: true });

  const now = new Date().toISOString();
  const job = {
    id,
    filename: params.filename || 'upload.csv',
    status: 'pending',           // pending | running | completed | cancelled | failed
    detectedColumns: params.detectedColumns || [],
    missingRequired: params.missingRequired || [],
    totalRows: params.rows.length,
    completedRows: 0,
    flaggedRows: 0,
    failedRows: 0,
    currentRowIndex: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    error: null,
    cancelRequested: false,
    limits: params.limits || null
  };

  atomicWrite(jobPath(id, 'original.csv'), params.originalCsv);
  atomicWrite(jobPath(id, 'job.json'), JSON.stringify(job, null, 2));

  const rowsJsonl = params.rows.map((r, idx) => JSON.stringify({
    rowIndex: idx,
    original: r,
    enriched: null,
    status: 'pending',           // pending | processing | enriched | enriched_with_flags | needs_review | failed
    title_quality_status: null,
    flag_reason: null,
    entity_type: null,
    confidence: null,
    summary: null,
    error: null,
    updatedAt: now
  })).join('\n');
  atomicWrite(jobPath(id, 'rows.jsonl'), rowsJsonl + (rowsJsonl ? '\n' : ''));
  // Sources file starts empty.
  atomicWrite(jobPath(id, 'sources.jsonl'), '');
  return job;
}

function getJob(jobId) {
  const j = safeReadJson(jobPath(jobId, 'job.json'), null);
  return j;
}

async function updateJob(jobId, patch) {
  return withLock(jobId, () => {
    const cur = getJob(jobId);
    if (!cur) throw new Error(`Job not found: ${jobId}`);
    const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    atomicWrite(jobPath(jobId, 'job.json'), JSON.stringify(next, null, 2));
    return next;
  });
}

function listRows(jobId) {
  return safeReadLines(jobPath(jobId, 'rows.jsonl'));
}

function getRow(jobId, rowIndex) {
  const rows = listRows(jobId);
  return rows.find(r => r.rowIndex === rowIndex) || null;
}

async function updateRow(jobId, rowIndex, patch) {
  return withLock(jobId, () => {
    const rows = listRows(jobId);
    const idx = rows.findIndex(r => r.rowIndex === rowIndex);
    if (idx === -1) throw new Error(`Row not found: ${jobId}#${rowIndex}`);
    const next = { ...rows[idx], ...patch, updatedAt: new Date().toISOString() };
    rows[idx] = next;
    const out = rows.map(r => JSON.stringify(r)).join('\n');
    atomicWrite(jobPath(jobId, 'rows.jsonl'), out + (out ? '\n' : ''));
    return next;
  });
}

async function appendSources(jobId, rowIndex, sources) {
  if (!Array.isArray(sources) || sources.length === 0) return;
  return withLock(jobId, () => {
    const ts = new Date().toISOString();
    const lines = sources.map(s => JSON.stringify({
      rowIndex,
      url: s.url || '',
      source_type: s.source_type || 'unknown',
      supports: Array.isArray(s.supports) ? s.supports : [],
      title: s.title || null,
      snippet: s.snippet || null,
      retrievedAt: s.retrievedAt || ts
    })).join('\n');
    fs.appendFileSync(jobPath(jobId, 'sources.jsonl'), lines + '\n');
  });
}

function listSources(jobId, rowIndex) {
  const all = safeReadLines(jobPath(jobId, 'sources.jsonl'));
  if (rowIndex == null) return all;
  return all.filter(s => s.rowIndex === rowIndex);
}

function listJobs() {
  ensureRoot();
  const ids = fs.readdirSync(DATA_ROOT).filter(name => {
    try {
      return fs.statSync(path.join(DATA_ROOT, name)).isDirectory();
    } catch (_) { return false; }
  });
  return ids.map(id => getJob(id)).filter(Boolean)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

function readOriginalCsv(jobId) {
  try {
    return fs.readFileSync(jobPath(jobId, 'original.csv'), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return '';
    throw e;
  }
}

// Called at startup to mark any job that was `running` before a crash/restart
// as `failed` — otherwise the UI would show an eternally-running job.
function reconcileOnStartup() {
  ensureRoot();
  const jobs = listJobs();
  for (const j of jobs) {
    if (j.status === 'running') {
      atomicWrite(jobPath(j.id, 'job.json'), JSON.stringify({
        ...j,
        status: 'failed',
        error: 'Interrupted by server restart. Use "Retry failed" to resume.',
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      }, null, 2));
    }
  }
}

module.exports = {
  DATA_ROOT,
  createJob,
  getJob,
  updateJob,
  listJobs,
  listRows,
  getRow,
  updateRow,
  appendSources,
  listSources,
  readOriginalCsv,
  reconcileOnStartup
};
