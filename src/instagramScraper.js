const { chromium } = require('playwright');
const { getPlaywrightProxyConfig, isProxyEnabled } = require('./proxy-config');

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

/**
 * Parse count to number (handles numbers, commas, K/M/B abbreviations)
 * @param {string|number|null|undefined} value
 * @returns {number|null} Parsed integer or null
 */
function parseCount(value) {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value) : null;
  }
  if (typeof value !== 'string') return null;

  const clean = value.trim().replace(/,/g, '').toUpperCase();
  const match = clean.match(/(\d+(?:\.\d+)?)\s*([KMB])?/);
  if (!match) return null;

  const num = parseFloat(match[1]);
  const suffix = (match[2] || '').toUpperCase();
  if (isNaN(num)) return null;

  switch (suffix) {
    case 'K': return Math.round(num * 1_000);
    case 'M': return Math.round(num * 1_000_000);
    case 'B': return Math.round(num * 1_000_000_000);
    default: return Math.round(num);
  }

}

/**
 * Extract from script[type="application/ld+json"] blocks
 */
async function extractFromLdJson(page) {
  try {
    const isVideoOnPage = !!(await page.$('video'));
    const blocks = await page.$$eval('script[type="application/ld+json"]', nodes => nodes.map(n => n.textContent).filter(Boolean));
    for (const raw of blocks) {
      try {
        const json = JSON.parse(raw);
        const objects = Array.isArray(json) ? json : [json];
        for (const obj of objects) {
          const created = obj.uploadDate || obj.datePublished || obj.dateCreated || null;
          const description = (typeof obj.caption === 'string' && obj.caption.trim()) ? obj.caption.trim() : (typeof obj.description === 'string' && obj.description.trim()) ? obj.description.trim() : null;
          // Try to pick a hero image from ld+json
          let hero = null;
          const imgVal = obj.thumbnailUrl || obj.image || null;
          if (typeof imgVal === 'string') hero = imgVal;
          else if (Array.isArray(imgVal)) {
            const first = imgVal[0];
            if (typeof first === 'string') hero = first;
            else if (first && typeof first === 'object' && typeof first.url === 'string') hero = first.url;
          } else if (imgVal && typeof imgVal === 'object' && typeof imgVal.url === 'string') {
            hero = imgVal.url;
          }
          const stats = extractInteractionStats(obj);
          // Try to derive author handle from ld+json author field
          let author_handle = null;
          const extractHandleFromString = (s) => {
            if (!s || typeof s !== 'string') return null;
            const at = s.match(/@([A-Za-z0-9._]{2,30})/);
            if (at) return at[1];
            // If no @, accept a simple handle-like token
            const m = s.match(/\b([A-Za-z0-9._]{2,30})\b/);
            return m ? m[1] : null;
          };
          if (obj.author) {
            if (typeof obj.author === 'string') {
              author_handle = extractHandleFromString(obj.author);
            } else if (typeof obj.author === 'object') {
              author_handle = extractHandleFromString(obj.author.alternateName || obj.author.name || obj.author.identifier || '');
            }
          }
          if (created || stats || description) {
            return {
              author_handle: author_handle,
              created_at: created ? toIso8601(created) : null,
              description: description || null,
              hero_image_url: hero || null,
              engagement: {
                likes: stats?.likes ?? null,
                comments: stats?.comments ?? null,
                views: isVideoOnPage ? (stats?.views ?? null) : null,
                shares: stats?.shares ?? null
              }
            };
          }
        }
      } catch (_) {}
    }
  } catch (_) {}
  return null;
}

function extractInteractionStats(obj) {
  const stats = obj.interactionStatistic || obj.interactionStatistics || null;
  if (!stats) return null;
  const arr = Array.isArray(stats) ? stats : [stats];
  let likes = null, comments = null, views = null, shares = null;
  for (const s of arr) {
    const type = (s?.interactionType?.['@type'] || s?.['@type'] || s?.interactionType || s?.name || '').toString().toLowerCase();
    const val = s?.userInteractionCount ?? s?.interactionCount ?? s?.count ?? null;
    if (!type) continue;
    if (type.includes('like')) likes = parseCount(val) ?? likes;
    else if (type.includes('comment')) comments = parseCount(val) ?? comments;
    else if (type.includes('view') || type.includes('watch')) views = parseCount(val) ?? views;
    else if (type.includes('share')) shares = parseCount(val) ?? shares;
  }
  if (likes === null && comments === null && views === null && shares === null) return null;
  return { likes, comments, views, shares };
}

/**
 * Convert various timestamp formats to ISO-8601
 * @param {number|string} value - Epoch seconds/ms or ISO string
 * @returns {string|null} ISO-8601 timestamp or null
 */
function toIso8601(value) {
  if (value === null || value === undefined || value === '') return null;

  // If it's already a string, handle numeric-like strings or ISO
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{10}$/.test(trimmed)) {
      const date = new Date(parseInt(trimmed, 10) * 1000);
      return isNaN(date.getTime()) ? null : date.toISOString();
    }
    if (/^\d{13}$/.test(trimmed)) {
      const date = new Date(parseInt(trimmed, 10));
      return isNaN(date.getTime()) ? null : date.toISOString();
    }
    const date = new Date(trimmed);
    return isNaN(date.getTime()) ? null : date.toISOString();
  }

  // If it's a number, determine if it's seconds or milliseconds
  if (typeof value === 'number') {
    const ms = value.toString().length === 10 ? value * 1000 : value;
    const date = new Date(ms);
    return isNaN(date.getTime()) ? null : date.toISOString();
  }

  return null;
}

