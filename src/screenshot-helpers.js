const { chromium } = require('playwright');
const path = require('path');

async function createBrowserOrContext(profileMode = 'fresh', useProxy = null) {
  const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  
  const baseArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled'
  ];

  const baseOptions = {
    headless: true,
    args: baseArgs,
    viewport: { width: 1200, height: 800 },
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    userAgent: userAgent,
    bypassCSP: true,
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-User': '?1',
      'Sec-Fetch-Dest': 'document',
      'Upgrade-Insecure-Requests': '1'
    }
  };

  // Add proxy configuration if available
  if (useProxy !== false) {
    const { getPlaywrightProxyConfig, isProxyEnabled } = require('./proxy-config');
    const proxyConfig = getPlaywrightProxyConfig('oxylabs', useProxy);
    
    if (proxyConfig && isProxyEnabled(useProxy)) {
      baseOptions.proxy = proxyConfig;
      console.log('[Screenshot] Using proxy:', proxyConfig.server);
    }
  }

  if (profileMode === 'persistent') {
    const profilePath = path.join(__dirname, '..', 'reddit-profile');
    const context = await chromium.launchPersistentContext(profilePath, baseOptions);
    return { context, browser: null, isPersistent: true };
  } else {
    const browser = await chromium.launch({ headless: true, args: baseArgs });
    const context = await browser.newContext(baseOptions);
    return { context, browser, isPersistent: false };
  }
}

async function applyAntiDetection(context) {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined
    });

    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5]
    });

    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en']
    });

    window.chrome = {
      runtime: {}
    };

    Object.defineProperty(navigator, 'permissions', {
      get: () => ({
        query: () => Promise.resolve({ state: 'prompt' })
      })
    });

    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );

    Object.defineProperty(navigator, 'platform', {
      get: () => 'MacIntel'
    });

    Object.defineProperty(navigator, 'vendor', {
      get: () => 'Google Inc.'
    });
  });
}

function detectBlockPage(title, htmlSnippet) {
  const lowerTitle = (title || '').toLowerCase();
  const lowerSnippet = (htmlSnippet || '').toLowerCase();
  const combined = lowerTitle + ' ' + lowerSnippet;

  // More specific patterns to avoid false positives
  const blockIndicators = [
    { pattern: /just a moment|checking your browser|cloudflare.*security/i, reason: 'cloudflare' },
    { pattern: /akamai.*reference|akamai.*error/i, reason: 'akamai' },
    { pattern: /imperva.*incident/i, reason: 'imperva' },
    { pattern: /incapsula.*incident/i, reason: 'incapsula' },
    { pattern: /datadome/i, reason: 'datadome' },
    { pattern: /access denied/i, reason: 'generic' },
    { pattern: /request blocked/i, reason: 'generic' },
    { pattern: /attention required.*cloudflare/i, reason: 'generic' },
    { pattern: /403 forbidden/i, reason: 'generic' },
    { pattern: /not authorized to access/i, reason: 'generic' },
    { pattern: /bot detection/i, reason: 'generic' },
    { pattern: /unusual traffic/i, reason: 'generic' },
    { pattern: /please complete.*captcha|verify you are human|solve.*captcha/i, reason: 'captcha' },
    { pattern: /security challenge|complete.*challenge/i, reason: 'challenge' }
  ];

  for (const { pattern, reason } of blockIndicators) {
    if (pattern.test(combined)) {
      return { blocked: true, reason };
    }
  }

  return { blocked: false, reason: null };
}

