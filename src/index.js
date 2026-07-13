require('dotenv').config();

const YouTubeClient = require('./youtubeClient');
const { getTranscript, TranscriptError, getDiagnostics } = require('./youtubeTranscript');
const { getTikTokVideoMetrics, TikTokMetricsError } = require('./tiktokMetrics');
const { getTikTokVideoMetricsYtdlp, TikTokYtdlpError } = require('./tiktokYtdlp');
const { scrapeInstagramPost } = require('./instagramScraper');
const { extractSpreadsheetId, readReportTab, readTabAsText, writeRowMappedValues, writeRowsBatch, writeCellsByHeader } = require('./sheetsService');
const { processUrl } = require('./urlProcessor');
const enrichmentCsv = require('./enrichmentCsv');
const enrichmentStore = require('./enrichmentStore');
const enrichmentWorker = require('./enrichmentWorker');
const fs = require('fs');
const path = require('path');
const express = require('express');
const app = express();
const port = process.env.PORT || 8080;

// Enough for a 2 MB upload plus JSON overhead. Kept tight so a stray
// giant paste can't fill the disk.
app.use(express.json({ limit: '4mb' }));
app.use(express.static('public'));

// Rebuild in-flight state on startup: any job left in `running` from a prior
// process is marked failed so the UI doesn't hang forever.
enrichmentStore.reconcileOnStartup();

const youtubeClient = new YouTubeClient();