/**
 * Singleton browser instance for Instagram scraping
 */
let browserInstance = null;

async function getBrowser() {
  if (!browserInstance) {
    browserInstance = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }
  return browserInstance;
}

async function createContext(browser, mode, proxyConfig = null) {
  const isMobile = mode === 'mobile';
  const contextOptions = {
    userAgent: isMobile ? MOBILE_UA : DESKTOP_UA,
    viewport: isMobile ? { width: 390, height: 844 } : { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'UTC',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' }
  };

  // Add proxy configuration if provided
  if (proxyConfig) {
    contextOptions.proxy = proxyConfig;
    console.log('[Instagram] Using proxy:', proxyConfig.server);
  }

  return browser.newContext(contextOptions);
}

/**
 * Capture a viewport screenshot and store it as a data URL under debugData.screenshots[label]
 */
async function captureDebugScreenshot(page, label, debugData) {
  try {
    // Limit total screenshots to avoid huge responses
    if (debugData && debugData.screenshots && Object.keys(debugData.screenshots).length >= 6) return;
    const buf = await page.screenshot({ type: 'jpeg', quality: 55, fullPage: false });
    const b64 = buf.toString('base64');
    if (!debugData.screenshots) debugData.screenshots = {};
    debugData.screenshots[label] = `data:image/jpeg;base64,${b64}`;
  } catch (_) {}
}


/**
 * Scrape Instagram post metrics using Playwright
 * @param {string} url - Instagram post URL
 * @returns {Promise<Object>} Scraped data
 */
async function scrapeInstagramPost(url, opts = {}) {
  const browser = await getBrowser();
  let context = null;
  let page = null;
  const debug = !!opts.debug;
  const fast = (opts.fast != null) ? !!opts.fast : !debug;
  const noMobile = !!opts.no_mobile;
  const maxWaitMs = (opts.maxWaitMs != null ? Number(opts.maxWaitMs) : null);
  const useProxy = opts.useProxy !== undefined ? opts.useProxy : null; // null = default (enabled if creds exist)
  const startedAt = Date.now();
  
  // Get proxy configuration with runtime override
  const proxyConfig = getPlaywrightProxyConfig('oxylabs', useProxy);
  if (isProxyEnabled(useProxy) && proxyConfig) {
    console.log('[Instagram] Proxy enabled for request');
  } else if (useProxy === false) {
    console.log('[Instagram] Proxy explicitly disabled for request');
  }
  const rb = (def) => {
    if (!Number.isFinite(maxWaitMs)) return def;
    const rem = maxWaitMs - (Date.now() - startedAt);
    return Math.max(300, Math.min(def, rem));
  };
  const gotoWaitUntil = fast ? 'domcontentloaded' : 'networkidle';
  const selectorWaitMs = rb(fast ? 5000 : 10000);
  const responseWaitMs = rb(fast ? 5000 : 10000);
  const postWaitMs = rb(fast ? 500 : 3000);
  const debugData = { capturedCount: 0, capturedUrls: [], path: null, attempts: [], screenshots: {} };
  const captureResponder = (capturedJson) => async (response) => {
    const rurl = response.url().toLowerCase();
    const contentType = (response.headers()['content-type'] || '').toLowerCase();
    if (contentType.includes('application/json') && (
      rurl.includes('graphql') || rurl.includes('/api/') || rurl.includes('xdt') || rurl.includes('shortcode') || rurl.includes('/reel') || rurl.includes('media')
    )) {
      try {
        const text = await response.text();
        if (text && text.length < 200000) {
          const data = JSON.parse(text);
          capturedJson.push(data);
          debugData.capturedCount += 1;
          if (debug && debugData.capturedUrls.length < 10) debugData.capturedUrls.push(rurl);
        }
      } catch (e) {}

    }
  };
  
  try {
    // Create new context and page for each request
    context = await createContext(browser, 'desktop', proxyConfig);

    // Block heavy resource types (allow CSS/JS/HTML)
    await context.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (!debug && (type === 'image' || type === 'media' || type === 'font')) {
        return route.abort();
      }
      return route.continue();
    });

    page = await context.newPage();
    
    // Store captured JSON responses
    const capturedJson = [];
    
    page.on('response', captureResponder(capturedJson));
    
    // Navigate with timeout
    await page.goto(url, { 
      waitUntil: gotoWaitUntil,
      timeout: rb(20000) 
    });
    if (debug) { await captureDebugScreenshot(page, 'desktop_before', debugData).catch(() => {}); }
    
    // Try to dismiss cookie/login overlays
    await dismissOverlays(page, debug ? debugData : null, fast).catch(() => {});

    // Wait for core content & try to await a media-related JSON response
    await page.waitForSelector('article, main, [role="main"]', { timeout: selectorWaitMs }).catch(() => {});
    if (!fast) { await scrollPageForLoad(page).catch(() => {}); }
    let result = null;
    if (fast) {
      try {
        result = await extractFromEmbeddedJson(page);
        if (!result) result = await extractFromDom(page);
      } catch (_) {}
    }
    if (!result) {
      await Promise.race([
        waitForShortcodeJson(page, capturedJson, responseWaitMs),
        waitForMediaJson(page, capturedJson, responseWaitMs)
      ]).catch(() => {});
      if (capturedJson.length === 0) {
        await page.waitForTimeout(postWaitMs);
      }
    }

    // Lightweight description fill: even in fast mode, try to fetch caption from DOM if still missing
    if (result && !result.description) {
      try {
        const desc = await extractDescriptionFromDom(page);
        if (desc) result.description = desc;
      } catch (_) {}
    }
    if (debug) { await captureDebugScreenshot(page, 'desktop_after', debugData).catch(() => {}); }
    
    // Try extraction in order of preference
    if (!result) {
      result = await extractFromCapturedJson(capturedJson);
    }
    if (!result) {
      result = await extractFromEmbeddedJson(page);
    }
    if (!result) {
      result = await extractFromLdJson(page);
    }
    if (!result) {
      result = await extractFromDom(page);
    }
    // If we have a partial result (e.g., missing likes/comments/author), enrich from DOM
    if (result && !fast) {
      try {
        const isVideoOnPage = !!(await page.$('video'));
        const domSupp = await extractFromDom(page);
        if (domSupp) {
          result.author_handle = result.author_handle || domSupp.author_handle || null;
          result.created_at = result.created_at || domSupp.created_at || null;
          if (!result.description && domSupp.description) result.description = domSupp.description;
          result.engagement = result.engagement || { likes: null, comments: null, views: null, shares: null };
          if (result.engagement.likes == null) result.engagement.likes = domSupp.engagement?.likes ?? null;
          if (result.engagement.comments == null) result.engagement.comments = domSupp.engagement?.comments ?? null;
          if (!isVideoOnPage) {
            result.engagement.views = null;
          } else if (result.engagement.views == null) {
            result.engagement.views = domSupp.engagement?.views ?? null;
          }
        }
      } catch (_) {}
    }

    // Final description fill regardless of fast mode
    if (result && !result.description) {
      try {
        const desc = await extractDescriptionFromDom(page);
        if (desc) result.description = desc;
      } catch (_) {}
    }
    // Final hero image fill regardless of fast mode
    if (result && !result.hero_image_url) {
      try {
        const h = await extractHeroImageFromDom(page);
        if (h) result.hero_image_url = h;
      } catch (_) {}
    }

    if (!result) {
      // mobile fallback
      if (noMobile) { throw new Error('Could not extract post data from page'); }
      if (page) await page.close();
      if (context) await context.close();

      const capturedJson2 = capturedJson;
      context = await createContext(browser, 'mobile', proxyConfig);
      await context.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (!debug && (type === 'image' || type === 'media' || type === 'font')) return route.abort();
        return route.continue();
      });
      page = await context.newPage();
      page.on('response', captureResponder(capturedJson2));
      await page.goto(url, { waitUntil: gotoWaitUntil, timeout: rb(20000) });
      if (debug) { await captureDebugScreenshot(page, 'mobile_before', debugData).catch(() => {}); }
      await dismissOverlays(page, debug ? debugData : null, fast).catch(() => {});
      await page.waitForSelector('article, main, [role="main"]', { timeout: selectorWaitMs }).catch(() => {});
      if (!fast) { await scrollPageForLoad(page).catch(() => {}); }
      await Promise.race([
        waitForShortcodeJson(page, capturedJson2, responseWaitMs),
        waitForMediaJson(page, capturedJson2, responseWaitMs)
      ]).catch(() => {});
      if (capturedJson2.length === 0) {
        await page.waitForTimeout(postWaitMs);
      }
      if (debug) { await captureDebugScreenshot(page, 'mobile_after', debugData).catch(() => {}); }

      result = await extractFromCapturedJson(capturedJson2) || await extractFromEmbeddedJson(page) || await extractFromLdJson(page) || await extractFromDom(page);

      // Final description fill in mobile flow
      if (result && !result.description) {
        try {
          const descM = await extractDescriptionFromDom(page);
          if (descM) result.description = descM;
        } catch (_) {}
      }
      // Final hero image fill in mobile flow
      if (result && !result.hero_image_url) {
        try {
          const hm = await extractHeroImageFromDom(page);
          if (hm) result.hero_image_url = hm;
        } catch (_) {}
      }

      if (!result) { throw new Error('Could not extract post data from page'); }
    }

    if (debug) { return { ...result, debug: debugData }; }
    return result;
    
  } finally {
    if (page) await page.close();
    if (context) await context.close();
  }
}

