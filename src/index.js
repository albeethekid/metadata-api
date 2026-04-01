require('dotenv').config();

const YouTubeClient = require('./youtubeClient');
const { getTikTokVideoMetrics, TikTokMetricsError } = require('./tiktokMetrics');
const { getTikTokVideoMetricsYtdlp, TikTokYtdlpError } = require('./tiktokYtdlp');
const { scrapeInstagramPost } = require('./instagramScraper');
const express = require('express');
const app = express();
const port = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static('public'));

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
      for (let i = 0; i < out.length; i += 1) {
        const item = out[i];
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
            item.thumbnailUrl = null;
            failures.push({ channelHandle: item.channelHandle, channelUrl: item.channelUrl });
          }
        } catch (e) {
          item.thumbnailUrl = null;
          failures.push({ channelHandle: item.channelHandle, channelUrl: item.channelUrl });
          console.warn('TikTok screenshot thumbnail failed for', profileUrl, e?.message || e);
        }
      }

      if (failures.length > 0) {
        console.warn(`TikTok profiles: ${failures.length} screenshot(s) failed (thumbnailUrl set to null for those profiles)`, failures.map(f => f.channelHandle));
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

app.get('/', (req, res) => {
  res.json({
    message: 'Social Media Metadata API Server',
    ui: {
      csvGenerator: '/csv.html (Batch process URLs and download CSV)',
      channelSearch: '/channels.html (YouTube channel search CSV export)',
      screenshotTool: '/screenshot.html (Take screenshots and get public URLs or download CSV)'
    },
    endpoints: {
      chartmetric: '/api/chartmetric/metadata?url=<SPOTIFY_URL>&verbose=1 (Spotify tracks, albums, artists, playlists - includes streaming data)',
      spotify: '/api/spotify/metadata?url=<SPOTIFY_URL>&verbose=1 (Spotify shows, episodes - use Chartmetric for tracks/albums/artists/playlists)',
      video: '/api/video/:videoId?verbose=1 (YouTube video metadata)',
      search: '/api/search?q=query&maxResults=10 (YouTube video search)',
      searchChannels: '/api/search/channels?q=query&maxResults=10 (YouTube channel search)',
      channelVideos: '/api/channel/:channelId/videos?maxResults=10',
      trending: '/api/trending?regionCode=US&maxResults=10',
      videoComments: '/api/video/:videoId/comments?maxResults=20',
      channel: '/api/channel/:channelId',
      playlist: '/api/playlist/:playlistId?maxResults=50',
      tiktok: '/api/tiktok/video/metrics?url=<URL_ENCODED_TIKTOK_URL>',
      tiktokYtdlp: '/api/tiktok/ytdlp?url=<URL_ENCODED_TIKTOK_URL> (uses yt-dlp)',
      tiktokProfiles: '/api/tiktok/profiles?query=<SEARCH_TERM> (EnsembleData discovery)',
      instagramProfiles: '/api/instagram/profiles?query=<SEARCH_TERM> (EnsembleData discovery + Apify enrichment)',
      twitterProfiles: '/api/twitter/profiles?query=<SEARCH_TERM> (Apify xtdata/twitter-x-scraper)',
      instagram: '/api/instagram/video?url=<URL_ENCODED_INSTAGRAM_URL>',
      screenshot: '/api/screenshot?url=<URL_ENCODED_URL>&download=1&fullPage=1'
    },
    examples: {
      chartmetricTrack: '/api/chartmetric/metadata?url=https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp',
      chartmetricArtist: '/api/chartmetric/metadata?url=https://open.spotify.com/artist/7dIxU1XgxBIa3KJAWzaFAC',
      spotifyEpisode: '/api/spotify/metadata?url=https://open.spotify.com/episode/0L5BZId2ySpX6Ni64dbbhw',
      youtube: '/api/video/dQw4w9WgXcQ',
      tiktok: '/api/tiktok/video/metrics?url=https://www.tiktok.com/@user/video/1234567890'
    }
  });
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