// Helper: render HTML for debug view (screenshots + raw JSON)
function renderInstagramDebugHtml(payload) {
  const shots = (payload && payload.debug && payload.debug.screenshots) || {};
  const keys = Object.keys(shots);
  const escJson = JSON.stringify(payload, null, 2).replace(/</g, '\\u003c');
  const imgs = keys.map(k => `
    <div class="shot">
      <div class="label">${k}</div>
      <img src="${shots[k]}" alt="${k}" />
    </div>
  `).join('\n');
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Instagram Debug</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin: 24px; }
      h1 { font-size: 20px; margin: 0 0 12px; }
      .meta { margin-bottom: 16px; color: #444; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
      .shot { border: 1px solid #ddd; border-radius: 6px; padding: 8px; background: #fafafa; }
      .shot .label { font-size: 12px; color: #666; margin-bottom: 6px; }
      .shot img { max-width: 100%; height: auto; display: block; border-radius: 4px; }
      details { margin-top: 16px; }
      pre { white-space: pre-wrap; word-wrap: break-word; }
    </style>
  </head>
  <body>
    <h1>Instagram Scrape Debug</h1>
    <div class="meta">video_id: ${payload.video_id} • fetched_at: ${payload.fetched_at}</div>
    <div class="grid">${imgs || '<div class="shot"><div class="label">No screenshots captured</div></div>'}</div>
    <details>
      <summary>Raw JSON</summary>
      <pre>${escJson}</pre>
    </details>
  </body>
 </html>`;
}

app.get('/api/search', async (req, res) => {
  try {
    const { q, maxResults = 10 } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

// Helper: render HTML for debug view (screenshots + raw JSON)
function renderInstagramDebugHtml(payload) {
  const shots = (payload && payload.debug && payload.debug.screenshots) || {};
  const keys = Object.keys(shots);
  const escJson = JSON.stringify(payload, null, 2).replace(/</g, '\\u003c');
  const imgs = keys.map(k => `
    <div class="shot">
      <div class="label">${k}</div>
      <img src="${shots[k]}" alt="${k}" />
    </div>
  `).join('\n');
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Instagram Debug</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin: 24px; }
      h1 { font-size: 20px; margin: 0 0 12px; }
      .meta { margin-bottom: 16px; color: #444; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
      .shot { border: 1px solid #ddd; border-radius: 6px; padding: 8px; background: #fafafa; }
      .shot .label { font-size: 12px; color: #666; margin-bottom: 6px; }
      .shot img { max-width: 100%; height: auto; display: block; border-radius: 4px; }
      details { margin-top: 16px; }
      pre { white-space: pre-wrap; word-wrap: break-word; }
    </style>
  </head>
  <body>
    <h1>Instagram Scrape Debug</h1>
    <div class="meta">video_id: ${payload.video_id} • fetched_at: ${payload.fetched_at}</div>
    <div class="grid">${imgs || '<div class="shot"><div class="label">No screenshots captured</div></div>'}</div>
    <details>
      <summary>Raw JSON</summary>
      <pre>${escJson}</pre>
    </details>
  </body>
 </html>`;
}
    
    const results = await youtubeClient.searchVideos(q, parseInt(maxResults));
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/search/channels', async (req, res) => {
  try {
    const { q, maxResults = 10 } = req.query;
    const verbose = req.query.verbose === '1';
    
    if (!q) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }
    
    const results = await youtubeClient.searchChannels(q, parseInt(maxResults));
    
    // Return full data if verbose mode
    if (verbose) {
      return res.json(results);
    }
    
    // Simplified response by default
    const simplified = results.map(item => {
      const channelId = item.id.channelId;
      const handle = item.handle;
      
      return {
        channelName: item.snippet.title,
        channelUrl: handle ? `https://www.youtube.com/${handle}` : `https://www.youtube.com/channel/${channelId}`,
        channelHandle: handle || null,
        thumbnailUrl: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url,
        description: item.snippet.description,
        subscriberCount: item.statistics?.subscriberCount || null,
        videoCount: item.statistics?.videoCount || null
      };
    });
    
    res.json(simplified);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/video/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const verbose = req.query.verbose === '1';
    
    const videoDetails = await youtubeClient.getVideoDetails(videoId);
    
    if (verbose) {
      return res.json(videoDetails);
    }
    
    // Compact response format
    const compact = {
      videoId: videoId,
      title: videoDetails.snippet?.title || null,
      publishedAt: videoDetails.snippet?.publishedAt || null,
      durationIso: videoDetails.contentDetails?.duration || null,
      durationSeconds: parseDurationToSeconds(videoDetails.contentDetails?.duration) || null,
      viewCount: parseInt(videoDetails.statistics?.viewCount) || null,
      likeCount: parseInt(videoDetails.statistics?.likeCount) || null,
      commentCount: parseInt(videoDetails.statistics?.commentCount) || null,
      engagement: {
        likeRate: calculateRate(parseInt(videoDetails.statistics?.likeCount), parseInt(videoDetails.statistics?.viewCount)),
        commentRate: calculateRate(parseInt(videoDetails.statistics?.commentCount), parseInt(videoDetails.statistics?.viewCount))
      },
      heroImageUrl: getHeroImageUrl(videoDetails.snippet?.thumbnails),
      channelHandle: videoDetails.channel?.handle || null
    };
    
    res.json(compact);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper function to parse ISO 8601 duration to seconds
function parseDurationToSeconds(duration) {
  if (!duration) return null;
  
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return null;
  
  const hours = parseInt(match[1]) || 0;
  const minutes = parseInt(match[2]) || 0;
  const seconds = parseInt(match[3]) || 0;
  
  return hours * 3600 + minutes * 60 + seconds;
}

// Helper function to calculate engagement rates
function calculateRate(count, viewCount) {
  if (!count || !viewCount || viewCount === 0) return null;
  return parseFloat((count / viewCount).toFixed(4));
}

// Helper function to get hero image URL
function getHeroImageUrl(thumbnails) {
  if (!thumbnails) return null;
  
  return thumbnails.maxres?.url ||
         thumbnails.standard?.url ||
         thumbnails.high?.url ||
         thumbnails.medium?.url ||
         thumbnails.default?.url ||
         null;
}

app.get('/api/channel/:channelId/videos', async (req, res) => {
  try {
    const { channelId } = req.params;
    const { maxResults = 10 } = req.query;
    const videos = await youtubeClient.getChannelVideos(channelId, parseInt(maxResults));
    res.json(videos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/trending', async (req, res) => {
  try {
    const { regionCode = 'US', maxResults = 10 } = req.query;
    const trending = await youtubeClient.getTrendingVideos(regionCode, parseInt(maxResults));
    res.json(trending);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/video/:videoId/comments', async (req, res) => {
  try {
    const { videoId } = req.params;
    const { maxResults = 20 } = req.query;
    const comments = await youtubeClient.getVideoComments(videoId, parseInt(maxResults));
    res.json(comments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/channel/:channelId', async (req, res) => {
  try {
    const { channelId } = req.params;
    const channelDetails = await youtubeClient.getChannelDetails(channelId);
    res.json(channelDetails);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper: score a playlist item for sibling relevance
function scoreVideoForSiblings(item, query, sourceTitle, sourceDescription) {
  const rawTitle = item.snippet?.title || '';
  const rawDescription = item.snippet?.description || '';
  const title = rawTitle.toLowerCase();
  const description = rawDescription.toLowerCase();
  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);

  let score = 0;
  const reasons = [];

  // 1. Exact query phrase in title (strongest signal)
  if (queryTerms.length > 0 && title.includes(queryLower)) {
    score += 50;
    reasons.push('exact query match in title');
  } else if (queryTerms.length > 0) {
    const titleMatches = queryTerms.filter(t => title.includes(t));
    if (titleMatches.length > 0) {
      score += Math.round(30 * (titleMatches.length / queryTerms.length));
      reasons.push('query match in title');
    }
  }

  // 2. Chapter / series pattern in title
  if (/\b(chapter|part|vol\.?|volume|ep\.?|episode|book|section|pt\.?)\s*[.#-]?\s*\d+/i.test(rawTitle)) {
    score += 25;
    reasons.push('chapter pattern match');
  }

  // 3. Query terms in description
  if (queryTerms.length > 0) {
    const descMatches = queryTerms.filter(t => description.includes(t));
    if (descMatches.length >= Math.ceil(queryTerms.length * 0.5)) {
      score += 10;
      reasons.push('query match in description');
    }
  }

  // 4. Source title word overlap
  if (sourceTitle) {
    const sourceTitleTerms = sourceTitle.toLowerCase().split(/\s+/).filter(t => t.length > 3);
    if (sourceTitleTerms.length > 0) {
      const overlap = sourceTitleTerms.filter(t => title.includes(t));
      if (overlap.length >= Math.ceil(sourceTitleTerms.length * 0.4)) {
        score += 15;
        reasons.push('title similarity to source');
      }
    }
  }

  // 5. Source description keyword overlap
  if (sourceDescription) {
    const sourceDescTerms = [...new Set(
      sourceDescription.toLowerCase().split(/\W+/).filter(t => t.length > 4)
    )].slice(0, 20);
    if (sourceDescTerms.length > 0) {
      const overlap = sourceDescTerms.filter(t => description.includes(t) || title.includes(t));
      if (overlap.length >= 3) {
        score += 10;
        reasons.push('description similarity to source');
      }
    }
  }

  return { score: Math.min(score, 100), reasons };
}

app.get('/api/youtube/discover-siblings', async (req, res) => {
  const channelId = (req.query.channelId || '').trim();
  const query = (req.query.query || '').trim();
  const maxResultsRaw = req.query.maxResults != null ? parseInt(req.query.maxResults, 10) : 100;
  const minScoreRaw = req.query.minScore != null ? parseInt(req.query.minScore, 10) : 40;
  let sourceVideoId = (req.query.sourceVideoId || '').trim() || null;
  const sourceTitle = (req.query.sourceTitle || '').trim() || null;
  const sourceDescription = (req.query.sourceDescription || '').trim() || null;

  if (!channelId) {
    return res.status(400).json({ error: 'Query param `channelId` is required.' });
  }
  if (!query) {
    return res.status(400).json({ error: 'Query param `query` is required.' });
  }

  const maxResults = Math.min(Math.max(isNaN(maxResultsRaw) ? 100 : maxResultsRaw, 1), 300);
  const minScore = Math.min(Math.max(isNaN(minScoreRaw) ? 0 : minScoreRaw, 0), 100);

  try {
    // 1. Fetch channel snippet + contentDetails (for uploadsPlaylistId)
    const channelData = await youtubeClient.getChannelContentDetails(channelId);
    if (!channelData) {
      return res.status(404).json({ error: 'Channel not found', channelId });
    }

    const uploadsPlaylistId = channelData.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) {
      return res.status(502).json({ error: 'Could not determine uploads playlist for channel', channelId });
    }

    // 2. Paginate through uploads playlist up to maxResults
    const playlistItems = await youtubeClient.getPlaylistItemsAll(uploadsPlaylistId, maxResults);

    // 3. Score each candidate
    const matches = [];
    for (const item of playlistItems) {
      const videoId = item.snippet?.resourceId?.videoId;
      if (!videoId) continue;
      if (sourceVideoId && videoId === sourceVideoId) continue;

      const { score, reasons } = scoreVideoForSiblings(item, query, sourceTitle, sourceDescription);
      if (score < minScore) continue;

      const thumbnails = item.snippet?.thumbnails || {};
      matches.push({
        videoId,
        title: item.snippet?.title || null,
        description: item.snippet?.description || null,
        publishedAt: item.snippet?.publishedAt || null,
        channelId: item.snippet?.channelId || channelId,
        channelTitle: item.snippet?.channelTitle || channelData.snippet?.title || null,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnailUrl:
          thumbnails.high?.url ||
          thumbnails.medium?.url ||
          thumbnails.default?.url ||
          null,
        score,
        scoreReasons: reasons
      });
    }

    matches.sort((a, b) => b.score - a.score);

    return res.json({
      platform: 'youtube',
      query,
      channel: {
        channelId,
        title: channelData.snippet?.title || null,
        uploadsPlaylistId
      },
      summary: {
        candidatesScanned: playlistItems.length,
        matchesReturned: matches.length
      },
      matches
    });
  } catch (error) {
    console.error('discover-siblings error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Extract a YouTube videoId from common URL shapes:
//   youtube.com/watch?v=ID, youtu.be/ID, youtube.com/shorts/ID, youtube.com/embed/ID
function extractYouTubeVideoIdFromUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      return u.pathname.split('/').filter(Boolean)[0] || null;
    }
    if (host.endsWith('youtube.com')) {
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const parts = u.pathname.split('/').filter(Boolean);
      if ((parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') && parts[1]) {
        return parts[1];
      }
    }
  } catch (_) {}
  return null;
}

// GET /api/youtube/transcript?videoId=... or ?url=...&lang=en&proxy=false
app.get('/api/youtube/transcript', async (req, res) => {
  const urlParam = (req.query.url || '').trim() || null;
  let videoId   = (req.query.videoId || '').trim() || null;
  const lang    = (req.query.lang || 'en').trim() || 'en';

  // proxy=false|0 disables Oxylabs proxy; otherwise default-on (if credentials exist)
  let useProxy = null;
  if (req.query.proxy !== undefined) {
    useProxy = req.query.proxy !== 'false' && req.query.proxy !== '0';
  }

  if (!videoId && urlParam) {
    videoId = extractYouTubeVideoIdFromUrl(urlParam);
  }

  if (!videoId || !/^[\w-]{6,15}$/.test(videoId)) {
    return res.status(400).json({
      error: 'Invalid request',
      detail: 'Provide a valid `videoId` or a YouTube `url` (watch, youtu.be, shorts).'
    });
  }

  const debug = req.query.debug === '1' || req.query.debug === 'true';

  try {
    const { language, isGenerated, segments, proxyInfo } = await getTranscript(videoId, lang, useProxy);

    // Concatenated plain text, truncated to 100k chars
    const MAX_TEXT_LEN = 100_000;
    const joined = segments.map(s => s.text).join(' ');
    const text   = joined.length > MAX_TEXT_LEN ? joined.slice(0, MAX_TEXT_LEN) : joined;

    const payload = {
      platform: 'youtube',
      videoId,
      language,
      isGenerated,
      segmentCount: segments.length,
      text,
      segments
    };
    if (debug) payload._debug = { proxy: proxyInfo };
    return res.json(payload);
  } catch (error) {
    const proxyInfo = (error && error.proxyInfo) || null;
    if (error instanceof TranscriptError) {
      const body = { error: error.message, code: error.code, videoId, _debug: { proxy: proxyInfo } };
      // 404: transcript missing/disabled/empty/video unavailable
      if (
        error.code === 'TRANSCRIPTS_DISABLED' ||
        error.code === 'NO_TRANSCRIPT' ||
        error.code === 'TRANSCRIPT_EMPTY' ||
        error.code === 'VIDEO_UNAVAILABLE'
      ) {
        return res.status(404).json(body);
      }
      // 502: upstream failure (fetch/parse)
      if (
        error.code === 'WATCH_PAGE_FAILED' ||
        error.code === 'TRANSCRIPT_FETCH_FAILED' ||
        error.code === 'PARSE_FAILED'
      ) {
        return res.status(502).json(body);
      }
    }
    console.error('transcript error:', error);
    return res.status(500).json({ error: error.message, videoId, _debug: { proxy: proxyInfo } });
  }
});

// Diagnostic: returns yt-dlp version + available impersonate targets so we
// can verify curl_cffi is loaded and chrome variants are advertised.
// Gated behind ENABLE_DIAG=1 since the response leaks internals (sys.path,
// package locations). 404 when disabled so the endpoint isn't discoverable.
app.get('/api/youtube/transcript/diag', async (req, res) => {
  if (process.env.ENABLE_DIAG !== '1') {
    return res.status(404).json({ error: 'Not found' });
  }
  try {
    const diag = await getDiagnostics();
    return res.json(diag);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── Google Sheets Processor ─────────────────────────────────────────────
// Backs public/sheets.html. The UI calls preflight once to validate the
// Sheet and discover rows, then calls process-row per row to fetch metadata
// (via the same backend endpoints CSV Generator uses) and write results
// back into the `report` tab.

// POST { sheetUrl }
//   → { spreadsheetId, headers, headerIndex, rows: [{ rowIndex, pageUrl }, ...] }
app.post('/api/sheets/preflight', async (req, res) => {
  const sheetUrl = req.body && req.body.sheetUrl;
  if (!sheetUrl) {
    return res.status(400).json({ error: 'MISSING_SHEET_URL', message: 'Field "sheetUrl" is required.' });
  }
  const spreadsheetId = extractSpreadsheetId(sheetUrl);
  if (!spreadsheetId) {
    return res.status(400).json({
      error: 'INVALID_SHEET_URL',
      message: 'Could not extract a spreadsheetId from this URL. Expected a https://docs.google.com/spreadsheets/d/<id>/... URL.'
    });
  }
  try {
    const result = await readReportTab(spreadsheetId);
    return res.json(result);
  } catch (e) {
    return res.status(e.status || 500).json({
      error: e.code || 'PREFLIGHT_FAILED',
      message: e.message
    });
  }
});

// POST { pageUrl, rowIndex?, includeScreenshots? }
//   → { ok, rowIndex, platform, normalized, error?, message? }
// Fetch ONLY: runs the URL through the same CSV-Generator endpoints, returns
// the normalized object. No Sheet I/O. Lets the UI parallelize fetches and
// then flush writes in chunks via /api/sheets/write-rows (1 quota unit per
// chunk instead of per row).
//
// Always 200 — per-row failures arrive as `ok: false` with `error`/`message`
// so a batch can keep going.
app.post('/api/sheets/fetch-row', async (req, res) => {
  const { pageUrl, rowIndex, includeScreenshots } = req.body || {};
  if (!pageUrl) {
    return res.status(400).json({ error: 'MISSING_FIELDS', message: 'pageUrl is required.' });
  }
  const result = await processUrl(pageUrl, {
    includeScreenshots: includeScreenshots !== false  // default true
  });
  return res.json({
    ok: result.ok,
    rowIndex: rowIndex || null,
    platform: result.platform,
    normalized: result.normalized,
    error: result.ok ? null : result.error,
    message: result.ok ? null : result.message
  });
});

// POST { spreadsheetId, headerIndex, rows: [{ rowIndex, normalized }] }
//   → { updated, rows }
// Writes many rows back to the Sheet in ONE Sheets API call (values.batchUpdate).
// Use this after collecting N results client-side via /api/sheets/fetch-row.
app.post('/api/sheets/write-rows', async (req, res) => {
  const { spreadsheetId, headerIndex, rows } = req.body || {};
  if (!spreadsheetId || !headerIndex || !Array.isArray(rows)) {
    return res.status(400).json({
      error: 'MISSING_FIELDS',
      message: 'spreadsheetId, headerIndex and rows[] are required.'
    });
  }
  if (rows.length === 0) {
    return res.json({ updated: 0, rows: 0 });
  }
  try {
    const result = await writeRowsBatch(spreadsheetId, headerIndex, rows);
    return res.json(result);
  } catch (e) {
    return res.status(e.status || 500).json({
      error: e.code || 'WRITE_FAILED',
      message: e.message
    });
  }
});

// POST { sheetUrl, prompt, includeTabs?: string[], writeBack?: boolean }
//   → { answer, model, usage, includedTabs, truncatedTabs, contextBytes,
//       cellsWritten:[{rowIndex,header,value}], cellsSkipped:[...], iterations }
// Ask Claude a question about the contents of the Sheet. The `report` tab is
// always included; tabs listed in includeTabs are appended as extra context.
//
// When writeBack=true, Claude is given an `update_report_cells` tool and an
// agentic loop runs (up to MAX_ITER turns), executing each tool call against
// the report tab via writeCellsByHeader and feeding the results back into the
// conversation until Claude stops emitting tool_use blocks.
app.post('/api/sheets/ask', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'MISSING_ANTHROPIC_KEY',
      message: 'ANTHROPIC_API_KEY is not set on the server.'
    });
  }
  const { sheetUrl, prompt, includeTabs, writeBack } = req.body || {};
  if (!sheetUrl || !prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({
      error: 'MISSING_FIELDS',
      message: 'sheetUrl and a non-empty prompt are required.'
    });
  }
  const spreadsheetId = extractSpreadsheetId(sheetUrl);
  if (!spreadsheetId) {
    return res.status(400).json({
      error: 'BAD_SHEET_URL',
      message: 'Could not extract spreadsheetId from sheetUrl.'
    });
  }

  // Always include the report tab; merge with optional extras (deduped, order preserved).
  const requestedTabs = ['report'];
  if (Array.isArray(includeTabs)) {
    for (const t of includeTabs) {
      if (typeof t === 'string' && t && !requestedTabs.includes(t)) requestedTabs.push(t);
    }
  }

  // For tool-use we need the report tab's header → column index map.
  let reportHeaderIndex = null;
  let reportHeaders = [];
  if (writeBack) {
    try {
      const r = await readReportTab(spreadsheetId);
      reportHeaderIndex = r.headerIndex;
      reportHeaders = r.headers.filter(Boolean);
    } catch (e) {
      return res.status(e.status || 500).json({
        error: e.code || 'SHEET_READ_FAILED',
        message: e.message
      });
    }
  }

  const PER_TAB_BYTES = 80_000;
  const TOTAL_MAX_BYTES = 240_000;
  const tabContexts = [];
  const truncatedTabs = [];
  let totalBytes = 0;

  try {
    for (const tab of requestedTabs) {
      const remaining = TOTAL_MAX_BYTES - totalBytes;
      if (remaining < 1024) {
        truncatedTabs.push(tab);
        tabContexts.push(`=== Tab: ${tab} ===\n(omitted — total context budget reached)`);
        continue;
      }
      const cap = Math.min(PER_TAB_BYTES, remaining);
      const r = await readTabAsText(spreadsheetId, tab, { maxBytes: cap });
      totalBytes += r.bytes;
      const rowNote = r.truncated
        ? `${r.rows} of ${r.totalRows} rows shown (truncated)`
        : `${r.rows} row${r.rows === 1 ? '' : 's'}`;
      tabContexts.push(`=== Tab: ${tab} (${rowNote}) ===\n${r.text}`);
      if (r.truncated) truncatedTabs.push(tab);
    }
  } catch (e) {
    return res.status(e.status || 500).json({
      error: e.code || 'SHEET_READ_FAILED',
      message: e.message
    });
  }

  let systemPrompt =
    `You are a data analyst evaluating rows from a Google Sheet on behalf of the user. ` +
    `Be concise, specific, and cite row numbers / column values when they support an answer. ` +
    `If the data is insufficient to answer, say so explicitly rather than guessing. ` +
    `Each tab is provided as TSV. The first line of each tab is the header row. ` +
    `Row numbers in the data correspond to 1-based spreadsheet row numbers (header is row 1, first data row is row 2).\n\n`;
  if (writeBack) {
    systemPrompt +=
      `When the user asks you to record evaluations, statuses, scores, labels, or any other ` +
      `value into a column of the report tab, you MUST use the \`update_report_cells\` tool to ` +
      `write the values directly. Do not just describe what you would write \u2014 actually call the tool. ` +
      `Batch many edits into a single tool call when possible. The exact set of writable headers in ` +
      `the report tab is: ${reportHeaders.join(', ')}. ` +
      `If the user references a header that is not in that list, do not invent a column \u2014 ` +
      `tell the user the column doesn't exist and stop.\n\n`;
  }
  systemPrompt += tabContexts.join('\n\n');

  const tools = writeBack ? [{
    name: 'update_report_cells',
    description:
      'Write values to specific cells in the `report` tab of the Google Sheet. Use this whenever the ' +
      'user asks you to populate, mark, label, score, or otherwise modify cells. Send as many edits ' +
      'in a single call as possible (one edit per cell).',
    input_schema: {
      type: 'object',
      properties: {
        edits: {
          type: 'array',
          description: 'List of cell edits to apply atomically.',
          items: {
            type: 'object',
            properties: {
              rowIndex: { type: 'integer', description: '1-based spreadsheet row number (header is row 1, first data row is row 2).' },
              header:   { type: 'string',  description: 'Exact header name in row 1 of the report tab. Must be one of: ' + reportHeaders.join(', ') },
              value:    { type: 'string',  description: 'Cell value to write. Use an empty string to clear.' }
            },
            required: ['rowIndex', 'header', 'value']
          }
        }
      },
      required: ['edits']
    }
  }] : null;

  const messages = [{ role: 'user', content: prompt }];
  const cellsWritten = [];
  const cellsSkipped = [];
  let answer = '';
  let lastUsage = null;
  let lastModel = 'claude-sonnet-4-5';
  let iterations = 0;

  const MAX_ITER = 8;
  const MAX_CELLS = 2000;
  const collectedText = [];

  try {
    while (iterations < MAX_ITER) {
      iterations += 1;
      const apiBody = {
        model:      'claude-sonnet-4-5',
        max_tokens: 4096,
        system:     systemPrompt,
        messages
      };
      if (tools) apiBody.tools = tools;

      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':     'application/json',
          'x-api-key':        apiKey,
          'anthropic-version':'2023-06-01'
        },
        body: JSON.stringify(apiBody)
      });
      const reply = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.status(r.status).json({
          error:   'ANTHROPIC_ERROR',
          message: (reply && reply.error && reply.error.message) || JSON.stringify(reply).slice(0, 500)
        });
      }
      lastUsage = reply.usage || lastUsage;
      lastModel = reply.model || lastModel;

      // Capture any text the assistant produced this turn (often present even alongside tool_use).
      for (const block of reply.content || []) {
        if (block.type === 'text' && block.text) collectedText.push(block.text);
      }

      // Append assistant message verbatim so tool_use IDs round-trip correctly.
      messages.push({ role: 'assistant', content: reply.content || [] });

      if (reply.stop_reason !== 'tool_use') {
        answer = collectedText.join('\n').trim();
        break;
      }

      // Execute every tool_use block, accumulating tool_result blocks.
      const toolResults = [];
      for (const block of reply.content || []) {
        if (block.type !== 'tool_use') continue;
        if (block.name !== 'update_report_cells') {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            is_error: true,
            content: `Unknown tool: ${block.name}`
          });
          continue;
        }
        const edits = (block.input && Array.isArray(block.input.edits)) ? block.input.edits : [];
        const remaining = MAX_CELLS - cellsWritten.length;
        const accepted  = edits.slice(0, Math.max(0, remaining));
        const dropped   = edits.length - accepted.length;
        try {
          const result = await writeCellsByHeader(spreadsheetId, reportHeaderIndex, accepted);
          const skippedKeys = new Set(result.skipped.map(s => `${s.edit && s.edit.rowIndex}|${s.edit && s.edit.header}`));
          for (const e of accepted) {
            const k = `${e.rowIndex}|${e.header}`;
            if (skippedKeys.has(k)) continue;
            cellsWritten.push({ rowIndex: e.rowIndex, header: e.header, value: e.value == null ? '' : String(e.value) });
          }
          for (const s of result.skipped) cellsSkipped.push(s);
          let summary = `Wrote ${result.updated} cell${result.updated === 1 ? '' : 's'}.`;
          if (result.skipped.length) {
            summary += ` Skipped ${result.skipped.length}: ` +
              result.skipped.slice(0, 5).map(s => `${s.reason} (row ${s.edit && s.edit.rowIndex}, header "${s.edit && s.edit.header}")`).join('; ');
          }
          if (dropped > 0) {
            summary += ` Dropped ${dropped} additional edits — global cell-write budget (${MAX_CELLS}) reached.`;
          }
          summary += ` Available report headers: ${reportHeaders.join(', ')}.`;
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: summary });
        } catch (e) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            is_error: true,
            content: `Sheet write failed: ${e.message}`
          });
        }
      }

      messages.push({ role: 'user', content: toolResults });
    }

    if (!answer) {
      answer = collectedText.join('\n').trim() ||
        '(stopped after maximum tool-use iterations without a final answer)';
    }
  } catch (e) {
    return res.status(502).json({ error: 'ANTHROPIC_FETCH_FAILED', message: e.message });
  }

  return res.json({
    answer,
    model:         lastModel,
    usage:         lastUsage,
    includedTabs:  requestedTabs,
    truncatedTabs,
    contextBytes:  totalBytes,
    iterations,
    cellsWritten,
    cellsSkipped
  });
});