async function handleRedditPage(page, debugMode = false) {
  const REDDIT_SETTLE_BUDGET_MS = 5000;
  const deadline = Date.now() + REDDIT_SETTLE_BUDGET_MS;
  const redditSettleStart = Date.now();
  
  page.setDefaultTimeout(REDDIT_SETTLE_BUDGET_MS);
  
  if (debugMode) console.log('[Reddit] Settle started, budget:', REDDIT_SETTLE_BUDGET_MS, 'ms');
  
  const selectors = [
    'button:has-text("Accept All")',
    'button:has-text("Accept all")',
    'button:has-text("Accept")',
    'button:has-text("I Agree")',
    'button:has-text("Continue")',
    '[aria-label="Close"]',
    'button[aria-label="Close"]',
    '[role="dialog"] button:has-text("Not Now")',
    'button:has-text("Not Now")'
  ];

  for (const sel of selectors) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      if (debugMode) console.log('[Reddit] Budget exhausted during popup dismissal');
      break;
    }
    try {
      const loc = page.locator(sel).first();
      if (await loc.count() && await loc.isVisible()) {
        await loc.click({ timeout: Math.min(800, remaining) }).catch(() => {});
        await page.waitForTimeout(100);
      }
    } catch {}
  }

  const remaining1 = deadline - Date.now();
  if (remaining1 <= 0) {
    if (debugMode) console.log('[Reddit] Budget exhausted, total:', Date.now() - redditSettleStart, 'ms');
    return;
  }
  await page.waitForTimeout(Math.min(150, remaining1));

  const postContainer = page.locator('shreddit-post, [data-testid="post-container"]').first();
  const hasPost = await postContainer.count() > 0;

  if (!hasPost) {
    if (debugMode) console.log('[Reddit] No post container found');
    return;
  }

  const remaining2 = deadline - Date.now();
  if (remaining2 <= 0) {
    if (debugMode) console.log('[Reddit] Budget exhausted, total:', Date.now() - redditSettleStart, 'ms');
    return;
  }

  await postContainer.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(Math.min(150, remaining2));

  const remaining3 = deadline - Date.now();
  if (remaining3 <= 0) {
    if (debugMode) console.log('[Reddit] Budget exhausted, total:', Date.now() - redditSettleStart, 'ms');
    return;
  }

  await page.evaluate(() => {
    window.scrollBy(0, window.innerHeight * 0.3);
  });
  await page.waitForTimeout(Math.min(200, remaining3));
  
  const remaining4 = deadline - Date.now();
  if (remaining4 <= 0) {
    if (debugMode) console.log('[Reddit] Budget exhausted, total:', Date.now() - redditSettleStart, 'ms');
    return;
  }

  await postContainer.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(Math.min(150, remaining4));

  const remaining5 = deadline - Date.now();
  if (remaining5 <= 100) {
    if (debugMode) console.log('[Reddit] Budget exhausted before media wait, total:', Date.now() - redditSettleStart, 'ms');
    return;
  }

  const initialWaitTimeout = Math.min(3000, remaining5);
  if (debugMode) console.log('[Reddit] Initial media wait, timeout:', initialWaitTimeout, 'ms');

  const mediaReady = await page.waitForFunction(() => {
    const postEl = document.querySelector('shreddit-post, [data-testid="post-container"]');
    if (!postEl) return true;

    const imgs = Array.from(postEl.querySelectorAll('img'));
    const videos = Array.from(postEl.querySelectorAll('video'));
    const allMedia = [...imgs, ...videos];
    
    const candidateMedia = allMedia.filter(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 50 || rect.height < 50) return false;
      if (rect.width === 0 || rect.height === 0) return false;
      
      if (el.tagName === 'IMG') {
        const s = (el.currentSrc || el.src || '').toLowerCase();
        return s.includes('redd.it') || s.includes('preview') || s.includes('external-preview');
      }
      
      if (el.tagName === 'VIDEO') {
        return true;
      }
      
      return false;
    });

    if (candidateMedia.length === 0) return true;
    
    return candidateMedia.every(el => {
      if (el.tagName === 'IMG') {
        return el.complete && el.naturalWidth > 0;
      } else if (el.tagName === 'VIDEO') {
        return el.readyState >= 2;
      }
      return true;
    });
  }, { timeout: initialWaitTimeout }).catch(() => {
    if (debugMode) console.log('[Reddit] Initial media wait timed out');
    return false;
  });

  const remaining6 = deadline - Date.now();
  if (remaining6 <= 100 || mediaReady) {
    if (debugMode) {
      if (mediaReady) console.log('[Reddit] Media ready');
      else console.log('[Reddit] Budget exhausted, total:', Date.now() - redditSettleStart, 'ms');
    }
    const finalRemaining = deadline - Date.now();
    if (finalRemaining > 0) {
      await page.waitForTimeout(Math.min(200, finalRemaining));
    }
    const redditSettleMs = Date.now() - redditSettleStart;
    if (debugMode) console.log('[Reddit] Total settle time:', redditSettleMs, 'ms');
    return;
  }

  if (debugMode) console.log('[Reddit] Collecting media diagnostics');

  const diagnostics = await page.evaluate(() => {
    const postEl = document.querySelector('shreddit-post, [data-testid="post-container"]');
    if (!postEl) return { candidateCount: 0, ignoredCount: 0, unresolvedCount: 0, unresolved: [] };

    const imgs = Array.from(postEl.querySelectorAll('img'));
    const videos = Array.from(postEl.querySelectorAll('video'));
    const sources = Array.from(postEl.querySelectorAll('source'));
    
    let ignoredCount = 0;
    let candidateCount = 0;
    let unresolvedCount = 0;
    const unresolved = [];

    const allMedia = [...imgs, ...videos];

    const candidateMedia = allMedia.filter(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 50 || rect.height < 50) {
        ignoredCount++;
        return false;
      }
      if (rect.width === 0 || rect.height === 0) {
        ignoredCount++;
        return false;
      }
      
      if (el.tagName === 'IMG') {
        const s = (el.currentSrc || el.src || '').toLowerCase();
        const isCandidate = s.includes('redd.it') || s.includes('preview') || s.includes('external-preview');
        if (!isCandidate) ignoredCount++;
        return isCandidate;
      }
      
      if (el.tagName === 'VIDEO') {
        return true;
      }
      
      return false;
    });

    candidateCount = candidateMedia.length;

    candidateMedia.forEach(el => {
      let isResolved = false;
      
      if (el.tagName === 'IMG') {
        isResolved = el.complete && el.naturalWidth > 0;
      } else if (el.tagName === 'VIDEO') {
        isResolved = el.readyState >= 2;
      }

      if (!isResolved) {
        unresolvedCount++;
        
        const rect = el.getBoundingClientRect();
        const computedStyle = window.getComputedStyle(el);
        const parent = el.parentElement;
        const parentStyle = parent ? window.getComputedStyle(parent) : null;
        
        const hasBackgroundImage = parentStyle && parentStyle.backgroundImage !== 'none';
        const hasPlaceholderAncestor = el.closest('[class*="placeholder"], [class*="skeleton"], [class*="loading"]') !== null;
        const hasMediaWrapper = el.closest('[class*="media"], [class*="video"], [class*="player"]') !== null;

        unresolved.push({
          tagName: el.tagName,
          src: el.src || '',
          currentSrc: el.currentSrc || '',
          poster: el.poster || '',
          complete: el.complete || false,
          naturalWidth: el.naturalWidth || 0,
          naturalHeight: el.naturalHeight || 0,
          readyState: el.readyState || 0,
          renderedWidth: Math.round(rect.width),
          renderedHeight: Math.round(rect.height),
          visible: rect.width > 0 && rect.height > 0,
          parentHasBackgroundImage: hasBackgroundImage,
          hasPlaceholderAncestor,
          hasMediaWrapper
        });
      }
    });

    return { candidateCount, ignoredCount, unresolvedCount, unresolved };
  }).catch(() => ({ candidateCount: 0, ignoredCount: 0, unresolvedCount: 0, unresolved: [] }));

  if (debugMode) {
    console.log('[Reddit] Candidate media:', diagnostics.candidateCount);
    console.log('[Reddit] Ignored (tiny/decorative):', diagnostics.ignoredCount);
    console.log('[Reddit] Unresolved media:', diagnostics.unresolvedCount);
    
    if (diagnostics.unresolved.length > 0) {
      console.log('[Reddit] Unresolved media details:');
      diagnostics.unresolved.forEach((item, idx) => {
        console.log(`  [${idx}] ${item.tagName}:`, {
          src: item.src.substring(0, 80),
          currentSrc: item.currentSrc.substring(0, 80),
          complete: item.complete,
          naturalWidth: item.naturalWidth,
          readyState: item.readyState,
          rendered: `${item.renderedWidth}x${item.renderedHeight}`,
          visible: item.visible,
          parentBg: item.parentHasBackgroundImage,
          placeholder: item.hasPlaceholderAncestor,
          mediaWrapper: item.hasMediaWrapper
        });
      });
    }
  }

  if (diagnostics.unresolvedCount === 1) {
    if (debugMode) console.log('[Reddit] Only 1 unresolved media, proceeding with screenshot');
    const finalRemaining = deadline - Date.now();
    if (finalRemaining > 0) {
      await page.waitForTimeout(Math.min(200, finalRemaining));
    }
    const redditSettleMs = Date.now() - redditSettleStart;
    if (debugMode) console.log('[Reddit] Total settle time:', redditSettleMs, 'ms');
    return;
  }

  const finalRemaining = deadline - Date.now();
  if (finalRemaining > 0) {
    await page.waitForTimeout(Math.min(200, finalRemaining));
  }

  const redditSettleMs = Date.now() - redditSettleStart;
  if (debugMode) console.log('[Reddit] Total settle time:', redditSettleMs, 'ms');
}

