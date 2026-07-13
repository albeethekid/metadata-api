// Integration-lite tests for the Express /api/enrichment/* routes.
// Uses supertest against the exported app instance. SERP + LLM are mocked
// via the worker module.

const path = require('path');
const os = require('os');
const fs = require('fs');

// Isolate the data dir per-run so tests never touch real jobs.
const TMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'enrichment-test-'));
process.env.ENRICHMENT_DATA_DIR = TMP_DATA_DIR;
process.env.SERPER_API_KEY = 'test-serper';
process.env.ANTHROPIC_API_KEY = 'test-anthropic';

// Mock the worker so /start is a no-op that flips the job to `completed`.
jest.mock('../src/enrichmentWorker', () => {
  const actual = jest.requireActual('../src/enrichmentWorker');
  return {
    ...actual,
    runJob: jest.fn(async (jobId) => {
      const store = require('../src/enrichmentStore');
      const rows = store.listRows(jobId);
      for (const r of rows) {
        await store.updateRow(jobId, r.rowIndex, {
          status: 'enriched',
          title_quality_status: 'valid_unique',
          entity_type: 'band',
          confidence: 0.9,
          enriched: { row: { ...r.original, full_name: (r.original['Title Override'] || '') + ' (resolved)' }, audit: null }
        });
      }
      await store.updateJob(jobId, {
        status: 'completed', completedRows: rows.length,
        completedAt: new Date().toISOString()
      });
    }),
    isJobActive: jest.fn(() => false)
  };
});

// Supertest isn't in devDependencies; use http directly against the app.
const http = require('http');
const app = require('../src/index');

function serve(fn) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const { port } = server.address();
      fn(port).then(v => { server.close(); resolve(v); }).catch(e => { server.close(); reject(e); });
    });
  });
}

async function req(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body != null ? JSON.stringify(body) : null;
    const options = {
      hostname: '127.0.0.1', port, path, method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const req = http.request(options, res => {
      let chunks = '';
      res.on('data', c => { chunks += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = chunks ? JSON.parse(chunks) : null; } catch (_) { parsed = chunks; }
        resolve({ status: res.statusCode, body: parsed, raw: chunks });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function reqRaw(port, method, path) {
  return new Promise((resolve, reject) => {
    const options = { hostname: '127.0.0.1', port, path, method };
    const req = http.request(options, res => {
      let chunks = '';
      res.on('data', c => { chunks += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: chunks, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('/api/enrichment/* routes', () => {
  test('rejects non-CSV filename', async () => {
    await serve(async port => {
      const r = await req(port, 'POST', '/api/enrichment/upload', {
        csvText: 'email,Title Override\na@b.com,Cannons\n', filename: 'evil.exe'
      });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('INVALID_EXTENSION');
    });
  });

  test('rejects missing required column', async () => {
    await serve(async port => {
      const r = await req(port, 'POST', '/api/enrichment/upload', {
        csvText: 'email\na@b.com\n', filename: 'x.csv'
      });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('MISSING_REQUIRED_COLUMNS');
      expect(r.body.missingRequired).toEqual(['Title Override']);
    });
  });

  test('rejects empty CSV', async () => {
    await serve(async port => {
      const r = await req(port, 'POST', '/api/enrichment/upload', {
        csvText: 'email,Title Override\n', filename: 'x.csv'
      });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('EMPTY_CSV');
    });
  });

  test('rejects file over size limit', async () => {
    process.env.ENRICHMENT_MAX_BYTES = '512';
    // Re-require the app? No — the constant is read at route-handler call time.
    // But it was captured at module load. Skip this test-specific override
    // by using a huge synthetic payload against the default 2 MB limit.
    delete process.env.ENRICHMENT_MAX_BYTES;
    await serve(async port => {
      const bigVal = 'x'.repeat(3 * 1024 * 1024);
      const r = await req(port, 'POST', '/api/enrichment/upload', {
        csvText: `email,Title Override\na@b.com,${bigVal}\n`, filename: 'x.csv'
      });
      expect(r.status).toBe(413);
    });
  });

  test('template download works', async () => {
    await serve(async port => {
      const r = await reqRaw(port, 'GET', '/api/enrichment/template.csv');
      expect(r.status).toBe(200);
      expect(r.body.split('\n')[0]).toContain('Title Override');
      expect(r.headers['content-type']).toMatch(/csv/);
    });
  });

  test('end-to-end: upload → start → export full', async () => {
    await serve(async port => {
      const csv = 'email,Title Override\na@b.com,Cannons\nc@d.com,Central Cee\n';
      const up = await req(port, 'POST', '/api/enrichment/upload', { csvText: csv, filename: 'jobs.csv' });
      expect(up.status).toBe(200);
      const jobId = up.body.jobId;
      expect(up.body.totalRows).toBe(2);

      const started = await req(port, 'POST', `/api/enrichment/${jobId}/start`);
      expect(started.status).toBe(200);
      // Give the mocked worker its microtasks.
      await new Promise(r => setTimeout(r, 50));

      const job = await req(port, 'GET', `/api/enrichment/${jobId}`);
      expect(job.body.status).toBe('completed');

      const rows = await req(port, 'GET', `/api/enrichment/${jobId}/rows?filter=all`);
      expect(rows.body.rows).toHaveLength(2);
      expect(rows.body.rows[0].enriched.row.full_name).toContain('resolved');

      // Full export preserves canonical column order and appends review columns.
      const exp = await reqRaw(port, 'GET', `/api/enrichment/${jobId}/export?scope=full`);
      expect(exp.status).toBe(200);
      const header = exp.body.split('\n')[0].split(',');
      expect(header.slice(0, 6)).toEqual(['email','first_name','last_name','full_name','stage_name','Title Override']);
      expect(header).toContain('enrichment_status');
      expect(header).toContain('confidence');
    });
  });

  test('flagged / failed export scopes filter rows', async () => {
    await serve(async port => {
      const csv = 'email,Title Override\na@b.com,Cannons\nc@d.com,Central Cee\n';
      const up = await req(port, 'POST', '/api/enrichment/upload', { csvText: csv, filename: 'jobs.csv' });
      const jobId = up.body.jobId;
      await req(port, 'POST', `/api/enrichment/${jobId}/start`);
      await new Promise(r => setTimeout(r, 50));

      const flagged = await reqRaw(port, 'GET', `/api/enrichment/${jobId}/export?scope=flagged`);
      // Body has header row only (no rows are flagged in the mock).
      expect(flagged.status).toBe(200);
      const lines = flagged.body.trim().split('\n');
      expect(lines).toHaveLength(1);
    });
  });
});

afterAll(() => {
  try { fs.rmSync(TMP_DATA_DIR, { recursive: true, force: true }); } catch (_) {}
});