// POST { spreadsheetId, rowIndex, pageUrl, headerIndex, includeScreenshots? }
//   → { ok, rowIndex, platform, error?, message? }
// Legacy single-shot path: fetch + write in one call. Kept for ad-hoc /
// scripted use. The Sheets Processor UI now uses fetch-row + write-rows
// to batch writes.
app.post('/api/sheets/process-row', async (req, res) => {
  const { spreadsheetId, rowIndex, pageUrl, headerIndex, includeScreenshots } = req.body || {};
  if (!spreadsheetId || !rowIndex || !pageUrl || !headerIndex) {
    return res.status(400).json({
      error: 'MISSING_FIELDS',
      message: 'spreadsheetId, rowIndex, pageUrl and headerIndex are all required.'
    });
  }

  const result = await processUrl(pageUrl, {
    includeScreenshots: includeScreenshots !== false
  });

  // Failures are no-ops on the Sheet — leave the existing row untouched.
  try {
    if (result.ok) {
      await writeRowMappedValues(spreadsheetId, rowIndex, headerIndex, result.normalized);
    }
  } catch (e) {
    return res.status(e.status || 500).json({
      ok: false,
      rowIndex,
      error: e.code || 'WRITE_FAILED',
      message: e.message
    });
  }

  return res.json({
    ok: result.ok,
    rowIndex,
    platform: result.platform,
    error: result.ok ? null : result.error,
    message: result.ok ? null : result.message
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Artist Record Enrichment
// ═══════════════════════════════════════════════════════════════════════════
//
// Flow:
//   1. Client POSTs CSV text to /api/enrichment/upload → { jobId, preview }
//   2. Client POSTs /api/enrichment/:jobId/start → worker begins
//   3. Client polls /api/enrichment/:jobId + /:jobId/rows for progress
//   4. Client downloads /api/enrichment/:jobId/export?scope=full|flagged|failed
//
// Ownership: no auth in this app. Job IDs are 128-bit random; only someone
// with the URL can view/download. This matches how other tools in this repo
// operate (open API + unguessable IDs).
//
// Data lives on disk under data/enrichment/{jobId}/. Nothing is stored in a
// database.

const ENRICHMENT_MAX_ROWS = parseInt(process.env.ENRICHMENT_MAX_ROWS || '500', 10);
const ENRICHMENT_MAX_BYTES = parseInt(process.env.ENRICHMENT_MAX_BYTES || String(2 * 1024 * 1024), 10);
const ENRICHMENT_MAX_TITLE_LEN = 500;

// GET /api/enrichment/template.csv → sample template download.
app.get('/api/enrichment/template.csv', (req, res) => {
  const csv = enrichmentCsv.sampleTemplateCsv();
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="artist-enrichment-template.csv"');
  res.send(csv);
});

// POST /api/enrichment/upload
//   { csvText, filename? }
// →  { jobId, filename, totalRows, detectedColumns, missingRequired, unknownColumns,
//      preview: [first 10 rows], warnings, limits }
app.post('/api/enrichment/upload', async (req, res) => {
  try {
    const { csvText, filename } = req.body || {};
    if (typeof csvText !== 'string' || !csvText.length) {
      return res.status(400).json({ error: 'MISSING_CSV', message: 'csvText is required.' });
    }
    // Byte-size guard (UTF-8).
    const bytes = Buffer.byteLength(csvText, 'utf8');
    if (bytes > ENRICHMENT_MAX_BYTES) {
      return res.status(413).json({
        error: 'FILE_TOO_LARGE',
        message: `CSV exceeds the ${(ENRICHMENT_MAX_BYTES / (1024 * 1024)).toFixed(1)} MB limit (${(bytes / (1024 * 1024)).toFixed(2)} MB uploaded).`
      });
    }
    // Filename hygiene.
    const safeName = (filename || 'upload.csv')
      .toString()
      .replace(/[^\w.\- ]+/g, '_')
      .slice(0, 120);
    if (!/\.csv$/i.test(safeName)) {
      return res.status(400).json({
        error: 'INVALID_EXTENSION',
        message: 'Only .csv files are accepted.'
      });
    }

    let parsed;
    try {
      parsed = enrichmentCsv.parseCsv(csvText);
    } catch (e) {
      return res.status(400).json({ error: 'MALFORMED_CSV', message: e.message });
    }
    const validation = enrichmentCsv.validateHeaders(parsed.headers);
    if (validation.missingRequired.length > 0) {
      return res.status(400).json({
        error: 'MISSING_REQUIRED_COLUMNS',
        message: `Missing required columns: ${validation.missingRequired.join(', ')}`,
        missingRequired: validation.missingRequired,
        detectedColumns: parsed.headers
      });
    }
    if (parsed.rows.length === 0) {
      return res.status(400).json({ error: 'EMPTY_CSV', message: 'CSV has no data rows.' });
    }
    if (parsed.rows.length > ENRICHMENT_MAX_ROWS) {
      return res.status(413).json({
        error: 'TOO_MANY_ROWS',
        message: `CSV has ${parsed.rows.length} rows; the current limit is ${ENRICHMENT_MAX_ROWS}.`
      });
    }
    // Trim absurd Title Override values.
    for (const r of parsed.rows) {
      if (r['Title Override'] && r['Title Override'].length > ENRICHMENT_MAX_TITLE_LEN) {
        r['Title Override'] = r['Title Override'].slice(0, ENRICHMENT_MAX_TITLE_LEN);
      }
    }

    const job = await enrichmentStore.createJob({
      filename: safeName,
      originalCsv: csvText,
      detectedColumns: parsed.headers,
      missingRequired: validation.missingRequired,
      rows: parsed.rows,
      limits: {
        maxRows: ENRICHMENT_MAX_ROWS,
        maxBytes: ENRICHMENT_MAX_BYTES
      }
    });

    return res.json({
      jobId: job.id,
      filename: job.filename,
      totalRows: job.totalRows,
      detectedColumns: parsed.headers,
      missingRequired: validation.missingRequired,
      unknownColumns: validation.unknownColumns,
      preview: parsed.rows.slice(0, 10),
      limits: job.limits,
      warnings: validation.unknownColumns.length
        ? [`Ignoring unknown columns: ${validation.unknownColumns.join(', ')}`]
        : []
    });
  } catch (e) {
    return res.status(500).json({ error: 'UPLOAD_FAILED', message: e.message });
  }
});

// GET /api/enrichment  → list all jobs (most recent first)
app.get('/api/enrichment', (req, res) => {
  const jobs = enrichmentStore.listJobs().map(j => ({
    id: j.id,
    filename: j.filename,
    status: j.status,
    totalRows: j.totalRows,
    completedRows: j.completedRows,
    flaggedRows: j.flaggedRows,
    failedRows: j.failedRows,
    createdAt: j.createdAt,
    completedAt: j.completedAt
  }));
  return res.json({ jobs });
});

// GET /api/enrichment/:jobId  → job metadata + progress
app.get('/api/enrichment/:jobId', (req, res) => {
  const job = enrichmentStore.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'JOB_NOT_FOUND' });
  return res.json({
    ...job,
    active: enrichmentWorker.isJobActive(job.id)
  });
});

// GET /api/enrichment/:jobId/rows?filter=all|enriched|flagged|needs_review|failed&search=...
// →  { rows: [...] }  (each row already contains original + enriched)
app.get('/api/enrichment/:jobId/rows', (req, res) => {
  const job = enrichmentStore.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'JOB_NOT_FOUND' });

  const filter = (req.query.filter || 'all').toString();
  const search = (req.query.search || '').toString().trim().toLowerCase();

  let rows = enrichmentStore.listRows(job.id);
  if (filter === 'enriched') {
    rows = rows.filter(r => r.status === 'enriched' || r.status === 'enriched_with_flags');
  } else if (filter === 'flagged') {
    rows = rows.filter(r => r.status === 'enriched_with_flags' || r.status === 'needs_review');
  } else if (filter === 'needs_review') {
    rows = rows.filter(r => r.status === 'needs_review');
  } else if (filter === 'failed') {
    rows = rows.filter(r => r.status === 'failed');
  }
  if (search) {
    rows = rows.filter(r => {
      const o = r.original || {};
      const e = (r.enriched && r.enriched.row) || {};
      const hay = [
        o['Title Override'], o.full_name, o.stage_name, o.organization,
        e['Title Override'], e.full_name, e.stage_name, e.organization
      ].map(v => (v || '').toString().toLowerCase()).join('\n');
      return hay.includes(search);
    });
  }
  return res.json({ rows, total: rows.length });
});

// GET /api/enrichment/:jobId/rows/:rowIndex  → single row + sources
app.get('/api/enrichment/:jobId/rows/:rowIndex', (req, res) => {
  const job = enrichmentStore.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'JOB_NOT_FOUND' });
  const idx = parseInt(req.params.rowIndex, 10);
  const row = enrichmentStore.getRow(job.id, idx);
  if (!row) return res.status(404).json({ error: 'ROW_NOT_FOUND' });
  const sources = enrichmentStore.listSources(job.id, idx);
  return res.json({ row, sources });
});

// POST /api/enrichment/:jobId/start
//   { concurrency?, maxSerpPerRow?, model? }
// →  { started: true, status }
app.post('/api/enrichment/:jobId/start', async (req, res) => {
  const job = enrichmentStore.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'JOB_NOT_FOUND' });
  if (!process.env.SERPER_API_KEY) {
    return res.status(500).json({ error: 'MISSING_SERPER_KEY', message: 'SERPER_API_KEY is not set on the server.' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'MISSING_ANTHROPIC_KEY', message: 'ANTHROPIC_API_KEY is not set on the server.' });
  }
  if (enrichmentWorker.isJobActive(job.id)) {
    return res.status(409).json({ error: 'ALREADY_RUNNING', message: 'Job is already running.' });
  }
  if (job.status === 'completed' || job.status === 'cancelled') {
    return res.status(409).json({ error: 'JOB_TERMINAL', message: 'Job already finished; use /retry to re-run failed rows.' });
  }

  const opts = {};
  if (req.body && Number.isFinite(req.body.concurrency)) opts.concurrency = req.body.concurrency;
  if (req.body && Number.isFinite(req.body.maxSerpPerRow)) opts.maxSerpPerRow = req.body.maxSerpPerRow;
  if (req.body && typeof req.body.model === 'string' && req.body.model) opts.model = req.body.model;

  // Fire-and-forget; the client polls for progress. Errors are captured in
  // the job.error field by the worker.
  enrichmentWorker.runJob(job.id, opts).catch(err => {
    console.error(`[enrichment] job ${job.id} failed:`, err && err.message);
  });
  const now = enrichmentStore.getJob(job.id);
  return res.json({ started: true, status: now.status });
});

// POST /api/enrichment/:jobId/cancel  → cooperatively stops processing
app.post('/api/enrichment/:jobId/cancel', async (req, res) => {
  const job = enrichmentStore.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'JOB_NOT_FOUND' });
  await enrichmentStore.updateJob(job.id, { cancelRequested: true });
  return res.json({ cancelRequested: true });
});