async function checkRedditMediaComplete(page) {
  return page.evaluate(() => {
    const postEl = document.querySelector('shreddit-post, [data-testid="post-container"]');
    if (!postEl) return true;

    const imgs = Array.from(postEl.querySelectorAll('img'));
    const videos = Array.from(postEl.querySelectorAll('video'));
    const allMedia = [...imgs, ...videos];
    
    const candidateMedia = allMedia.filter(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 50 || rect.height < 50) return false;
      if (rect.width === 0 || rect.height === 0) return false;
      
      if (el.tagName === 'IMG') {
        const s = (el.currentSrc || el.src || '').toLowerCase();
        return s.includes('redd.it') || s.includes('preview') || s.includes('external-preview');
      }
      
      if (el.tagName === 'VIDEO') {
        return true;
      }
      
      return false;
    });

    if (candidateMedia.length === 0) return true;

    const loadedCount = candidateMedia.filter(el => {
      if (el.tagName === 'IMG') {
        return el.complete && el.naturalWidth > 0;
      } else if (el.tagName === 'VIDEO') {
        return el.readyState >= 2;
      }
      return true;
    }).length;
    
    return loadedCount === candidateMedia.length;
  });
}

async function handleInstagramPage(page, debugMode = false) {
  if (debugMode) console.log('[Instagram] Starting page settle');
  
  // Set page timeout to prevent long waits
  page.setDefaultTimeout(10000);
  
  // Initial wait for page structure
  await page.waitForTimeout(3000);
  
  // Multiple scroll passes to trigger lazy-loaded images
  if (debugMode) console.log('[Instagram] First scroll pass');
  await page.evaluate(() => window.scrollTo(0, window.innerHeight * 3));
  await page.waitForTimeout(2500);
  
  if (debugMode) console.log('[Instagram] Second scroll pass');
  await page.evaluate(() => window.scrollTo(0, window.innerHeight * 1.5));
  await page.waitForTimeout(2000);
  
  // Scroll back to top
  if (debugMode) console.log('[Instagram] Scrolling back to top');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(2500);
  
  // Wait for at least some images to load (be lenient since Instagram blocks many resources)
  if (debugMode) console.log('[Instagram] Waiting for images to load');
  try {
    await page.waitForFunction(() => {
      const images = document.querySelectorAll('img');
      let loadedCount = 0;
      images.forEach(img => {
        if (img.complete && img.naturalWidth > 0) {
          loadedCount++;
        }
      });
      // Accept if we have any loaded images, or if there are no images at all
      return images.length === 0 || loadedCount >= 1;
    }, { timeout: 5000 });
    if (debugMode) console.log('[Instagram] Images loaded successfully');
  } catch (e) {
    if (debugMode) console.log('[Instagram] Image wait timed out, proceeding anyway');
  }
  
  // Final wait for any remaining resources
  await page.waitForTimeout(2000);
  
  if (debugMode) console.log('[Instagram] Page settle complete');
}

