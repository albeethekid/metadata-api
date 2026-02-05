const YouTubeClient = require('./youtubeClient');
const { getTikTokVideoMetrics, TikTokMetricsError } = require('./tiktokMetrics');
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

  if (!url) {
    return res.status(400).json({ error: 'MISSING_URL' });
  }

  try {
    const payload = await getTikTokVideoMetrics(url, verbose);
    res.json(payload);
  } catch (error) {
    if (error instanceof TikTokMetricsError) {
      return res.status(error.status).json({ error: error.code });
    }

    console.error('Unexpected TikTok metrics error:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// Instagram endpoint for scraping post metrics
app.get('/api/instagram/video', async (req, res) => {
  const { url } = req.query;
  const debug = (req.query.debug === '1') || (req.query.verbose === '1');
  const acceptHeader = (req.headers && req.headers.accept) || '';

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
    const scrapedData = await scrapeInstagramPost(parsedUrl.decodedUrl, { debug });

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

app.get('/', (req, res) => {
  res.json({
    message: 'Social Video API Server',
    endpoints: {
      search: '/api/search?q=query&maxResults=10',
      video: '/api/video/:videoId?verbose=1 (verbose=1 returns full response, default returns compact)',
      channelVideos: '/api/channel/:channelId/videos?maxResults=10',
      trending: '/api/trending?regionCode=US&maxResults=10',
      videoComments: '/api/video/:videoId/comments?maxResults=20',
      channel: '/api/channel/:channelId',
      playlist: '/api/playlist/:playlistId?maxResults=50',
      tiktok: '/api/tiktok/video/metrics?url=<URL_ENCODED_TIKTOK_URL>',
      instagram: '/api/instagram/video?url=<URL_ENCODED_INSTAGRAM_URL>'
    }
  });
});

if (require.main === module) {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
  });
}

module.exports = app;