// POST /api/enrichment/:jobId/retry
//   { scope: 'failed' | 'flagged' | 'all' | 'rows', rowIndexes?: number[] }
// Re-runs the specified subset. Retries are additive — the worker only
// overwrites successful data if the new run succeeds.
app.post('/api/enrichment/:jobId/retry', async (req, res) => {
  const job = enrichmentStore.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'JOB_NOT_FOUND' });
  if (enrichmentWorker.isJobActive(job.id)) {
    return res.status(409).json({ error: 'ALREADY_RUNNING' });
  }
  const scope = (req.body && req.body.scope) || 'failed';
  const rows = enrichmentStore.listRows(job.id);
  let targets;
  if (scope === 'rows' && Array.isArray(req.body.rowIndexes)) {
    targets = req.body.rowIndexes;
  } else if (scope === 'flagged') {
    targets = rows.filter(r => r.status === 'enriched_with_flags' || r.status === 'needs_review').map(r => r.rowIndex);
  } else if (scope === 'all') {
    targets = rows.map(r => r.rowIndex);
  } else {
    targets = rows.filter(r => r.status === 'failed').map(r => r.rowIndex);
  }
  if (targets.length === 0) {
    return res.json({ started: false, message: 'No rows match the retry scope.' });
  }
  // Reset those rows to `pending` so counters bump correctly on completion.
  for (const idx of targets) {
    await enrichmentStore.updateRow(job.id, idx, { status: 'pending', error: null });
  }
  // Don't double-count on retries — subtract those from the aggregate counters.
  const cur = enrichmentStore.getJob(job.id);
  const rowMap = new Map(rows.map(r => [r.rowIndex, r]));
  let failedDelta = 0, flaggedDelta = 0, completedDelta = 0;
  for (const idx of targets) {
    const r = rowMap.get(idx);
    if (!r) continue;
    if (r.status === 'failed') failedDelta++;
    if (r.status === 'enriched_with_flags' || r.status === 'needs_review') flaggedDelta++;
    if (r.status !== 'pending' && r.status !== 'processing') completedDelta++;
  }
  await enrichmentStore.updateJob(job.id, {
    failedRows: Math.max(0, (cur.failedRows || 0) - failedDelta),
    flaggedRows: Math.max(0, (cur.flaggedRows || 0) - flaggedDelta),
    completedRows: Math.max(0, (cur.completedRows || 0) - completedDelta),
    status: 'pending',
    completedAt: null,
    error: null
  });

  enrichmentWorker.runJob(job.id, { retryRowIndexes: targets }).catch(err => {
    console.error(`[enrichment] job ${job.id} retry failed:`, err && err.message);
  });
  return res.json({ started: true, count: targets.length });
});

// GET /api/enrichment/:jobId/export?scope=full|flagged|failed|review
// → text/csv download
app.get('/api/enrichment/:jobId/export', (req, res) => {
  const job = enrichmentStore.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'JOB_NOT_FOUND' });
  const scope = (req.query.scope || 'full').toString();
  const rows = enrichmentStore.listRows(job.id);

  let selected;
  if (scope === 'flagged') {
    selected = rows.filter(r => r.status === 'enriched_with_flags' || r.status === 'needs_review');
  } else if (scope === 'failed') {
    selected = rows.filter(r => r.status === 'failed');
  } else {
    selected = rows;
  }

  const columns = enrichmentCsv.FULL_EXPORT_COLUMNS;
  const csvRows = selected.map(r => {
    const base = (r.enriched && r.enriched.row) || r.original || {};
    const row = {};
    for (const col of enrichmentCsv.INPUT_COLUMNS) row[col] = base[col] || '';
    row.enrichment_status = r.status || '';
    row.title_quality_status = r.title_quality_status || '';
    row.flag_reason = r.flag_reason || '';
    row.entity_type = r.entity_type || '';
    row.confidence = r.confidence != null ? r.confidence.toFixed(2) : '';
    const sources = enrichmentStore.listSources(job.id, r.rowIndex);
    row.source_urls = enrichmentCsv.joinList(sources.map(s => s.url).filter(Boolean));
    return row;
  });
  const csv = enrichmentCsv.buildCsv(columns, csvRows);
  const filename = `enriched-${scope}-${job.id.slice(0, 8)}.csv`;
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(csv);
});