async function handleTikTokPage(page, debugMode = false, useProxy = null) {
  if (debugMode) console.log('[TikTok] Starting page settle');
  
  // Check if proxy is being used - increases latency
  const { isProxyEnabled } = require('./proxy-config');
  const proxyActive = isProxyEnabled(useProxy);
  
  // Increase timeouts when using proxy due to higher latency
  const timeoutMultiplier = proxyActive ? 2 : 1;
  
  // Set page timeout to prevent long waits
  page.setDefaultTimeout(10000 * timeoutMultiplier);
  
  // Initial wait for page structure
  await page.waitForTimeout(2000 * timeoutMultiplier);
  
  // Scroll down to trigger lazy-loaded images
  if (debugMode) console.log('[TikTok] Scrolling to trigger lazy loading');
  await page.evaluate(() => window.scrollTo(0, window.innerHeight * 2));
  await page.waitForTimeout(1500 * timeoutMultiplier);
  
  // Scroll back up
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1500 * timeoutMultiplier);
  
  // Wait for images to load
  if (debugMode) console.log('[TikTok] Waiting for images to load' + (proxyActive ? ' (proxy mode - extended wait)' : ''));
  try {
    await page.waitForFunction(() => {
      const images = document.querySelectorAll('img');
      let loadedCount = 0;
      images.forEach(img => {
        if (img.complete && img.naturalWidth > 0) {
          loadedCount++;
        }
      });
      return images.length === 0 || loadedCount > 0;
    }, { timeout: 3000 * timeoutMultiplier });
  } catch (e) {
    if (debugMode) console.log('[TikTok] Image wait timed out');
  }
  
  // Final wait
  await page.waitForTimeout(1000 * timeoutMultiplier);
  
  if (debugMode) console.log('[TikTok] Page settle complete');
}