/**
 * Best-effort dismissal of cookie/login overlays to reveal counters
 */
async function dismissOverlays(page, debugData, fast = false) {
  const candidates = [
    'button:has-text("Accept All")',
    'button:has-text("Accept")',
    'button:has-text("Allow all cookies")',
    'button:has-text("Only allow essential")',
    'button:has-text("Only essential")',
    'div[role="dialog"] button:has-text("Not Now")',
    'button:has-text("Not Now")',
    '[aria-label="Close"], button[aria-label="Close"], [role="dialog"] [aria-label="Close"]',
  ];

  for (const sel of candidates) {
    try {
      const locator = page.locator(sel).first();
      if (await locator.count() > 0 && await locator.isVisible()) {
        await locator.click({ timeout: 1000 });
        await page.waitForTimeout(fast ? 100 : 300);
      }
    } catch (_) {}
  }

  // Try Escape key to close dialogs
  try { await page.keyboard.press('Escape'); } catch (_) {}

  // As a last resort, hide modal dialogs via CSS so we can read counts behind them
  try {
    await page.addStyleTag({ content: `
      div[role="dialog"], div[aria-modal="true"], [role="dialog"] *, [aria-modal="true"] * {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
      }
      body { overflow: auto !important; }
    `});
  } catch (_) {}
  try { if (debugData) { await captureDebugScreenshot(page, 'after_overlay_hide', debugData); } } catch (_) {}
}