// curl "http://localhost:3000/api/tiktok/video/metrics?url=https%3A%2F%2Fwww.tiktok.com%2F%40yaroslavslonsky%2Fvideo%2F7568246874558237965"
app.get('/api/tiktok/video/metrics', async (req, res) => {
  const { url } = req.query;
  const verbose = req.query.verbose === '1';
  const debugProxy = req.query.debugProxy === '1';

  // Parse proxy parameter: defaults to enabled (null), can be disabled with proxy=false or proxy=0
  let useProxy = null; // null means use default (enabled if credentials exist)
  if (req.query.proxy !== undefined) {
    useProxy = req.query.proxy !== 'false' && req.query.proxy !== '0';
  }

  // Get proxy info for debug output
  let proxyDebugInfo = null;
  if (debugProxy) {
    const { getAxiosProxyConfig, isProxyEnabled } = require('./proxy-config');
    const proxyConfig = getAxiosProxyConfig('oxylabs', useProxy);
    proxyDebugInfo = {
      proxyEnabled: isProxyEnabled(useProxy),
      proxyServer: proxyConfig ? `${proxyConfig.protocol}://${proxyConfig.host}:${proxyConfig.port}` : null,
      requestedOverride: req.query.proxy || 'default',
      hasCredentials: !!(
        process.env.OXYLABS_PROXY_SERVER &&
        process.env.OXYLABS_USERNAME &&
        process.env.OXYLABS_PASSWORD
      )
    };
  }

  if (!url) {
    return res.status(400).json({ error: 'MISSING_URL' });
  }

  try {
    const payload = await getTikTokVideoMetrics(url, verbose, useProxy);
    
    if (debugProxy) {
      payload.proxyDebug = proxyDebugInfo;
    }
    
    res.json(payload);
  } catch (error) {
    if (error instanceof TikTokMetricsError) {
      return res.status(error.status).json({ error: error.code });
    }

    console.error('Unexpected TikTok metrics error:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// curl "http://localhost:3000/api/tiktok/ytdlp?url=https%3A%2F%2Fwww.tiktok.com%2F%40yaroslavslonsky%2Fvideo%2F7568246874558237965"
app.get('/api/tiktok/ytdlp', async (req, res) => {
  const { url } = req.query;
  const verbose = req.query.verbose === '1';
  const debugProxy = req.query.debugProxy === '1';

  // Parse proxy parameter: defaults to enabled (null), can be disabled with proxy=false or proxy=0
  let useProxy = null; // null means use default (enabled if credentials exist)
  if (req.query.proxy !== undefined) {
    useProxy = req.query.proxy !== 'false' && req.query.proxy !== '0';
  }

  // Get proxy info for debug output
  let proxyDebugInfo = null;
  if (debugProxy) {
    const { getAxiosProxyConfig, isProxyEnabled } = require('./proxy-config');
    const proxyConfig = getAxiosProxyConfig('oxylabs', useProxy);
    proxyDebugInfo = {
      proxyEnabled: isProxyEnabled(useProxy),
      proxyServer: proxyConfig ? `${proxyConfig.protocol}://${proxyConfig.host}:${proxyConfig.port}` : null,
      requestedOverride: req.query.proxy || 'default',
      hasCredentials: !!(
        process.env.OXYLABS_PROXY_SERVER &&
        process.env.OXYLABS_USERNAME &&
        process.env.OXYLABS_PASSWORD
      )
    };
  }

  if (!url) {
    return res.status(400).json({ error: 'MISSING_URL' });
  }

  try {
    const payload = await getTikTokVideoMetricsYtdlp(url, verbose, useProxy);
    
    if (debugProxy) {
      payload.proxyDebug = proxyDebugInfo;
    }
    
    res.json(payload);
  } catch (error) {
    if (error instanceof TikTokYtdlpError) {
      const response = { error: error.code };
      
      // Add helpful message for serverless environments
      if (error.code === 'SERVERLESS_UNSUPPORTED') {
        response.message = 'yt-dlp endpoint is not supported on serverless platforms like Vercel. Use /api/tiktok/video/metrics instead.';
      } else if (error.code === 'PYTHON_NOT_FOUND') {
        response.message = 'Python 3.11+ is required but not found. Please install Python 3.11 or higher.';
      }
      
      return res.status(error.status).json(response);
    }

    console.error('Unexpected TikTok yt-dlp error:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

app.get('/api/instagram/profiles', async (req, res) => {
  const query = (req.query.query || '').toString().trim();
  const ensembleKey = process.env.ENSEMBLE_DATA_API_KEY;
  const apifyKey = process.env.APIFY_API_KEY;

  if (!query) {
    return res.status(400).json({ error: 'MISSING_QUERY' });
  }

  if (!ensembleKey) {
    return res.status(503).json({ error: 'ENSEMBLE_DATA_API_KEY_NOT_CONFIGURED' });
  }

  if (!apifyKey) {
    return res.status(503).json({ error: 'APIFY_API_KEY_NOT_CONFIGURED' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const fetch = require('node-fetch');

    // 1) Discover profiles via EnsembleData search
    const ensembleUrl = new URL('https://ensembledata.com/apis/instagram/search');
    ensembleUrl.searchParams.set('text', query);
    ensembleUrl.searchParams.set('token', ensembleKey);

    const ensembleResp = await fetch(ensembleUrl.toString(), { signal: controller.signal });
    const ensembleText = await ensembleResp.text();
    let ensembleBody = null;
    try { ensembleBody = ensembleText ? JSON.parse(ensembleText) : null; } catch (_) { ensembleBody = null; }

    if (!ensembleResp.ok) {
      return res.status(502).json({ error: 'ENSEMBLEDATA_REQUEST_FAILED', status: ensembleResp.status, detail: ensembleBody || ensembleText });
    }

    const users = Array.isArray(ensembleBody?.data?.users) ? ensembleBody.data.users : [];
    const discovered = [];
    for (const u of users) {
      const userData = u?.user || u;
      const username = (userData?.username || '').toString().trim();
      if (!username) continue;
      discovered.push({
        username,
        full_name: userData?.full_name ?? null,
        profile_pic_url: userData?.profile_pic_url ?? null
      });
    }

    // Dedupe while preserving order
    const seen = new Set();
    const profiles = [];
    for (const p of discovered) {
      const key = p.username.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      profiles.push(p);
    }

    const usernamesBatch = profiles.map(p => p.username).filter(Boolean).slice(0, 50);
    if (usernamesBatch.length === 0) {
      return res.json([]);
    }

    // 2) Enrich via Apify actor run (REST API)
    const actorId = 'apify/instagram-profile-scraper';
    const runUrl = new URL(`https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/runs`);
    runUrl.searchParams.set('token', apifyKey);
    runUrl.searchParams.set('waitForFinish', '120');

    const runResp = await fetch(runUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: usernamesBatch }),
      signal: controller.signal
    });
    const runText = await runResp.text();
    let runBody = null;
    try { runBody = runText ? JSON.parse(runText) : null; } catch (_) { runBody = null; }

    if (!runResp.ok) {
      return res.status(502).json({ error: 'APIFY_RUN_FAILED', status: runResp.status, detail: runBody || runText });
    }

    const datasetId = runBody?.data?.defaultDatasetId || runBody?.defaultDatasetId || null;
    if (!datasetId) {
      return res.status(502).json({ error: 'APIFY_NO_DATASET_ID', detail: runBody || null });
    }

    const itemsUrl = new URL(`https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items`);
    itemsUrl.searchParams.set('token', apifyKey);
    itemsUrl.searchParams.set('clean', 'true');
    itemsUrl.searchParams.set('format', 'json');

    const itemsResp = await fetch(itemsUrl.toString(), { signal: controller.signal });
    const itemsText = await itemsResp.text();
    let itemsBody = null;
    try { itemsBody = itemsText ? JSON.parse(itemsText) : []; } catch (_) { itemsBody = []; }

    if (!itemsResp.ok) {
      return res.status(502).json({ error: 'APIFY_DATASET_FAILED', status: itemsResp.status, detail: itemsText });
    }

    const enrichByUsername = new Map();
    if (Array.isArray(itemsBody)) {
      for (const item of itemsBody) {
        const u = (item?.username || '').toString().trim();
        if (!u) continue;
        enrichByUsername.set(u.toLowerCase(), item);
      }
    }

    // 3) Merge + normalize
    const out = profiles.slice(0, usernamesBatch.length).map((p) => {
      const enriched = enrichByUsername.get(p.username.toLowerCase()) || null;
      const bio = enriched?.biography ?? enriched?.bio ?? null;
      const followers = enriched?.followersCount ?? enriched?.followers ?? enriched?.followers_count ?? null;
      const thumb = enriched?.profilePicUrl ?? enriched?.profile_pic_url ?? p.profile_pic_url ?? null;
      const fullName = p.full_name ?? enriched?.fullName ?? enriched?.full_name ?? null;

      return {
        channelName: fullName || null,
        channelUrl: `https://www.instagram.com/${p.username}/`,
        channelHandle: p.username,
        thumbnailUrl: thumb || null,
        description: bio || null,
        subscriberCount: (typeof followers === 'number' ? followers : (Number.isFinite(Number(followers)) ? Number(followers) : null)),
        videoCount: null
      };
    });

    return res.json(out);
  } catch (error) {
    if (error && error.name === 'AbortError') {
      return res.status(504).json({ error: 'TIMEOUT' });
    }
    console.error('Unexpected Instagram profiles error:', error);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  } finally {
    clearTimeout(timeout);
  }
});

app.get('/api/tiktok/profiles', async (req, res) => {
  const query = (req.query.query || '').toString().trim();
  const ensembleKey = process.env.ENSEMBLE_DATA_API_KEY;
  const cursorRaw = req.query.cursor != null ? parseInt(req.query.cursor, 10) : 0;
  const cursor = Number.isFinite(cursorRaw) && cursorRaw >= 0 ? cursorRaw : 0;
  const maxResultsRaw = req.query.maxResults != null ? parseInt(req.query.maxResults, 10) : 50;
  const maxResults = Number.isFinite(maxResultsRaw) ? Math.min(100, Math.max(1, maxResultsRaw)) : 50;
  const thumbnailMode = (req.query.thumbnail || '').toString().trim().toLowerCase();
  const screenshotRaw = (req.query.screenshot || '').toString().trim().toLowerCase();
  const screenshotDisabled = screenshotRaw === '0' || screenshotRaw === 'false';
  const useScreenshotThumbnail = (
    thumbnailMode !== 'avatar' &&
    !screenshotDisabled &&
    req.query.useScreenshotThumbnail !== '0' &&
    req.query.useScreenshotThumbnail !== 'false'
  );

  if (!query) {
    return res.status(400).json({ error: 'MISSING_QUERY' });
  }

  if (!ensembleKey) {
    return res.status(503).json({ error: 'ENSEMBLE_DATA_API_KEY_NOT_CONFIGURED' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), useScreenshotThumbnail ? 1800000 : 120000);

  try {
    const fetch = require('node-fetch');

    const allUsers = [];
    let nextCursor = cursor;
    let hasMore = true;

    for (let page = 0; page < 20; page += 1) {
      const ensembleUrl = new URL('https://ensembledata.com/apis/tt/user/search');
      ensembleUrl.searchParams.set('keyword', query);
      ensembleUrl.searchParams.set('cursor', String(nextCursor));
      ensembleUrl.searchParams.set('token', ensembleKey);

      const resp = await fetch(ensembleUrl.toString(), { signal: controller.signal });
      const text = await resp.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch (_) { body = null; }

      if (!resp.ok) {
        console.error('EnsembleData TikTok user search failed', { status: resp.status, detail: body || text });
        return res.status(502).json({ error: 'ENSEMBLEDATA_REQUEST_FAILED', status: resp.status, detail: body || text });
      }

      const users = Array.isArray(body?.data?.users) ? body.data.users : [];
      if (users.length === 0) break;
      allUsers.push(...users);

      const reportedHasMore = body?.data?.has_more ?? body?.data?.hasMore;
      hasMore = typeof reportedHasMore === 'boolean' ? reportedHasMore : (users.length > 0);

      const reportedCursor = body?.data?.cursor ?? body?.data?.next_cursor ?? body?.data?.nextCursor;
      const newCursor = Number.isFinite(Number(reportedCursor)) ? Number(reportedCursor) : (nextCursor + users.length);
      if (!hasMore) break;
      if (newCursor === nextCursor) break;
      nextCursor = newCursor;

      if (allUsers.length >= maxResults) break;
    }

    const users = allUsers.slice(0, maxResults);
    const out = [];
    const seen = new Set();

    const host = req.get('host');
    const protocol = req.protocol;

    for (const u of users) {
      const info = u?.user_info || u?.userInfo || u?.user || u;
      const username = (info?.unique_id || info?.uniqueId || '').toString().trim();
      if (!username) continue;

      const key = username.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const nickname = info?.nickname ?? null;
      const signature = info?.signature ?? null;
      const avatar = info?.avatar_uri ?? info?.avatarUri ?? info?.profile_pic_url ?? info?.profilePicUrl ?? null;
      const followers = info?.follower_count ?? info?.followers ?? info?.followers_count ?? null;

      const profileUrl = `https://www.tiktok.com/@${username}/`;
      let thumbnailUrl = avatar || null;
      if (useScreenshotThumbnail) {
        thumbnailUrl = `${protocol}://${host}/api/screenshot?url=${encodeURIComponent(profileUrl)}`;
      } else if (thumbnailUrl && typeof thumbnailUrl === 'string') {
        const trimmed = thumbnailUrl.trim();
        if (trimmed.startsWith('//')) {
          thumbnailUrl = `https:${trimmed}`;
        } else if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
          thumbnailUrl = `https://p16.tiktokcdn.com/${trimmed.replace(/^\/+/, '')}`;
        } else {
          thumbnailUrl = trimmed;
        }
      }

      out.push({
        channelName: nickname || null,
        channelUrl: profileUrl,
        channelHandle: username,
        thumbnailUrl,
        description: signature || null,
        subscriberCount: (typeof followers === 'number' ? followers : (Number.isFinite(Number(followers)) ? Number(followers) : null)),
        videoCount: null
      });
    }

    if (useScreenshotThumbnail) {
      const fetch = require('node-fetch');
      const failures = [];
      const SCREENSHOT_BATCH_SIZE = 5;

      const takeScreenshotForItem = async (item) => {
        const profileUrl = item.channelUrl;
        try {
          const screenshotMetaUrl = new URL(`${protocol}://${host}/api/screenshot`);
          screenshotMetaUrl.searchParams.set('url', profileUrl);
          screenshotMetaUrl.searchParams.set('meta', '1');
          screenshotMetaUrl.searchParams.set('storage_provider', 'cloudflare');
          screenshotMetaUrl.searchParams.set('format', 'jpeg');
          screenshotMetaUrl.searchParams.set('quality', '65');
          screenshotMetaUrl.searchParams.set('timeoutMs', '30000');

          const metaResp = await fetch(screenshotMetaUrl.toString(), { signal: controller.signal });
          const metaText = await metaResp.text();
          let metaBody = null;
          try { metaBody = metaText ? JSON.parse(metaText) : null; } catch (_) { metaBody = null; }

          if (metaResp.ok && metaBody && metaBody.s3_url) {
            item.thumbnailUrl = metaBody.s3_url;
          } else {
            item.thumbnailUrl = item.channelUrl;
            failures.push({ channelHandle: item.channelHandle, channelUrl: item.channelUrl });
          }
        } catch (e) {
          item.thumbnailUrl = item.channelUrl;
          failures.push({ channelHandle: item.channelHandle, channelUrl: item.channelUrl });
          console.warn('TikTok screenshot thumbnail failed for', profileUrl, e?.message || e);
        }
      };

      for (let i = 0; i < out.length; i += SCREENSHOT_BATCH_SIZE) {
        await Promise.allSettled(out.slice(i, i + SCREENSHOT_BATCH_SIZE).map(takeScreenshotForItem));
      }

      if (failures.length > 0) {
        console.warn(`TikTok profiles: ${failures.length} screenshot(s) failed (thumbnailUrl fell back to channelUrl for those profiles)`, failures.map(f => f.channelHandle));
      }
    }

    return res.json(out);
  } catch (error) {
    if (error && error.name === 'AbortError') {
      return res.status(504).json({ error: 'TIMEOUT' });
    }
    console.error('Unexpected TikTok profiles error:', error);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  } finally {
    clearTimeout(timeout);
  }
});

app.get('/api/twitter/profiles', async (req, res) => {
  const query = (req.query.query || '').toString().trim();
  const apifyKey = process.env.APIFY_API_KEY;
  const maxResultsRaw = req.query.maxResults != null ? parseInt(req.query.maxResults, 10) : 50;
  const maxResults = Number.isFinite(maxResultsRaw) ? Math.min(100, Math.max(1, maxResultsRaw)) : 50;

  if (!query) {
    return res.status(400).json({ error: 'MISSING_QUERY' });
  }

  if (!apifyKey) {
    return res.status(503).json({ error: 'APIFY_API_KEY_NOT_CONFIGURED' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const fetch = require('node-fetch');

    // Run Apify actor: watcher.data/search-x-by-keywords with searchType=users
    // This directly hits the Twitter People search tab and returns user profile data
    const actorId = 'watcher.data/search-x-by-keywords';
    const runUrl = new URL(`https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/runs`);
    runUrl.searchParams.set('token', apifyKey);
    runUrl.searchParams.set('waitForFinish', '120');

    const runResp = await fetch(runUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ searchType: 'users', keywords: [query], maxItemsPerKeyword: maxResults, outputFormat: 'json' }),
      signal: controller.signal
    });
    const runText = await runResp.text();
    let runBody = null;
    try { runBody = runText ? JSON.parse(runText) : null; } catch (_) { runBody = null; }

    if (!runResp.ok) {
      return res.status(502).json({ error: 'APIFY_RUN_FAILED', status: runResp.status, detail: runBody || runText });
    }

    const datasetId = runBody?.data?.defaultDatasetId || runBody?.defaultDatasetId || null;
    if (!datasetId) {
      return res.status(502).json({ error: 'APIFY_NO_DATASET_ID', detail: runBody || null });
    }

    const itemsUrl = new URL(`https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items`);
    itemsUrl.searchParams.set('token', apifyKey);
    itemsUrl.searchParams.set('clean', 'true');
    itemsUrl.searchParams.set('format', 'json');

    const itemsResp = await fetch(itemsUrl.toString(), { signal: controller.signal });
    const itemsText = await itemsResp.text();
    let itemsBody = null;
    try { itemsBody = itemsText ? JSON.parse(itemsText) : []; } catch (_) { itemsBody = []; }

    if (!itemsResp.ok) {
      return res.status(502).json({ error: 'APIFY_DATASET_FAILED', status: itemsResp.status, detail: itemsText });
    }

    // Normalize user results (each item is a user profile, not a tweet)
    const seen = new Set();
    const out = [];

    if (Array.isArray(itemsBody)) {
      for (const user of itemsBody) {
        const username = (user?.username || '').toString().trim();
        if (!username) continue;

        const key = username.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        const followers = user?.followers_count ?? null;
        const profileUrl = user?.profile_url || `https://x.com/${username}`;

        out.push({
          channelName: user?.name || null,
          channelUrl: profileUrl,
          channelHandle: username,
          thumbnailUrl: user?.profile_image_url || null,
          description: user?.description || null,
          subscriberCount: (typeof followers === 'number' ? followers : (Number.isFinite(Number(followers)) ? Number(followers) : null)),
          videoCount: null
        });

        if (out.length >= maxResults) break;
      }
    }

    return res.json(out);
  } catch (error) {
    if (error && error.name === 'AbortError') {
      return res.status(504).json({ error: 'TIMEOUT' });
    }
    console.error('Unexpected Twitter profiles error:', error);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  } finally {
    clearTimeout(timeout);
  }
});

// Instagram endpoint for scraping post metrics
app.get('/api/instagram/video', async (req, res) => {
  const { url } = req.query;
  const debug = (req.query.debug === '1') || (req.query.verbose === '1');
  const debugProxy = req.query.debugProxy === '1';
  const acceptHeader = (req.headers && req.headers.accept) || '';
  
  // Parse proxy parameter: defaults to enabled (null), can be disabled with proxy=false or proxy=0
  let useProxy = null; // null means use default (enabled if credentials exist)
  if (req.query.proxy !== undefined) {
    useProxy = req.query.proxy !== 'false' && req.query.proxy !== '0';
  }
  
  // Get proxy info for debug output
  let proxyDebugInfo = null;
  if (debugProxy) {
    const { getPlaywrightProxyConfig, isProxyEnabled } = require('./proxy-config');
    const proxyConfig = getPlaywrightProxyConfig('oxylabs', useProxy);
    proxyDebugInfo = {
      proxyEnabled: isProxyEnabled(useProxy),
      proxyServer: proxyConfig?.server || null,
      requestedOverride: req.query.proxy || 'default',
      hasCredentials: !!(
        process.env.OXYLABS_PROXY_SERVER &&
        process.env.OXYLABS_USERNAME &&
        process.env.OXYLABS_PASSWORD
      )
    };
  }

  if (!url) {
    return res.status(400).json({
      error: "Invalid request",
      detail: "Query param `url` is required.",
      example: "/api/instagram/video?url=https%3A%2F%2Fwww.instagram.com%2Fp%2FC7usZ6gSsa0%2F"
    });
  }

  // Validate and parse the URL (same approach as TikTok)
  const parsedUrl = parseInstagramUrl(url);
  if (!parsedUrl) {
    return res.status(400).json({
      error: "Invalid request",
      detail: "Invalid Instagram URL. Supported formats: /p/{shortcode}/, /reel/{shortcode}/, /tv/{shortcode}/",
      example: "/api/instagram/video?url=https%3A%2F%2Fwww.instagram.com%2Fp%2FC7usZ6gSsa0%2F"
    });
  }

  try {
    const scrapedData = await scrapeInstagramPost(parsedUrl.decodedUrl, { debug, useProxy });

    const response = {
      platform: "instagram",
      inputUrl: parsedUrl.decodedUrl,
      videoId: parsedUrl.shortcode,
      publishedAt: scrapedData.created_at || null,
      description: scrapedData.description || null,
      authorHandle: scrapedData.author_handle || null,
      heroImageUrl: scrapedData.hero_image_url || null,
      metrics: {
        views: scrapedData?.engagement?.views ?? null,
        likes: scrapedData?.engagement?.likes ?? null,
        comments: scrapedData?.engagement?.comments ?? null,
        shares: scrapedData?.engagement?.shares ?? null
      }
    };

    const debugObj = debug
      ? ((scrapedData && scrapedData.debug) ? scrapedData.debug : { capturedCount: 0, capturedUrls: [], attempts: [], screenshots: {} })
      : undefined;

    if (debug && acceptHeader.includes('text/html')) {
      // Render a small HTML page with inline screenshots when debug is requested from a browser
      response.debug = debugObj;
      return res.send(renderInstagramDebugHtml(response));
    }

    if (debug) {
      response.debug = debugObj;
    }
    
    if (debugProxy) {
      response.proxyDebug = proxyDebugInfo;
    }

    return res.json(response);
  } catch (error) {
    console.error('Instagram scraping error:', error);
    
    // When debugging from a browser, render an HTML page even on failure
    if (debug && acceptHeader.includes('text/html')) {
      const response = {
        platform: "instagram",
        inputUrl: parsedUrl?.decodedUrl || url,
        videoId: parsedUrl?.shortcode || null,
        publishedAt: null,
        description: null,
        authorHandle: null,
        heroImageUrl: null,
        metrics: { views: null, likes: null, comments: null, shares: null }
      };
      response.debug = (error && error.debug)
        ? error.debug
        : { capturedCount: 0, capturedUrls: [], attempts: [], screenshots: {}, error: (error && error.message) || String(error) };
      const statusCode = (error && error.message && error.message.includes('timeout')) ? 504 : 502;
      return res.status(statusCode).send(renderInstagramDebugHtml(response));
    }

    if (error.message && error.message.includes('timeout')) {
      const payload = { error: "Gateway Timeout", detail: "Page load timeout while scraping Instagram" };
      if (debug) payload.debug = { error: error.message };
      return res.status(504).json(payload);
    }
    
    const payload = { error: "Bad Gateway", detail: "Failed to scrape Instagram content" };
    if (debug) payload.debug = { error: error.message };
    return res.status(502).json(payload);
  }
});

/**
 * Parse and validate Instagram URL, extract shortcode (same approach as TikTok)
 * @param {string} encodedUrl - URL parameter (may be encoded)
 * @returns {Object|null} { shortcode, decodedUrl } or null if invalid
 */
function parseInstagramUrl(encodedUrl) {
  let decodedUrl;
  try {
    decodedUrl = decodeURIComponent(encodedUrl);
  } catch (error) {
    return null;
  }

  try {
    const parsed = new URL(decodedUrl);
    const hostname = parsed.hostname.toLowerCase();
    
    // Allow www.instagram.com or instagram.com
    if (!hostname.endsWith('instagram.com')) {
      return null;
    }
    
    const pathname = parsed.pathname;
    const match = pathname.match(/^\/(p|reel|tv)\/([^\/]+)\/?$/);
    
    if (!match) {
      return null;
    }
    
    return {
      shortcode: match[2],
      decodedUrl: decodedUrl
    };
  } catch (error) {
    return null;
  }
}

// Instagram video endpoint using Apify
app.get('/api/instagram/video/apify', async (req, res) => {
  const { url } = req.query;
  const verbose = req.query.verbose === '1';
  const apifyKey = process.env.APIFY_API_KEY;

  if (!url) {
    return res.status(400).json({
      error: "Invalid request",
      detail: "Query param `url` is required.",
      example: "/api/instagram/video/apify?url=https%3A%2F%2Fwww.instagram.com%2Fp%2FCgtXoBxr_FU%2F"
    });
  }

  if (!apifyKey) {
    return res.status(503).json({ error: 'APIFY_API_KEY_NOT_CONFIGURED' });
  }

  const parsedUrl = parseInstagramUrl(url);
  if (!parsedUrl) {
    return res.status(400).json({
      error: "Invalid request",
      detail: "Invalid Instagram URL. Supported formats: /p/{shortcode}/, /reel/{shortcode}/, /tv/{shortcode}/",
      example: "/api/instagram/video/apify?url=https%3A%2F%2Fwww.instagram.com%2Fp%2FCgtXoBxr_FU%2F"
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const fetch = require('node-fetch');

    const actorId = 'apify/instagram-scraper';
    const runUrl = new URL(`https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/runs`);
    runUrl.searchParams.set('token', apifyKey);
    runUrl.searchParams.set('waitForFinish', '120');

    const runResp = await fetch(runUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        directUrls: [parsedUrl.decodedUrl],
        resultsType: 'posts'
      }),
      signal: controller.signal
    });

    const runText = await runResp.text();
    let runBody = null;
    try { runBody = runText ? JSON.parse(runText) : null; } catch (_) { runBody = null; }

    if (!runResp.ok) {
      return res.status(502).json({ error: 'APIFY_RUN_FAILED', status: runResp.status, detail: runBody || runText });
    }

    const datasetId = runBody?.data?.defaultDatasetId || runBody?.defaultDatasetId || null;
    if (!datasetId) {
      return res.status(502).json({ error: 'APIFY_NO_DATASET_ID', detail: runBody || null });
    }

    const itemsUrl = new URL(`https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items`);
    itemsUrl.searchParams.set('token', apifyKey);
    itemsUrl.searchParams.set('clean', 'true');
    itemsUrl.searchParams.set('format', 'json');

    const itemsResp = await fetch(itemsUrl.toString(), { signal: controller.signal });
    const itemsText = await itemsResp.text();
    let itemsBody = null;
    try { itemsBody = itemsText ? JSON.parse(itemsText) : []; } catch (_) { itemsBody = []; }

    if (!itemsResp.ok) {
      return res.status(502).json({ error: 'APIFY_DATASET_FAILED', status: itemsResp.status, detail: itemsText });
    }

    if (!Array.isArray(itemsBody) || itemsBody.length === 0) {
      return res.status(404).json({ error: 'POST_NOT_FOUND', detail: 'No data returned from Apify' });
    }

    const post = itemsBody[0];

    // Normalize to match /api/instagram/video response shape
    const response = {
      platform: "instagram",
      inputUrl: parsedUrl.decodedUrl,
      videoId: post.shortCode || parsedUrl.shortcode,
      publishedAt: post.timestamp || null,
      description: post.caption || null,
      authorHandle: post.ownerUsername || null,
      heroImageUrl: post.displayUrl || null,
      metrics: {
        views: post.videoViewCount ?? post.videoPlayCount ?? null,
        likes: post.likesCount ?? null,
        comments: post.commentsCount ?? null,
        shares: null
      }
    };

    if (verbose) {
      response.apifyData = post;
    }

    return res.json(response);
  } catch (error) {
    if (error && error.name === 'AbortError') {
      return res.status(504).json({ error: 'TIMEOUT' });
    }
    console.error('Unexpected Instagram Apify error:', error);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  } finally {
    clearTimeout(timeout);
  }
});

function parseSpotifyUrl(inputUrl) {
  try {
    const decodedUrl = decodeURIComponent(inputUrl);
    const parsed = new URL(decodedUrl);
    const hostname = parsed.hostname.toLowerCase();
    
    if (!hostname.endsWith('spotify.com')) {
      return null;
    }
    
    if (hostname === 'creators.spotify.com') {
      return { needsResolver: true, url: decodedUrl };
    }
    
    if (hostname !== 'open.spotify.com') {
      return null;
    }
    
    let segments = parsed.pathname.split('/').filter(s => s);
    
    if (segments.length === 0) {
      return null;
    }
    
    if (segments[0].startsWith('intl-')) {
      segments.shift();
    }
    
    if (segments[0] === 'embed') {
      segments.shift();
    }
    
    if (segments.length < 2) {
      return null;
    }
    
    const type = segments[0];
    const id = segments[1];
    
    const allowedTypes = ['playlist', 'artist', 'show', 'track', 'album', 'episode'];
    if (!allowedTypes.includes(type)) {
      return null;
    }
    
    const canonicalUrl = `https://open.spotify.com/${type}/${id}`;
    
    return {
      platform: 'spotify',
      type,
      id,
      canonicalUrl
    };
  } catch (error) {
    return null;
  }
}

async function resolveCreatorsUrl(url) {
  try {
    console.log('[Creators Resolver] Resolving URL:', url);
    
    // Creators podcast episode URLs use internal IDs that are not compatible with Spotify API
    // Format: creators.spotify.com/pod/profile/{show}/episodes/{episode-slug}-{episode-id}
    const creatorsEpisodeMatch = url.match(/creators\.spotify\.com\/pod\/profile\/[^\/]+\/episodes\//);
    if (creatorsEpisodeMatch) {
      console.log('[Creators Resolver] Creators podcast episode URLs are not supported - ID format incompatible');
      return null;
    }
    
    // Fallback: Try to fetch and parse HTML for other creators URL formats
    const fetch = require('node-fetch');
    console.log('[Creators Resolver] Fetching URL for HTML parsing');
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 10000
    });
    
    if (!response.ok) {
      console.log('[Creators Resolver] Response not OK');
      return null;
    }
    
    const html = await response.text();
    
    const openSpotifyMatch = html.match(/https:\/\/open\.spotify\.com\/episode\/([a-zA-Z0-9]+)/);
    if (openSpotifyMatch) {
      console.log('[Creators Resolver] Found episode URL in HTML:', openSpotifyMatch[0]);
      return `https://open.spotify.com/episode/${openSpotifyMatch[1]}`;
    }
    
    const spotifyUriMatch = html.match(/spotify:episode:([a-zA-Z0-9]+)/);
    if (spotifyUriMatch) {
      console.log('[Creators Resolver] Found episode URI in HTML:', spotifyUriMatch[0]);
      return `https://open.spotify.com/episode/${spotifyUriMatch[1]}`;
    }
    
    console.log('[Creators Resolver] No episode URL found');
    return null;
  } catch (error) {
    console.error('[Creators Resolver] Error:', error.message);
    return null;
  }
}

app.get('/api/playlist/:playlistId', async (req, res) => {
  try {
    const { playlistId } = req.params;
    const { maxResults = 50 } = req.query;
    const items = await youtubeClient.getPlaylistItems(playlistId, parseInt(maxResults));
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/spotify/metadata', async (req, res) => {
  const { getSpotifyClient } = require('./spotify');
  
  try {
    const { url, verbose } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'invalid_url' });
    }
    
    let parsed = parseSpotifyUrl(url);
    
    if (!parsed) {
      return res.status(400).json({ error: 'unsupported_spotify_url' });
    }
    
    if (parsed.needsResolver) {
      const resolvedUrl = await resolveCreatorsUrl(parsed.url);
      if (!resolvedUrl) {
        return res.status(400).json({ error: 'unsupported_creators_url' });
      }
      parsed = parseSpotifyUrl(resolvedUrl);
      if (!parsed) {
        return res.status(400).json({ error: 'unsupported_creators_url' });
      }
    }
    
    const { type, id, canonicalUrl } = parsed;
    
    console.log('[Spotify endpoint] Getting client for type:', type, 'id:', id);
    
    let spotify;
    try {
      spotify = await getSpotifyClient();
      console.log('[Spotify endpoint] Client obtained, tracks:', !!spotify.tracks);
    } catch (error) {
      console.error('[Spotify endpoint] Client error:', error);
      return res.status(500).json({ 
        error: 'spotify_client_error',
        detail: error.message 
      });
    }
    
    let metadata;
    try {
      console.log('[Spotify endpoint] Fetching metadata for', type, id);
      switch (type) {
        case 'track':
          metadata = await spotify.tracks.get(id);
          break;
        case 'album':
          metadata = await spotify.albums.get(id);
          break;
        case 'artist':
          metadata = await spotify.artists.get(id);
          break;
        case 'playlist':
          metadata = await spotify.playlists.getPlaylist(id);
          break;
        case 'show':
          metadata = await spotify.shows.get(id);
          break;
        case 'episode':
          metadata = await spotify.episodes.get(id);
          break;
        default:
          return res.status(400).json({ error: 'unsupported_spotify_url' });
      }
    } catch (error) {
      if (error.status === 429) {
        const retryAfter = error.headers?.['retry-after'];
        if (retryAfter) {
          await new Promise(resolve => setTimeout(resolve, parseInt(retryAfter) * 1000));
          try {
            switch (type) {
              case 'track':
                metadata = await spotify.tracks.get(id);
                break;
              case 'album':
                metadata = await spotify.albums.get(id);
                break;
              case 'artist':
                metadata = await spotify.artists.get(id);
                break;
              case 'playlist':
                metadata = await spotify.playlists.getPlaylist(id);
                break;
              case 'show':
                metadata = await spotify.shows.get(id);
                break;
              case 'episode':
                metadata = await spotify.episodes.get(id);
                break;
            }
          } catch (retryError) {
            return res.status(502).json({ 
              error: 'spotify_api_error',
              detail: retryError.message 
            });
          }
        } else {
          return res.status(502).json({ 
            error: 'spotify_api_error',
            detail: 'Rate limited by Spotify API' 
          });
        }
      } else {
        return res.status(502).json({ 
          error: 'spotify_api_error',
          detail: error.message 
        });
      }
    }
    
    let title = null;
    let publishedAt = null;
    let durationSeconds = null;
    let heroImageUrl = null;
    let channelHandle = null;
    
    switch (type) {
      case 'track':
        title = metadata.name;
        publishedAt = metadata.album?.release_date || null;
        durationSeconds = metadata.duration_ms ? Math.floor(metadata.duration_ms / 1000) : null;
        heroImageUrl = metadata.album?.images?.[0]?.url || null;
        channelHandle = metadata.artists?.map(a => a.name).join(', ') || null;
        break;
        
      case 'album':
        title = metadata.name;
        publishedAt = metadata.release_date || null;
        durationSeconds = null;
        heroImageUrl = metadata.images?.[0]?.url || null;
        channelHandle = metadata.artists?.map(a => a.name).join(', ') || null;
        break;
        
      case 'artist':
        title = metadata.name;
        publishedAt = null;
        durationSeconds = null;
        heroImageUrl = metadata.images?.[0]?.url || null;
        channelHandle = metadata.name;
        break;
        
      case 'playlist':
        title = metadata.name;
        publishedAt = null;
        durationSeconds = null;
        heroImageUrl = metadata.images?.[0]?.url || null;
        channelHandle = metadata.owner?.display_name || null;
        break;
        
      case 'show':
        title = metadata.name;
        publishedAt = null;
        durationSeconds = null;
        heroImageUrl = metadata.images?.[0]?.url || null;
        channelHandle = metadata.publisher || null;
        break;
        
      case 'episode':
        title = metadata.name;
        publishedAt = metadata.release_date || null;
        durationSeconds = metadata.duration_ms ? Math.floor(metadata.duration_ms / 1000) : null;
        heroImageUrl = metadata.images?.[0]?.url || null;
        channelHandle = metadata.show?.name || null;
        break;
    }
    
    if (verbose === '1') {
      return res.json(metadata);
    }
    
    const response = {
      platform: 'spotify',
      inputUrl: url,
      canonicalUrl,
      type,
      id,
      title,
      publishedAt,
      durationSeconds,
      heroImageUrl,
      channelHandle
    };
    
    res.json(response);
    
  } catch (error) {
    console.error('Spotify metadata error:', error);
    res.status(500).json({ 
      error: 'internal_error',
      detail: error.message 
    });
  }
});

app.get('/api/chartmetric/metadata', async (req, res) => {
  const { getChartmetricClient } = require('./chartmetric');
  
  try {
    const { url, verbose } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'invalid_url' });
    }
    
    let parsed = parseSpotifyUrl(url);
    
    if (!parsed) {
      return res.status(400).json({ error: 'unsupported_spotify_url' });
    }
    
    if (parsed.needsResolver) {
      const resolvedUrl = await resolveCreatorsUrl(parsed.url);
      if (!resolvedUrl) {
        return res.status(400).json({ error: 'unsupported_creators_url' });
      }
      parsed = parseSpotifyUrl(resolvedUrl);
      if (!parsed) {
        return res.status(400).json({ error: 'unsupported_creators_url' });
      }
    }
    
    const { type, id, canonicalUrl } = parsed;
    
    console.log('[Chartmetric endpoint] Getting client for type:', type, 'id:', id);
    
    let chartmetric;
    try {
      chartmetric = await getChartmetricClient();
      console.log('[Chartmetric endpoint] Client obtained');
    } catch (error) {
      console.error('[Chartmetric endpoint] Client error:', error);
      return res.status(500).json({ 
        error: 'chartmetric_client_error',
        detail: error.message 
      });
    }
    
    let metadata;
    try {
      console.log('[Chartmetric endpoint] Fetching metadata for', type, id);
      switch (type) {
        case 'track':
          metadata = await chartmetric.track.getBySpotifyId(id);
          break;
        case 'album':
          metadata = await chartmetric.album.getBySpotifyId(id);
          break;
        case 'artist':
          metadata = await chartmetric.artist.getBySpotifyId(id);
          break;
        case 'playlist':
          metadata = await chartmetric.playlist.getBySpotifyId(id);
          break;
        case 'show':
        case 'episode':
          return res.status(400).json({ 
            error: 'unsupported_type',
            detail: 'Chartmetric does not support Spotify shows or episodes' 
          });
        default:
          return res.status(400).json({ error: 'unsupported_spotify_url' });
      }
    } catch (error) {
      return res.status(502).json({ 
        error: 'chartmetric_api_error',
        detail: error.message 
      });
    }
    
    if (verbose === '1') {
      return res.json(metadata);
    }
    
    const obj = metadata.obj || metadata;
    
    const durationSeconds = obj.duration_ms ? Math.floor(obj.duration_ms / 1000) : null;
    let durationIso = null;
    if (durationSeconds !== null) {
      const hours = Math.floor(durationSeconds / 3600);
      const minutes = Math.floor((durationSeconds % 3600) / 60);
      const seconds = durationSeconds % 60;
      durationIso = 'PT';
      if (hours > 0) durationIso += `${hours}H`;
      if (minutes > 0) durationIso += `${minutes}M`;
      if (seconds > 0 || (hours === 0 && minutes === 0)) durationIso += `${seconds}S`;
    }
    
    const response = {
      platform: 'chartmetric',
      originalUrl: url,
      videoId: id,
      title: obj.name || null,
      publishedAt: obj.release_date || obj.releaseDate || obj.last_updated || null,
      durationIso: durationIso,
      durationSeconds: durationSeconds,
      viewCount: obj.cm_statistics?.sp_streams || obj.followers || null,
      likeCount: null,
      commentCount: null,
      engagement_likeRate: null,
      engagement_commentRate: null,
      heroImageUrl: obj.image_url || obj.imageUrl || (obj.images && obj.images[0] && obj.images[0].url) || null,
      channelHandle: obj.artist_names || obj.artistNames || (obj.artists && obj.artists.map(a => a.name).join(', ')) || obj.publisher || obj.owner_name || null
    };
    
    res.json(response);
    
  } catch (error) {
    console.error('Chartmetric metadata error:', error);
    res.status(500).json({ 
      error: 'internal_error',
      detail: error.message 
    });
  }
});