async function handleGenericPage(page) {
  await page.waitForTimeout(1000);
}

async function waitForPageSettle(page, url, debugMode = false, useProxy = null) {
  const isReddit = url.toLowerCase().includes('reddit.com');
  const isInstagram = url.toLowerCase().includes('instagram.com');
  const isTikTok = url.toLowerCase().includes('tiktok.com');
  
  if (isReddit) {
    await handleRedditPage(page, debugMode);
  } else if (isInstagram) {
    await handleInstagramPage(page, debugMode);
  } else if (isTikTok) {
    await handleTikTokPage(page, debugMode, useProxy);
  } else {
    await handleGenericPage(page);
  }
}

async function collectPageSignals(page) {
  const signals = await page.evaluate(() => {
    const anchors = document.querySelectorAll('a');
    const images = document.querySelectorAll('img');
    const videos = document.querySelectorAll('video');
    const audios = document.querySelectorAll('audio');
    
    let loadedImageCount = 0;
    let brokenImageCount = 0;
    
    images.forEach(img => {
      if (img.complete) {
        if (img.naturalWidth > 0) {
          loadedImageCount++;
        } else {
          brokenImageCount++;
        }
      }
    });

    // Extract links with href and title
    const links = Array.from(anchors).map(anchor => {
      const link = {
        href: anchor.href || ''
      };
      if (anchor.title) {
        link.title = anchor.title;
      }
      return link;
    }).filter(link => link.href); // Only include links with href

    // Detect visible overlays/modals
    const overlays = document.querySelectorAll('[role="dialog"], .modal, .overlay, [class*="modal"], [class*="overlay"]');
    const visibleOverlays = Array.from(overlays).filter(el => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    });

    // Detect skeleton/placeholder patterns
    const skeletons = document.querySelectorAll('[class*="skeleton"], [class*="placeholder"], [class*="loading"]');
    const visibleSkeletons = Array.from(skeletons).filter(el => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });

    return {
      anchorCount: anchors.length,
      links,
      imageCount: images.length,
      loadedImageCount,
      brokenImageCount,
      videoCount: videos.length,
      audioCount: audios.length,
      hasVisibleOverlays: visibleOverlays.length > 0,
      visibleOverlayCount: visibleOverlays.length,
      hasSkeletons: visibleSkeletons.length > 0,
      visibleSkeletonCount: visibleSkeletons.length
    };
  });

  return signals;
}

function determineStatus(blocked, pageSignals) {
  if (blocked) {
    return 'blocked';
  }

  const warnings = [];
  
  // Check for partial rendering indicators
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

  // Determine if partial
  const isPartial = warnings.length > 0 || 
                    (pageSignals.imageCount > 5 && pageSignals.loadedImageCount < pageSignals.imageCount * 0.7);

  return isPartial ? 'partial' : 'rendered';
}

async function captureScreenshot(page, options = {}) {
  const {
    format = 'jpeg',
    quality = 65,
    fullPage = false,
    selector = null
  } = options;

  const screenshotOptions = {
    type: format,
    fullPage
  };

  if ((format === 'jpeg' || format === 'webp') && quality) {
    screenshotOptions.quality = Math.min(100, Math.max(0, quality));
  }

  let screenshotBuffer;
  let captureWarning = null;

  if (selector) {
    try {
      const element = await page.locator(selector).first();
      const count = await element.count();
      
      if (count > 0) {
        await element.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
        screenshotBuffer = await element.screenshot(screenshotOptions);
      } else {
        captureWarning = `Selector "${selector}" not found, falling back to page screenshot`;
        screenshotBuffer = await page.screenshot(screenshotOptions);
      }
    } catch (error) {
      captureWarning = `Failed to capture selector "${selector}": ${error.message}, falling back to page screenshot`;
      screenshotBuffer = await page.screenshot(screenshotOptions);
    }
  } else {
    screenshotBuffer = await page.screenshot(screenshotOptions);
  }

  return { screenshotBuffer, captureWarning };
}

module.exports = {
  createBrowserOrContext,
  applyAntiDetection,
  detectBlockPage,
  waitForPageSettle,
  collectPageSignals,
  determineStatus,
  captureScreenshot,
  checkRedditMediaComplete
};