/**
 * Scroll to trigger lazy loads and counters rendering
 */
async function scrollPageForLoad(page) {
  try {
    await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); });
    await page.waitForTimeout(500);
    await page.evaluate(() => { window.scrollTo(0, 0); });
    await page.waitForTimeout(300);
  } catch (_) {}
}

/**
 * Wait for a likely media-related JSON network response and capture it
 */
async function waitForMediaJson(page, capturedJson, timeoutMs) {
  const predicate = async (response) => {
    try {
      const url = response.url().toLowerCase();
      const contentType = (response.headers()['content-type'] || '').toLowerCase();
      if (!contentType.includes('application/json')) return false;
      if (!(url.includes('graphql') || url.includes('/api/') || url.includes('xdt') || url.includes('shortcode') || url.includes('/reel') || url.includes('media'))) return false;
      const text = await response.text();
      if (!text || text.length > 200000) return false;
      const data = JSON.parse(text);
      capturedJson.push(data);
      return true;
    } catch (_) {
      return false;
    }
  };
  await page.waitForResponse(predicate, { timeout: timeoutMs ?? 10000 });
}

/**
 * Wait for Instagram shortcode media JSON specifically and capture it
 */
async function waitForShortcodeJson(page, capturedJson, timeoutMs) {
  const predicate = async (response) => {
    try {
      const url = response.url().toLowerCase();
      const contentType = (response.headers()['content-type'] || '').toLowerCase();
      if (!contentType.includes('application/json')) return false;
      if (!(url.includes('graphql') || url.includes('/api/') || url.includes('xdt') || url.includes('shortcode'))) return false;
      const text = await response.text();
      if (!text || text.length > 300000) return false;
      const data = JSON.parse(text);
      // Heuristic: contains shortcode media data
      const hasShortcode = !!(
        data?.data?.xdt_shortcode_media ||
        data?.graphql?.shortcode_media ||
        data?.shortcode_media ||
        (Array.isArray(data?.items) && data.items[0]?.code)
      );
      if (!hasShortcode) return false;
      capturedJson.push(data);
      return true;
    } catch (_) { return false; }
  };
  await page.waitForResponse(predicate, { timeout: timeoutMs ?? 10000 });
}

/**
 * Extract data from captured JSON responses
 */
async function extractFromCapturedJson(capturedJson) {
  for (const data of capturedJson) {
    // Look for media/post data in various possible structures
    const media = findMediaInJson(data);
    if (media) {
      const isVideo = isVideoMedia(media);
      const desc = extractCaption(media) || findCaptionInJson(media) || findCaptionInJson(data);
      return {
        author_handle: extractAuthorHandle(media),
        created_at: extractCreatedAt(media),
        description: desc || null,
        hero_image_url: extractHeroImage(media) || null,
        engagement: {
          likes: parseCount(extractLikes(media)),
          comments: parseCount(extractComments(media)),
          views: isVideo ? parseCount(extractViews(media)) : null,
          shares: null // Shares are rarely available publicly
        }
      };
    }
  }
  return null;
}

/**
 * Extract data from embedded JSON in HTML
 */
async function extractFromEmbeddedJson(page) {
  try {
    // Look for common script tags that contain embedded data
    const scripts = await page.$$eval('script', scripts => 
      scripts
        .map(script => script.textContent)
        .filter(content => content && (
          content.includes('window._sharedData') ||
          content.includes('window.__additionalDataLoaded') ||
          content.includes('instagram') ||
          content.includes('media')
        ))
    );
    
    for (const scriptContent of scripts) {
      try {
        // Try to extract JSON from script content
        const jsonMatch = scriptContent.match(/(?:window\._sharedData\s*=\s*|window\.__additionalDataLoaded\s*\([^,]+,\s*)({.+?})(?:\s*;|\s*\))/);
        if (jsonMatch) {
          const data = JSON.parse(jsonMatch[1]);
          const media = findMediaInJson(data);
          if (media) {
            const isVideo = isVideoMedia(media);
            const desc = extractCaption(media) || findCaptionInJson(media) || findCaptionInJson(data);
            return {
              author_handle: extractAuthorHandle(media),
              created_at: extractCreatedAt(media),
              description: desc || null,
              hero_image_url: extractHeroImage(media) || null,
              engagement: {
                likes: parseCount(extractLikes(media)),
                comments: parseCount(extractComments(media)),
                views: isVideo ? parseCount(extractViews(media)) : null,
                shares: null
              }
            };
          }
        }
      } catch (e) {
        // Continue to next script
      }
    }
  } catch (e) {
    // Ignore errors in embedded JSON extraction
  }
  
  return null;
}

/**
 * Extract data from DOM elements as fallback
 */