// Screenshot endpoint - structured webpage screenshot capture with metadata
app.get('/api/screenshot', async (req, res) => {
  const {
    createBrowserOrContext,
    applyAntiDetection,
    detectBlockPage,
    waitForPageSettle,
    collectPageSignals,
    determineStatus,
    captureScreenshot,
    checkRedditMediaComplete
  } = require('./screenshot-helpers');

  let browser = null;
  let context = null;
  let page = null;
  const timings = { gotoMs: 0, settleMs: 0, screenshotMs: 0, totalMs: 0 };
  const startTime = Date.now();

  try {
    const {
      url,
      download,
      fullPage,
      meta,
      debug,
      includeImage,
      selector,
      capture,
      format,
      quality,
      profileMode,
      timeoutMs,
      storage_provider
    } = req.query;

    const debugMode = debug === '1';
    const debugProxy = req.query.debugProxy === '1';
    const isMetaMode = meta === '1';
    const shouldIncludeImage = includeImage === '1';
    const screenshotFormat = format || 'jpeg';
    const screenshotQuality = quality ? parseInt(quality, 10) : 65;
    const useFullPage = fullPage === '1';
    const navigationTimeout = timeoutMs ? parseInt(timeoutMs, 10) : 30000;
    const usePersistentProfile = profileMode === 'persistent';
    const shouldUploadToR2 = storage_provider === 'cloudflare';

    // Parse proxy parameter: defaults to enabled (null), can be disabled with proxy=false or proxy=0
    let useProxy = null; // null means use default (enabled if credentials exist)
    if (req.query.proxy !== undefined) {
      useProxy = req.query.proxy !== 'false' && req.query.proxy !== '0';
    }

    // Get proxy info for debug output
    let proxyDebugInfo = null;
    if (debugProxy) {
      const { getPlaywrightProxyConfig, isProxyEnabled } = require('./proxy-config');
      const proxyConfig = getPlaywrightProxyConfig('oxylabs', useProxy);
      proxyDebugInfo = {
        proxyEnabled: isProxyEnabled(useProxy),
        proxyServer: proxyConfig?.server || null,
        requestedOverride: req.query.proxy || 'default',
        hasCredentials: !!(
          process.env.OXYLABS_PROXY_SERVER &&
          process.env.OXYLABS_USERNAME &&
          process.env.OXYLABS_PASSWORD
        )
      };
    }

    if (!url) {
      return res.status(400).json({
        ok: false,
        error: 'MISSING_URL',
        message: 'URL parameter is required',
        inputUrl: null
      });
    }

    let targetUrl;
    try {
      targetUrl = new URL(url);
    } catch (e) {
      return res.status(400).json({
        ok: false,
        error: 'INVALID_URL',
        message: 'Provided URL is malformed',
        inputUrl: url
      });
    }

    if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
      return res.status(400).json({
        ok: false,
        error: 'INVALID_URL_PROTOCOL',
        message: 'URL must use http or https protocol',
        inputUrl: url
      });
    }

    const browserSetup = await createBrowserOrContext(usePersistentProfile ? 'persistent' : 'fresh', useProxy);
    browser = browserSetup.browser;
    context = browserSetup.context;

    await applyAntiDetection(context);

    page = await context.newPage();

    if (debugMode) {
      page.on('requestfailed', (request) => {
        console.log('[requestfailed]', request.resourceType(), request.failure()?.errorText || 'unknown', request.url());
      });

      page.on('response', async (response) => {
        const status = response.status();
        const contentType = response.headers()['content-type'] || '';
        if (contentType.startsWith('image/') || status >= 400) {
          console.log('[response]', status, contentType, response.url());
        }
      });
    }

    const gotoStart = Date.now();
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: navigationTimeout
      });
    } catch (error) {
      if (error.message.includes('Timeout')) {
        return res.status(504).json({
          ok: false,
          error: 'NAVIGATION_TIMEOUT',
          message: `Navigation timeout after ${navigationTimeout}ms`,
          inputUrl: url
        });
      }
      return res.status(502).json({
        ok: false,
        error: 'NAVIGATION_FAILED',
        message: error.message,
        inputUrl: url
      });
    }
    timings.gotoMs = Date.now() - gotoStart;

    const finalUrl = page.url();

    const settleStart = Date.now();
    await waitForPageSettle(page, url, debugMode, useProxy);
    timings.settleMs = Date.now() - settleStart;

    let title = null;
    let htmlSnippet = null;
    try {
      title = await page.title();
      const fullHtml = await page.content();
      htmlSnippet = fullHtml.substring(0, 50000);
    } catch (e) {
      if (debugMode) {
        console.error('Error extracting page metadata:', e);
      }
    }

    const { blocked, reason } = detectBlockPage(title, htmlSnippet);
    const pageSignals = await collectPageSignals(page);
    const status = blocked ? 'blocked' : determineStatus(blocked, pageSignals);

    const warnings = [];
    
    // Check Reddit media completeness
    const isReddit = url.toLowerCase().includes('reddit.com');
    if (isReddit) {
      const redditMediaComplete = await checkRedditMediaComplete(page);
      if (!redditMediaComplete) {
        warnings.push('Main reddit media did not fully load before capture');
      }
    }
    
    if (pageSignals.imageCount > 0) {
      const loadRate = pageSignals.loadedImageCount / pageSignals.imageCount;
      if (loadRate < 0.5) {
        warnings.push(`Only ${Math.round(loadRate * 100)}% of images loaded`);
      }
    }
    if (pageSignals.brokenImageCount > 3) {
      warnings.push(`${pageSignals.brokenImageCount} broken images detected`);
    }
    if (pageSignals.hasVisibleOverlays) {
      warnings.push(`${pageSignals.visibleOverlayCount} visible overlay(s) may obstruct content`);
    }
    if (pageSignals.hasSkeletons) {
      warnings.push(`${pageSignals.visibleSkeletonCount} skeleton/placeholder element(s) detected`);
    }

    const screenshotStart = Date.now();
    const { screenshotBuffer, captureWarning } = await captureScreenshot(page, {
      format: screenshotFormat,
      quality: screenshotQuality,
      fullPage: useFullPage,
      selector: selector || null
    });
    timings.screenshotMs = Date.now() - screenshotStart;
    timings.totalMs = Date.now() - startTime;

    if (captureWarning) {
      warnings.push(captureWarning);
    }

    const screenshotDimensions = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight
    }));

    let s3Url = null;
    if (shouldUploadToR2) {
      try {
        const { uploadToR2 } = require('./r2-storage');
        const mimeType = screenshotFormat === 'png' ? 'image/png' : screenshotFormat === 'webp' ? 'image/webp' : 'image/jpeg';
        const extension = screenshotFormat === 'png' ? 'png' : screenshotFormat === 'webp' ? 'webp' : 'jpg';
        s3Url = await uploadToR2(screenshotBuffer, mimeType, extension);
        if (debugMode) {
          console.log('[R2] Screenshot uploaded to:', s3Url);
        }
      } catch (error) {
        console.error('[R2] Upload failed:', error.message);
        warnings.push(`R2 upload failed: ${error.message}`);
      }
    }

    const metadata = {
      ok: status === 'rendered' || status === 'partial',
      status,
      inputUrl: url,
      finalUrl,
      title: title || null,
      blocked,
      blockReason: reason || null,
      warnings,
      renderMode: 'playwright',
      timings,
      pageSignals: {
        anchorCount: pageSignals.anchorCount,
        links: pageSignals.links,
        imageCount: pageSignals.imageCount,
        loadedImageCount: pageSignals.loadedImageCount,
        brokenImageCount: pageSignals.brokenImageCount,
        videoCount: pageSignals.videoCount,
        audioCount: pageSignals.audioCount
      },
      screenshot: {
        format: screenshotFormat,
        fullPage: useFullPage,
        width: screenshotDimensions.width,
        height: screenshotDimensions.height,
        byteLength: screenshotBuffer.length
      }
    };

    if (s3Url) {
      metadata.s3_url = s3Url;
    }

    if (debugMode) {
      metadata.debug = {
        profileMode: usePersistentProfile ? 'persistent' : 'fresh',
        navigationTimeout,
        hasVisibleOverlays: pageSignals.hasVisibleOverlays,
        hasSkeletons: pageSignals.hasSkeletons
      };
    }

    if (debugProxy) {
      metadata.proxyDebug = proxyDebugInfo;
    }

    if (isMetaMode) {
      if (shouldIncludeImage) {
        const mimeType = screenshotFormat === 'png' ? 'image/png' : screenshotFormat === 'webp' ? 'image/webp' : 'image/jpeg';
        metadata.imageBase64 = `data:${mimeType};base64,${screenshotBuffer.toString('base64')}`;
      }
      return res.json(metadata);
    }

    const hostname = targetUrl.hostname.replace(/[^a-z0-9.-]/gi, '_');
    const timestamp = Date.now();
    const extension = screenshotFormat === 'png' ? 'png' : screenshotFormat === 'webp' ? 'webp' : 'jpg';
    const filename = `screenshot-${hostname}-${timestamp}.${extension}`;
    const disposition = download === '1' ? 'attachment' : 'inline';
    const mimeType = screenshotFormat === 'png' ? 'image/png' : screenshotFormat === 'webp' ? 'image/webp' : 'image/jpeg';

    const truncatedTitle = title ? encodeURIComponent(title.substring(0, 120)) : '';
    const truncatedFinalUrl = encodeURIComponent(finalUrl.substring(0, 200));

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
    res.setHeader('X-Screenshot-Status', status);
    res.setHeader('X-Screenshot-Blocked', blocked ? '1' : '0');
    if (truncatedTitle) {
      res.setHeader('X-Screenshot-Title', truncatedTitle);
    }
    if (truncatedFinalUrl) {
      res.setHeader('X-Screenshot-Final-Url', truncatedFinalUrl);
    }
    if (blocked && reason) {
      res.setHeader('X-Screenshot-Block-Reason', encodeURIComponent(reason));
    }
    res.send(screenshotBuffer);

  } catch (error) {
    console.error('Screenshot error:', error);
    
    if (!res.headersSent) {
      const errorCode = error.message.includes('screenshot') ? 'SCREENSHOT_CAPTURE_FAILED' : 'INTERNAL_ERROR';
      return res.status(500).json({
        ok: false,
        error: errorCode,
        message: error.message,
        inputUrl: req.query.url || null
      });
    }
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
});

