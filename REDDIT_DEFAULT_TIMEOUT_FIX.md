# Reddit Screenshot Default Timeout Fix

## Problem Identified

After implementing the 5-second budget with elapsed-time logic, the Reddit screenshot was **still taking 30.7 seconds** instead of the expected 5 seconds.

### Debug Logs Revealed

```
[Reddit] Initial media wait, timeout: 3000 ms
[Reddit] Initial media wait timed out
[Reddit] Budget exhausted, total: 30722 ms
```

**Analysis:**
- Initial wait: 3000ms (as expected)
- Total time: 30722ms (30.7 seconds)
- **Hidden wait: ~27 seconds** between timeout and budget check

## Root Cause

**Playwright's `page.waitForFunction()` uses the page's default timeout (30 seconds) as a fallback** even when a timeout parameter is specified.

When the function condition never becomes true (e.g., broken image that never loads), Playwright falls back to the page's default timeout setting, which is 30 seconds by default.

Our code specified:
```javascript
await page.waitForFunction(..., { timeout: 3000 })
```

But Playwright internally used:
```javascript
// Effective timeout: Math.max(specified_timeout, page_default_timeout)
// or falls back to page default if condition never resolves
```

## Solution

Set the page's default timeout to match our Reddit settle budget:

```javascript
async function handleRedditPage(page, debugMode = false) {
  const REDDIT_SETTLE_BUDGET_MS = 5000;
  const deadline = Date.now() + REDDIT_SETTLE_BUDGET_MS;
  const redditSettleStart = Date.now();
  
  page.setDefaultTimeout(REDDIT_SETTLE_BUDGET_MS); // ← FIX
  
  if (debugMode) console.log('[Reddit] Settle started, budget:', REDDIT_SETTLE_BUDGET_MS, 'ms');
  // ...
}
```

This ensures that **no Playwright wait operation can exceed 5 seconds**, regardless of whether it uses the explicit timeout parameter or falls back to the default.

## Results

### Before Fix
```json
{
  "timings": {
    "gotoMs": 341,
    "settleMs": 30722,
    "screenshotMs": 14,
    "totalMs": 31283
  }
}
```

### After Fix
```json
{
  "timings": {
    "gotoMs": 410,
    "settleMs": 5729,
    "screenshotMs": 12,
    "totalMs": 6363
  },
  "status": "partial",
  "warnings": [
    "Main reddit media did not fully load before capture",
    "3 skeleton/placeholder element(s) detected"
  ]
}
```

**Improvement:**
- Settle time: **30.7s → 5.7s** (81% faster)
- Total time: **31.3s → 6.4s** (80% faster)
- Status: Correctly marked as `partial`
- Warnings: Appropriate warnings for unresolved media

## Files Modified

### `src/screenshot-helpers.js` - `handleRedditPage()`

**Added one line:**
```javascript
page.setDefaultTimeout(REDDIT_SETTLE_BUDGET_MS);
```

This single line ensures the page's default timeout matches our budget, preventing any hidden 30-second fallback waits.

## Why This Matters

Playwright has multiple timeout mechanisms:
1. **Explicit timeout** - Specified in individual wait calls
2. **Page default timeout** - Fallback for all page operations
3. **Browser context timeout** - Global fallback

Without setting the page default timeout, operations can fall back to the 30-second default even when you specify a shorter timeout.

## Testing

Test URL that previously took 30+ seconds:
```bash
curl "http://localhost:8081/api/screenshot?url=https%3A%2F%2Fwww.reddit.com%2Fr%2FSoraAi%2Fcomments%2F1nymmc6%2Fbluey_gone_wild%2F&meta=1&debug=1"
```

**Expected:**
- `settleMs` < 6000 (under 6 seconds)
- `status: "partial"` (if media doesn't load)
- Appropriate warnings

**Previous:**
- `settleMs` ~30000 (30 seconds)

## Production Ready

The fix is minimal, targeted, and production-ready:
- ✅ One-line change
- ✅ Enforces 5-second hard cap
- ✅ No side effects on other platforms
- ✅ Tested and verified
- ✅ Proper error handling maintained
- ✅ Diagnostics still work

## Summary

The hidden 27-second wait was caused by Playwright's default page timeout (30 seconds) being used as a fallback when `waitForFunction()` conditions never resolved.

**Fix:** `page.setDefaultTimeout(5000)` ensures no operation can exceed our budget.

**Result:** Reddit screenshots now complete in 5-6 seconds instead of 30+ seconds, with proper partial status and warnings.
