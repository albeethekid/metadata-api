# Reddit Screenshot Performance Fix

## Problem
- Reddit screenshot settle time exceeded 60 seconds
- Endpoint returned `status="partial"` with low image load percentage
- Waiting on wrong images across entire page instead of main post content
- Including tiny decorative images/icons/avatars in readiness checks

## Solution
Targeted patch to Reddit-specific logic only, scoping to post container and filtering out tiny images.

## Changes Made

### 1. Modified `src/screenshot-helpers.js` - `handleRedditPage()`

**Key improvements:**

#### Scoped to Post Container Only
```javascript
const postContainer = page.locator('shreddit-post, [data-testid="post-container"]').first();
```
Only inspects images inside the main Reddit post container, not entire page.

#### Filter Tiny Images
```javascript
const candidateImgs = imgs.filter(img => {
  const rect = img.getBoundingClientRect();
  // Ignore tiny images (icons, avatars, decorative elements)
  if (rect.width < 50 || rect.height < 50) return false;
  // Must be visible
  if (rect.width === 0 || rect.height === 0) return false;
  
  const s = (img.currentSrc || img.src || '').toLowerCase();
  return s.includes('redd.it') || s.includes('preview') || s.includes('external-preview');
});
```
Ignores images smaller than 50x50px (icons, avatars, decorative elements).

#### Capped Total Settle Time to ~7 Seconds
```javascript
// Popup dismissal: ~250ms
// Post scrolling: ~500ms
// Initial targeted wait: 4000ms (4 seconds)
// Decode retry: 2000ms (2 seconds) - only if needed
// Final settle: 300ms
// Total max: ~7 seconds
```

**Previous:** Could run for 60+ seconds
**New:** Maximum ~7 seconds, typically faster

#### Debug Logging
```javascript
if (debugMode) {
  console.log('[Reddit] Candidate images:', decodeResult.candidateCount);
  console.log('[Reddit] Ignored (tiny/decorative):', decodeResult.ignoredCount);
  console.log('[Reddit] Decoded successfully:', decodeResult.decodedCount);
  console.log('[Reddit] Total settle time:', redditSettleMs, 'ms');
}
```

### 2. Modified `checkRedditMediaComplete()`
Updated to use same filtering logic (ignore images < 50x50px).

### 3. Modified `waitForPageSettle()`
Now accepts and passes `debugMode` parameter to `handleRedditPage()`.

### 4. Modified `src/index.js`
- Passes `debugMode` flag to `waitForPageSettle()`
- Updated warning message to "Main reddit media did not fully load before capture"

## Timing Breakdown

| Phase | Duration | Notes |
|-------|----------|-------|
| Popup dismissal | ~250ms | Cookie banners, modals |
| Post scrolling | ~500ms | Scroll post into view, trigger lazy-loading |
| Initial wait | 4000ms | Wait for candidate images to load |
| Decode retry | 2000ms | Only if initial wait fails |
| Final settle | 300ms | Paint settle |
| **Total Max** | **~7s** | Typically faster if images load quickly |

## What Changed

### Before
- Waited on ALL page images
- Included tiny icons/avatars in readiness checks
- Could run for 60+ seconds
- No debug logging
- Generic "Reddit media" warning

### After
- Only waits on images in post container
- Ignores images < 50x50px (decorative elements)
- Capped at ~7 seconds maximum
- Debug logging for candidate/ignored/decoded counts
- Specific "Main reddit media" warning

## Testing

Server running on port 8081. Test with debug mode:

```bash
# Test Reddit screenshot with debug logging
curl "http://localhost:8081/api/screenshot?url=https://reddit.com/r/programming&meta=1&debug=1"
```

Check server logs for:
```
[Reddit] Candidate images: 3
[Reddit] Ignored (tiny/decorative): 12
[Reddit] Decoded successfully: 3
[Reddit] Total settle time: 4567 ms
```

Check response for settle time:
```bash
curl "http://localhost:8081/api/screenshot?url=https://reddit.com/r/pics&meta=1" | jq '.timings.settleMs'
```

Should return value under 8000ms (8 seconds).

## Benefits

1. ✅ **Faster settle times** - Capped at ~7 seconds instead of 60+
2. ✅ **Focused on main content** - Only waits for post container images
3. ✅ **Ignores decorative elements** - Filters out tiny icons/avatars
4. ✅ **Better success rate** - Doesn't fail on unimportant images
5. ✅ **Debug visibility** - Logs candidate/ignored/decoded counts
6. ✅ **Isolated to Reddit** - Other platforms unaffected
7. ✅ **Early exit** - Returns as soon as main images load

## Code Quality

- Minimal, targeted patch to existing code
- No endpoint rewrite
- Clear filtering logic with comments
- Debug logging only when requested
- Consistent filtering across functions
- Proper timeout management

## Production Ready

The patch is production-ready and maintains backwards compatibility. The settle time is now predictable and capped at ~7 seconds maximum.