async function extractFromDom(page) {
  try {
    const result = {
      author_handle: null,
      created_at: null,
      description: null,
      hero_image_url: null,
      engagement: {
        likes: null,
        comments: null,
        views: null,
        shares: null
      }
    };
    const isVideo = await page.evaluate(() => !!document.querySelector('video'));
    
    // Try to get author handle
    try {
      const authorHandle = await page.evaluate(() => {
        const handlePattern = /^[A-Za-z0-9._]{2,30}$/;
        const disallow = new Set(['p','reel','reels','tv','explore','stories','accounts','about','developer','legal','privacy','api','support','help','ads','press','blog']);
        let candidate = null;

        // Prefer header area
        const header = document.querySelector('article header, main header, [role="main"] header');
        const headerAnchors = header ? Array.from(header.querySelectorAll('a[href^="/"]')) : [];
        for (const a of headerAnchors) {
          const txt = (a.textContent || '').trim();
          const href = a.getAttribute('href') || '';
          const m = href.match(/^\/([^\/\?#]+)(?:\/)?.*/);
          if (txt && handlePattern.test(txt)) return txt;
          if (m) {
            const h = m[1];
            if (!disallow.has(h.toLowerCase())) candidate = candidate || h;
          }
        }

        // Scan broader content for first valid profile anchor
        const anchors = Array.from(document.querySelectorAll('article a[href^="/"], main a[href^="/"], [role="main"] a[href^="/"]'));
        for (const a of anchors) {
          const txt = (a.textContent || '').trim();
          const href = a.getAttribute('href') || '';
          const m = href.match(/^\/([^\/\?#]+)(?:\/)?.*/);
          if (txt && handlePattern.test(txt)) return txt;
          if (m) {
            const h = m[1];
            if (!disallow.has(h.toLowerCase())) {
              // Avoid post and content paths
              if (!['p','reel','reels','tv'].includes(h.toLowerCase())) {
                candidate = candidate || h;
              }
            }
          }
        }

        // Fallbacks from meta tags
        const ogt = document.querySelector('meta[property="og:title"]');
        if (ogt) {
          const c = (ogt.getAttribute('content') || '').trim();
          let m = c.match(/^([^\s@]+)\s+on\s+Instagram/i);
          if (m && m[1] && handlePattern.test(m[1])) return m[1];
          m = c.match(/Instagram\s+post\s+by\s+([A-Za-z0-9._]{2,30})/i);
          if (m && m[1] && handlePattern.test(m[1])) return m[1];
        }
        const ogd = document.querySelector('meta[property="og:description"]') || document.querySelector('meta[name="description"]');
        if (ogd) {
          const c = (ogd.getAttribute('content') || '').trim();
          // Often contains "(@handle)"
          let m = c.match(/@([A-Za-z0-9._]{2,30})/);
          if (m && m[1] && handlePattern.test(m[1])) return m[1];
          // Or sometimes "by handle"
          m = c.match(/\bby\s+([A-Za-z0-9._]{2,30})\b/i);
          if (m && m[1] && handlePattern.test(m[1])) return m[1];
          // Or "- handle on Instagram"
          m = c.match(/-\s+([A-Za-z0-9._]{2,30})\s+on\s+Instagram/i);
          if (m && m[1] && handlePattern.test(m[1])) return m[1];
        }

        // Fallback from document title
        if (document && typeof document.title === 'string' && document.title) {
          const t = document.title.trim();
          let m = t.match(/^([^\s@]+)\s+on\s+Instagram/i);
          if (m && m[1] && handlePattern.test(m[1])) return m[1];
          m = t.match(/Instagram\s+(?:photo|post|reel|video)\s+by\s+([A-Za-z0-9._]{2,30})/i);
          if (m && m[1] && handlePattern.test(m[1])) return m[1];
          m = t.match(/@([A-Za-z0-9._]{2,30})/);
          if (m && m[1] && handlePattern.test(m[1])) return m[1];
        }

        // Fallback: profile picture alt text like "yingcartoonist's profile picture"
        const pimg = document.querySelector('img[alt$="profile picture"]');
        if (pimg) {
          const a = pimg.getAttribute('alt') || '';
          const m = a.match(/^([A-Za-z0-9._]{2,30})\'s profile picture$/);
          if (m && m[1] && handlePattern.test(m[1])) return m[1];
        }

        return candidate;
      });
      if (authorHandle) result.author_handle = authorHandle;
    } catch (e) {}
    
    // Try to get like count
    try {
      const likesText = await page.evaluate(() => {
        const el = document.querySelector('[aria-label*="like" i], [title*="like" i]');
        if (el && el.textContent) return el.textContent;
        const span = Array.from(document.querySelectorAll('span')).find(s => /\blikes?\b/i.test(s.innerText));
        return span ? span.innerText : null;
      });
      if (likesText) result.engagement.likes = parseCount(likesText);
    } catch (e) {}
    
    // Try to get comment count
    try {
      const commentsText = await page.evaluate(() => {
        const el = document.querySelector('[aria-label*="comment" i], [title*="comment" i]');
        if (el && el.textContent) return el.textContent;
        const span = Array.from(document.querySelectorAll('span')).find(s => /\bcomments?\b/i.test(s.innerText));
        return span ? span.innerText : null;
      });
      if (commentsText) result.engagement.comments = parseCount(commentsText);
    } catch (e) {}
    
    // Try to get view count (for reels/videos)
    try {
      const viewsText = await page.evaluate(() => {
        const span = Array.from(document.querySelectorAll('span'))
          .find(s => /\b(views|plays)\b/i.test(s.innerText));
        return span ? span.innerText : null;
      });
      if (isVideo && viewsText) result.engagement.views = parseCount(viewsText);
    } catch (e) {}
    
    // Text-based fallback: parse numbers followed by labels within the main content area
    try {
      const tokens = await page.evaluate(() => {
        const root = document.querySelector('article, main, [role="main"]') || document.body;
        const text = (root && root.innerText) ? root.innerText : '';
        const findToken = (re) => {
          const m = text.match(re);
          return m ? (m[1] || m[0]) : null;
        };
        const likesToken = findToken(/([0-9][0-9,.]*\s*[KMB]?)\s+likes?/i) || findToken(/and\s+([0-9][0-9,.]*\s*[KMB]?)\s+others/i) || findToken(/([0-9][0-9,.]*\s*[KMB]?)\s+others/i);
        const viewsToken = findToken(/([0-9][0-9,.]*\s*[KMB]?)\s+views?/i) || findToken(/([0-9][0-9,.]*\s*[KMB]?)\s+plays?/i);
        const commentsToken = findToken(/view all\s+([0-9][0-9,.]*\s*[KMB]?)\s+comments?/i) || findToken(/([0-9][0-9,.]*\s*[KMB]?)\s+comments?/i);
        return { likesToken, commentsToken, viewsToken };
      });
      if (result.engagement.likes == null && tokens && tokens.likesToken) {
        result.engagement.likes = parseCount(tokens.likesToken);
      }
      if (isVideo && result.engagement.views == null && tokens && tokens.viewsToken) {
        result.engagement.views = parseCount(tokens.viewsToken);
      }
      if (result.engagement.comments == null && tokens && tokens.commentsToken) {
        result.engagement.comments = parseCount(tokens.commentsToken);
      }
    } catch (_) {}

    // Icon-adjacent fallback: find numeric text near like/comment icons
    try {
      const nearCounts = await page.evaluate(() => {
        const out = { likeNear: null, commentNear: null };
        const icons = Array.from(document.querySelectorAll('svg[aria-label]'));
        const getNearNumber = (el) => {
          const container = el.closest('section, article, div') || el.parentElement;
          if (!container) return null;
          const texts = [];
          const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
          let node;
          while ((node = walker.nextNode())) {
            const t = (node.nodeValue || '').trim();
            if (t) texts.push(t);
            if (texts.length > 400) break;
          }
          const joined = texts.join(' ');
          const m = joined.match(/([0-9][0-9,.]*\s*[KMB]?)/);
          return m ? m[1] : null;
        };
        for (const i of icons) {
          const label = (i.getAttribute('aria-label') || '').toLowerCase();
          if (!out.likeNear && (label.includes('like') || label.includes('unlike') || label.includes('heart'))) {
            out.likeNear = getNearNumber(i);
          }
          if (!out.commentNear && label.includes('comment')) {
            out.commentNear = getNearNumber(i);
          }
          if (out.likeNear && out.commentNear) break;
        }
        return out;
      });
      if (result.engagement.likes == null && nearCounts && nearCounts.likeNear) {
        result.engagement.likes = parseCount(nearCounts.likeNear);
      }
      if (result.engagement.comments == null && nearCounts && nearCounts.commentNear) {
        result.engagement.comments = parseCount(nearCounts.commentNear);
      }
    } catch (_) {}

    // Meta description fallback (often includes "X likes, Y comments")
    try {
      const content = await page.$eval('meta[property="og:description"]', el => el.getAttribute('content') || '');
      if (content) {
        const likesM = content.match(/([0-9][0-9,.]*\s*[KMB]?)\s+likes?/i);
        const commentsM = content.match(/([0-9][0-9,.]*\s*[KMB]?)\s+comments?/i);
        if (result.engagement.likes == null && likesM) {
          result.engagement.likes = parseCount(likesM[1]);
        }
        if (result.engagement.comments == null && commentsM) {
          result.engagement.comments = parseCount(commentsM[1]);
        }
      }
    } catch (_) {}

    // Created at from time tag (ISO in datetime attribute)
    try {
      const dt = await page.$eval('article time[datetime], main time[datetime], [role="main"] time[datetime]', el => el.getAttribute('datetime'));
      if (dt) {
        const iso = toIso8601(dt);
        if (iso) result.created_at = iso;
      }
    } catch (_) {}

    // Final fallback: infer author handle from visible header text tokens
    try {
      if (!result.author_handle) {
        const candidate = await page.evaluate(() => {
          const handlePattern = /^[A-Za-z0-9._]{2,30}$/;
          const disallow = new Set(['instagram','reels','reel','p','tv','explore','stories']);
          const header = document.querySelector('article header, main header, [role="main"] header') || document.querySelector('article, main, [role=\"main\"]');
          if (!header) return null;
          // Collect short tokens from header text
          const tokens = (header.innerText || '')
            .split(/\s+/)
            .map(t => t.trim())
            .filter(Boolean)
            .filter(t => handlePattern.test(t) && !disallow.has(t.toLowerCase()));
          return tokens.length ? tokens[0] : null;
        });
        if (candidate) result.author_handle = candidate;
      }
    } catch (_) {}
    
    // Attempt to extract hero image from DOM
    try {
      const h = await extractHeroImageFromDom(page);
      if (h) result.hero_image_url = h;
    } catch (_) {}

    return result;
    
  } catch (e) {
    return null;
  }
}

// Minimal DOM-only description extractor used for fast enrichment
async function extractDescriptionFromDom(page) {
  try {
    const description = await page.evaluate(() => {
      const tryMeta = () => {
        const metas = Array.from(document.querySelectorAll('meta[property="og:description"], meta[name="description"], meta[property="og:title"]'));
        for (const m of metas) {
          const c = (m.getAttribute('content') || '').trim();
          if (!c) continue;
          const q = c.match(/[“"][^”"]{2,1000}[”"]/);
          if (q && q[0]) return q[0].replace(/[“”"]/g, '').trim();
          let alt = c;
          alt = alt.replace(/^[^:]{1,100}:\s*/, '');
          alt = alt.split(' • ')[0].split(' - ')[0].trim();
          if (/[A-Za-z#@]/.test(alt) && alt.length >= 2) return alt;
        }
        return null;
      };
      const m = tryMeta();
      if (m) return m;
      const root = document.querySelector('article, main, [role="main"]') || document.body;
      const badRe = /(likes?|comments?|views?|plays?|view all|see translation|add a comment|replied?|following|follow|suggested for you)/i;
      const nodes = Array.from(root.querySelectorAll('ul li, h1, h2, h3, p, span, div'));
      const candidates = [];
      for (const el of nodes) {
        const t = (el.innerText || '').trim();
        if (!t || t.length < 2) continue;
        if (badRe.test(t)) continue;
        if ((/[A-Za-z]/.test(t) || /[#@]/.test(t)) && t.length <= 1000) candidates.push(t);
      }
      candidates.sort((a,b) => b.length - a.length);
      return candidates[0] || null;
    });
    return description || null;
  } catch (_) { return null; }
}

// Extract hero image URL from common media JSON shapes
function extractHeroImage(media) {
  try {
    // Mobile/private API shape
    if (media?.image_versions2?.candidates && Array.isArray(media.image_versions2.candidates) && media.image_versions2.candidates.length) {
      const sorted = media.image_versions2.candidates.slice().sort((a,b) => ((b.width||0)*(b.height||0)) - ((a.width||0)*(a.height||0)));
      const u = sorted[0]?.url || sorted[0]?.src;
      if (u) return u;
    }
    // Public GraphQL shape
    if (Array.isArray(media?.display_resources) && media.display_resources.length) {
      const sorted = media.display_resources.slice().sort((a,b) => ((b.config_width||0)*(b.config_height||0)) - ((a.config_width||0)*(a.config_height||0)));
      const u = sorted[0]?.src;
      if (u) return u;
    }
    if (typeof media?.display_url === 'string') return media.display_url;
    if (typeof media?.thumbnail_src === 'string') return media.thumbnail_src;
    if (typeof media?.thumbnail_url === 'string') return media.thumbnail_url;
    if (media?.thumbnail && typeof media.thumbnail.src === 'string') return media.thumbnail.src;
    // Sidecar: take first child
    if (media?.__typename === 'GraphSidecar' && media?.edge_sidecar_to_children?.edges?.length) {
      const child = media.edge_sidecar_to_children.edges[0]?.node;
      const u = extractHeroImage(child);
      if (u) return u;
    }
  } catch (_) {}
  return null;
}

// Extract hero image from DOM via meta tags or largest image in content
async function extractHeroImageFromDom(page) {
  try {
    const url = await page.evaluate(() => {
      const pickFromMeta = () => {
        const metas = Array.from(document.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"], meta[property="og:image:secure_url"]'));
        for (const m of metas) {
          const c = (m.getAttribute('content') || '').trim();
          if (c) return c;
        }
        return null;
      };
      const m = pickFromMeta();
      if (m) return m;
      const imgs = Array.from(document.querySelectorAll('article img, main img, [role="main"] img'));
      let best = null;
      let bestArea = 0;
      for (const img of imgs) {
        const srcset = img.getAttribute('srcset') || '';
        let candidate = (img.getAttribute('src') || img.getAttribute('data-src') || '').trim();
        if (srcset) {
          const parts = srcset.split(',').map(s => s.trim());
          for (const part of parts) {
            const u = part.split(' ')[0];
            if (u && u.startsWith('http')) candidate = u;
          }
        }
        const w = parseInt(img.getAttribute('width')||'0',10) || img.naturalWidth || 0;
        const h = parseInt(img.getAttribute('height')||'0',10) || img.naturalHeight || 0;
        const area = w*h;
        if (candidate && area >= bestArea) {
          best = candidate; bestArea = area;
        }
      }
      return best;
    });
    return url || null;
  } catch (_) { return null; }
}

/**
 * Find media object in JSON data
 */
function findMediaInJson(data) {
  // Common paths where media data might be found
  const paths = [
    data?.data?.xdt_api__v1__feed__user_timeline_graphql_connection?.edges?.[0]?.node,
    data?.data?.xdt_shortcode_media,
    data?.graphql?.shortcode_media,
    data?.entry_data?.PostPage?.[0]?.graphql?.shortcode_media,
    data?.items?.[0],
    data
  ];
  
  for (const item of paths) {
    if (item && (item.__typename === 'GraphImage' || item.__typename === 'GraphVideo' || item.__typename === 'GraphSidecar' || item.shortcode)) {
      return item;
    }
  }
  
  // Deep search fallback: traverse object graph to find likely media node
  try {
    const seen = new Set();
    const stack = [data];
    let iterations = 0;
    while (stack.length && iterations < 5000) {
      const node = stack.pop();
      iterations++;
      if (!node || typeof node !== 'object') continue;
      if (seen.has(node)) continue;
      seen.add(node);

      const shortcode = node.shortcode || node.code;
      const typename = node.__typename;
      const hasCounts = (
        node.edge_media_preview_like?.count !== undefined ||
        node.edge_liked_by?.count !== undefined ||
        node.like_count !== undefined ||
        node.comment_count !== undefined ||
        node.edge_media_to_comment?.count !== undefined ||
        node.edge_threaded_comments?.count !== undefined ||
        node.video_view_count !== undefined ||
        node.view_count !== undefined ||
        node.play_count !== undefined ||
        node.like_and_view_counts !== undefined
      );
      if ((typeof shortcode === 'string' && shortcode.length >= 5) ||
          typename === 'GraphImage' || typename === 'GraphVideo' || typename === 'GraphSidecar' || hasCounts) {
        return node;
      }

      // Push children
      for (const k of Object.keys(node)) {
        const v = node[k];
        if (v && typeof v === 'object') {
          if (Array.isArray(v)) {
            for (const it of v) stack.push(it);
          } else {
            stack.push(v);
          }
        }
      }
    }
  } catch (_) {}

  return null;
}

function extractAuthorHandle(media) {
  return media?.owner?.username || media?.user?.username || null;
}

// Determine if a media object represents a video or reel
function isVideoMedia(media) {
  if (!media || typeof media !== 'object') return false;
  if (media.is_video !== undefined) return !!media.is_video;
  if (typeof media.media_type === 'number') return media.media_type === 2; // IG API: 2 => video
  if (typeof media.__typename === 'string') {
    const t = media.__typename.toLowerCase();
    if (t.includes('video')) return true;
    if (t.includes('reel')) return true;
  }
  if (typeof media.product_type === 'string') {
    const p = media.product_type.toLowerCase();
    if (p.includes('clips') || p.includes('igtv') || p.includes('video') || p.includes('reel')) return true;
  }
  // Heuristics: presence of view/play counts strongly implies video
  if (media.video_view_count != null || media.view_count != null || media.play_count != null || media.video_play_count != null) return true;
  return false;
}

function extractCreatedAt(media) {
  const timestamp = media?.taken_at_timestamp || media?.taken_at || media?.create_time;
  return toIso8601(timestamp);
}

function extractLikes(media) {
  return media?.edge_liked_by?.count ||
         media?.edge_media_preview_like?.count || 
         media?.like_count || 
         media?.likes?.count || 
         media?.likes ||
         media?.video_like_count ||
         media?.like_and_view_counts?.like_count ||
         null;
}

function extractComments(media) {
  return media?.edge_media_to_parent_comment?.count ||
         media?.edge_media_to_comment?.count || 
         media?.edge_threaded_comments?.count ||
         media?.comment_count || 
         media?.comments?.count || 
         media?.comments ||
         media?.like_and_view_counts?.comment_count ||
         null;
}

function extractViews(media) {
  return media?.video_view_count || 
         media?.view_count || 
         media?.play_count ||
         media?.video_play_count ||
         media?.like_and_view_counts?.view_count ||
         media?.like_and_view_counts?.play_count ||
         (media?.dash_info?.is_dash_eligible ? media?.play_count : null) ||
         null;
}

function extractCaption(media) {
  try {
    const edges = media?.edge_media_to_caption?.edges;
    if (Array.isArray(edges) && edges.length) {
      const t = edges[0]?.node?.text;
      if (t) return t;
    }
    if (typeof media?.caption === 'string' && media.caption) return media.caption;
    if (media?.caption?.text) return media.caption.text;
    if (media?.caption_text) return media.caption_text;
    if (media?.title) return media.title;
  } catch (_) {}
  return null;
}

// Deep caption finder for varied JSON shapes
function findCaptionInJson(root) {
  try {
    const seen = new Set();
    const stack = [root];
    let found = null;
    let iter = 0;
    while (stack.length && iter < 8000 && !found) {
      const node = stack.pop();
      iter++;
      if (!node || typeof node !== 'object') continue;
      if (seen.has(node)) continue;
      seen.add(node);
      // Common patterns
      if (typeof node.text === 'string' && node.text.length >= 2) {
        // Likely from edge_media_to_caption.edges[].node.text
        if (/[A-Za-z#@]/.test(node.text)) {
          found = node.text;
          break;
        }
      }
      if (typeof node.caption === 'string' && node.caption.length >= 2) {
        found = node.caption;
        break;
      }
      if (node.caption && typeof node.caption.text === 'string' && node.caption.text.length >= 2) {
        found = node.caption.text;
        break;
      }
      if (typeof node.caption_text === 'string' && node.caption_text.length >= 2) {
        found = node.caption_text;
        break;
      }
      if (typeof node.title === 'string' && node.title.length >= 2) {
        found = node.title;
        break;
      }
      // Traverse children
      for (const k of Object.keys(node)) {
        const v = node[k];
        if (v && typeof v === 'object') {
          if (Array.isArray(v)) {
            for (const it of v) stack.push(it);
          } else {
            stack.push(v);
          }
        }
      }
    }
    return found || null;
  } catch (_) { return null; }
}

/**
 * Close the browser instance (for cleanup)
 */
async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

module.exports = {
  scrapeInstagramPost,
  parseCount,
  toIso8601,
  closeBrowser
};