// ── Root index: HTML overview with clickable links + ?format=json fallback ──
const indexData = {
  message: 'Social Media Metadata API Server',
  uiTools: [
    { path: '/csv.html',                name: 'CSV Generator',       desc: 'Batch process URLs and download CSV' },
    { path: '/sheets.html',             name: 'Vermillio Report Augmentation', desc: 'Process URLs from a Google Sheet `report` tab and write metadata back' },
    { path: '/enrichment.html',         name: 'Artist Record Enrichment', desc: 'Upload a CSV of artist records; enrich identity, socials, works & affiliations' },
    { path: '/channels.html',           name: 'Channel Search',      desc: 'YouTube channel search CSV export' },
    { path: '/screenshot.html',         name: 'Screenshot Tool',     desc: 'Take screenshots and get public URLs or download CSV' },
    { path: '/discover-siblings.html',  name: 'Sibling Discovery',   desc: 'Upload SERP CSV to find related videos on the same channel' }
  ],
  groups: [
    {
      name: 'YouTube',
      endpoints: [
        { path: '/api/video/:videoId?verbose=1',                    desc: 'Video metadata',               example: '/api/video/dQw4w9WgXcQ' },
        { path: '/api/video/:videoId/comments?maxResults=20',       desc: 'Video comments',               example: '/api/video/dQw4w9WgXcQ/comments?maxResults=10' },
        { path: '/api/search?q=...&maxResults=10',                  desc: 'Video search',                 example: '/api/search?q=lord+of+the+rings&maxResults=5' },
        { path: '/api/search/channels?q=...&maxResults=10',         desc: 'Channel search',               example: '/api/search/channels?q=tolkien&maxResults=5' },
        { path: '/api/channel/:channelId',                          desc: 'Channel details' },
        { path: '/api/channel/:channelId/videos?maxResults=10',     desc: 'Channel recent videos' },
        { path: '/api/playlist/:playlistId?maxResults=50',          desc: 'Playlist items' },
        { path: '/api/trending?regionCode=US&maxResults=10',        desc: 'Trending videos',              example: '/api/trending?regionCode=US&maxResults=5' },
        { path: '/api/youtube/discover-siblings?channelId=<CHANNEL_OR_@HANDLE>&query=<SEARCH>&maxResults=100&minScore=40', desc: 'Scan channel uploads for related content',
          example: '/api/youtube/discover-siblings?channelId=@ai-general.content177&query=Harry+Potter&maxResults=50&minScore=40' },
        { path: '/api/youtube/transcript?videoId=<ID> | ?url=<YT_URL>&lang=en&proxy=false', desc: 'Fetch public captions via yt-dlp through Oxylabs proxy (manual preferred over auto-gen)',
          example: '/api/youtube/transcript?videoId=dQw4w9WgXcQ' }
      ]
    },
    {
      name: 'TikTok',
      endpoints: [
        { path: '/api/tiktok/video/metrics?url=<URL>',     desc: 'Video metrics' },
        { path: '/api/tiktok/ytdlp?url=<URL>',             desc: 'Video metadata via yt-dlp' },
        { path: '/api/tiktok/profiles?query=<TERM>',       desc: 'Profile discovery (EnsembleData)',
          example: '/api/tiktok/profiles?query=tolkien' }
      ]
    },
    {
      name: 'Instagram',
      endpoints: [
        { path: '/api/instagram/video?url=<URL>',                       desc: 'Video/post metadata' },
        { path: '/api/instagram/video/apify?url=<URL>&verbose=1',       desc: 'Via Apify instagram-scraper' },
        { path: '/api/instagram/profiles?query=<TERM>',                 desc: 'Profile discovery (EnsembleData + Apify enrichment)',
          example: '/api/instagram/profiles?query=tolkien' }
      ]
    },
    {
      name: 'Twitter / X',
      endpoints: [
        { path: '/api/twitter/profiles?query=<TERM>', desc: 'Profile discovery (Apify xtdata/twitter-x-scraper)',
          example: '/api/twitter/profiles?query=tolkien' }
      ]
    },
    {
      name: 'Music',
      endpoints: [
        { path: '/api/chartmetric/metadata?url=<SPOTIFY_URL>&verbose=1', desc: 'Spotify tracks/albums/artists/playlists + streaming data',
          example: '/api/chartmetric/metadata?url=https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp' },
        { path: '/api/spotify/metadata?url=<SPOTIFY_URL>&verbose=1', desc: 'Spotify shows / episodes',
          example: '/api/spotify/metadata?url=https://open.spotify.com/episode/0L5BZId2ySpX6Ni64dbbhw' }
      ]
    },
    {
      name: 'Utility',
      endpoints: [
        { path: '/api/screenshot?url=<URL>&download=1&fullPage=1', desc: 'Screenshot any web page',
          example: '/api/screenshot?url=https%3A%2F%2Fexample.com&fullPage=1' },
        { path: '/api/proxy/status', desc: 'Proxy configuration debug info',
          example: '/api/proxy/status' }
      ]
    }
  ]
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderIndexHtml(data) {
  const uiCards = data.uiTools.map(t => `
    <a class="card" href="${escapeHtml(t.path)}">
      <div class="card-title">${escapeHtml(t.name)}</div>
      <div class="card-path"><code>${escapeHtml(t.path)}</code></div>
      <div class="card-desc">${escapeHtml(t.desc)}</div>
    </a>`).join('');

  const groupSections = data.groups.map(g => {
    const rows = g.endpoints.map(ep => {
      const tryLink = ep.example
        ? `<a class="try" href="${escapeHtml(ep.example)}" target="_blank" rel="noopener">Try →</a>`
        : `<span class="try-disabled" title="No example available">—</span>`;
      return `
        <tr>
          <td class="ep-path"><code>${escapeHtml(ep.path)}</code></td>
          <td class="ep-desc">${escapeHtml(ep.desc || '')}</td>
          <td class="ep-try">${tryLink}</td>
        </tr>`;
    }).join('');
    return `
      <section>
        <h2>${escapeHtml(g.name)}</h2>
        <table>
          <thead><tr><th>Endpoint</th><th>Description</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(data.message)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 32px auto; max-width: 1100px; padding: 0 20px; line-height: 1.5; color: #222; }
    h1 { margin: 0 0 4px; }
    p.lead { margin: 0 0 24px; color: #666; }
    h2 { margin: 32px 0 10px; padding-bottom: 4px; border-bottom: 1px solid #ddd; color: #333; }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; margin: 12px 0 24px; }
    .card { display: block; padding: 14px 16px; border: 1px solid #ddd; border-radius: 8px; text-decoration: none; color: inherit; background: #fafafa; transition: background 0.15s, border-color 0.15s; }
    .card:hover { background: #f0f4ff; border-color: #99b2ff; }
    .card-title { font-weight: 600; color: #1a4dcc; }
    .card-path { font-size: 12px; color: #666; margin: 2px 0 6px; }
    .card-desc { font-size: 13px; color: #444; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #eee; vertical-align: top; }
    th { font-size: 12px; text-transform: uppercase; color: #888; font-weight: 600; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; font-size: 13px; word-break: break-all; }
    .ep-path { width: 50%; }
    .ep-desc { color: #555; }
    .ep-try { width: 70px; text-align: right; white-space: nowrap; }
    .try { display: inline-block; padding: 4px 10px; background: #1a4dcc; color: white; border-radius: 4px; text-decoration: none; font-size: 12px; }
    .try:hover { background: #133da6; }
    .try-disabled { color: #ccc; font-size: 16px; }
    footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #eee; font-size: 13px; color: #888; }
    footer a { color: #1a4dcc; }
  </style>
</head>
<body>
  <h1>${escapeHtml(data.message)}</h1>
  <p class="lead">
    Browse the UI tools and try API endpoints directly.
    Full parameter docs: <a href="/docs"><strong>API Reference</strong></a>.
    Machine-readable index: <a href="/?format=json"><code>/?format=json</code></a>.
  </p>

  <h2>UI Tools</h2>
  <div class="cards">${uiCards}</div>

  ${groupSections}

  <footer>
    See the <a href="/docs">API Reference</a> for full parameter docs
    (raw markdown at <a href="/api-reference.md"><code>/api-reference.md</code></a>).
  </footer>
</body>
</html>`;
}

app.get('/', (req, res) => {
  if (req.query.format === 'json') {
    return res.json(indexData);
  }
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(renderIndexHtml(indexData));
});

// Raw markdown of the API reference, served straight from the repo root.
// Re-read on every request so edits to API_REFERENCE.md show up without a
// server restart.
const API_REFERENCE_PATH = path.join(__dirname, '..', 'API_REFERENCE.md');
app.get('/api-reference.md', (req, res) => {
  fs.readFile(API_REFERENCE_PATH, 'utf8', (err, data) => {
    if (err) {
      return res.status(404).type('text/plain').send('API_REFERENCE.md not found');
    }
    res.set('Content-Type', 'text/markdown; charset=utf-8');
    res.send(data);
  });
});

// Pretty-rendered docs page. Fetches the markdown above and renders it
// client-side via marked.js (CDN) — no build step, stays in sync with the file.
app.get('/docs', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
  <link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png" />
  <link rel="icon" type="image/png" sizes="512x512" href="/favicon-512.png" />
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
  <title>API Reference</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/github-markdown-css@5.5.1/github-markdown-light.css" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github.min.css" />
  <style>
    body { margin: 0; background: #fff; color: #24292f; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .topbar { position: sticky; top: 0; z-index: 10; background: rgba(255,255,255,0.95); backdrop-filter: blur(6px); border-bottom: 1px solid #d8dee4; padding: 10px 20px; display: flex; align-items: center; gap: 16px; }
    .topbar a { color: #1a4dcc; text-decoration: none; font-size: 14px; font-weight: 600; }
    .topbar a:hover { text-decoration: underline; }
    .topbar .sep { color: #d8dee4; }
    .topbar .raw { margin-left: auto; font-size: 13px; color: #57606a; font-weight: 400; }
    .markdown-body { box-sizing: border-box; max-width: 980px; margin: 24px auto 80px; padding: 0 24px; }
    .markdown-body pre { position: relative; }
    .markdown-body pre code.hljs { background: #f6f8fa; }
    @media (max-width: 767px) { .markdown-body { padding: 0 16px; margin: 16px auto 60px; } }
  </style>
</head>
<body>
  <div class="topbar">
    <a href="/">\u2190 Index</a>
    <span class="sep">|</span>
    <strong>API Reference</strong>
    <span class="raw"><a href="/api-reference.md">view raw markdown</a></span>
  </div>
  <article id="content" class="markdown-body">Loading\u2026</article>

  <script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/highlight.min.js"></script>
  <script>
    (async () => {
      const target = document.getElementById('content');
      try {
        const res = await fetch('/api-reference.md', { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const md = await res.text();
        marked.setOptions({ gfm: true, breaks: false, headerIds: true, mangle: false });
        target.innerHTML = marked.parse(md);
        // Syntax highlight all code blocks
        document.querySelectorAll('pre code').forEach(b => { try { hljs.highlightElement(b); } catch (_) {} });
        // Anchor scroll if URL had a hash
        if (location.hash) {
          const el = document.getElementById(location.hash.slice(1));
          if (el) el.scrollIntoView();
        }
      } catch (e) {
        target.innerHTML = '<p style="color:#b42318;">Failed to load API_REFERENCE.md: ' + (e && e.message ? e.message : e) + '</p>';
      }
    })();
  </script>
</body>
</html>`);
});

// Debug endpoint to verify proxy configuration
app.get('/api/proxy/status', (req, res) => {
  const { getPlaywrightProxyConfig, isProxyEnabled } = require('./proxy-config');
  
  const useProxy = req.query.proxy !== undefined 
    ? req.query.proxy !== 'false' && req.query.proxy !== '0'
    : null;
  
  const proxyConfig = getPlaywrightProxyConfig('oxylabs', useProxy);
  
  const hasCredentials = !!(
    process.env.OXYLABS_PROXY_SERVER &&
    process.env.OXYLABS_USERNAME &&
    process.env.OXYLABS_PASSWORD
  );
  
  res.json({
    proxyEnabled: isProxyEnabled(useProxy),
    hasCredentials: hasCredentials,
    proxyServer: proxyConfig?.server || null,
    requestedOverride: req.query.proxy || 'default',
    message: proxyConfig 
      ? 'Proxy is configured and will be used'
      : hasCredentials 
        ? 'Proxy credentials exist but proxy is disabled via parameter'
        : 'Proxy credentials not configured'
  });
});

if (require.main === module) {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
  });
}

module.exports = app;
