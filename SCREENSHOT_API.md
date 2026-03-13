# Screenshot API Documentation

## Overview

The `/api/screenshot` endpoint provides structured webpage screenshot capture with comprehensive metadata, page analysis, and flexible rendering options.

## Endpoint

```
GET /api/screenshot
```

## Query Parameters

### Required
- `url` - URL-encoded webpage to screenshot

### Optional - Response Mode
- `meta=1` - Return JSON metadata instead of raw image
- `includeImage=1` - Include base64 image in JSON (only with `meta=1`)
- `download=1` - Force browser download instead of inline display

### Optional - Screenshot Options
- `fullPage=1` - Capture entire scrollable page (default: viewport only)
- `format=jpeg|png|webp` - Image format (default: `jpeg`)
- `quality=<number>` - Quality percentage 0-100 (default: `65`, applies to jpeg/webp only)
- `selector=<css-selector>` - Capture specific element instead of full page
- `capture=page|selector` - Explicit capture mode (auto-detected if selector provided)
- `storage_provider=cloudflare` - Upload screenshot to Cloudflare R2 storage and include `s3_url` in response

### Optional - Browser Options
- `profileMode=persistent` - Use persistent browser profile for hard targets (default: fresh incognito context)
- `timeoutMs=<number>` - Navigation timeout in milliseconds (default: `30000`)

### Optional - Debug
- `debug=1` - Enable debug logging and include extra diagnostic fields in response

## Response Modes

### 1. Default Image Response

Returns raw image bytes with metadata in HTTP headers.

**Example:**
```bash
GET /api/screenshot?url=https://example.com
```

**Response Headers:**
```
Content-Type: image/jpeg
Content-Disposition: inline; filename="screenshot-example.com-1234567890.jpg"
X-Screenshot-Status: rendered
X-Screenshot-Blocked: 0
X-Screenshot-Title: Example%20Domain
X-Screenshot-Final-Url: https://example.com/
```

### 2. Metadata JSON (without image)

Returns structured metadata only, no base64 image.

**Example:**
```bash
GET /api/screenshot?url=https://example.com&meta=1
```

**Response:**
```json
{
  "ok": true,
  "status": "rendered",
  "inputUrl": "https://example.com",
  "finalUrl": "https://example.com/",
  "title": "Example Domain",
  "blocked": false,
  "blockReason": null,
  "warnings": [],
  "renderMode": "playwright",
  "timings": {
    "gotoMs": 542,
    "settleMs": 1002,
    "screenshotMs": 15,
    "totalMs": 1971
  },
  "pageSignals": {
    "anchorCount": 1,
    "imageCount": 0,
    "loadedImageCount": 0,
    "brokenImageCount": 0,
    "videoCount": 0,
    "audioCount": 0
  },
  "screenshot": {
    "format": "jpeg",
    "fullPage": false,
    "width": 1200,
    "height": 800,
    "byteLength": 14652
  }
}
```

### 3. Metadata JSON with Base64 Image

Returns metadata plus base64-encoded image.

**Example:**
```bash
GET /api/screenshot?url=https://example.com&meta=1&includeImage=1&format=png
```

**Response:**
```json
{
  "ok": true,
  "status": "rendered",
  "inputUrl": "https://example.com",
  "finalUrl": "https://example.com/",
  "title": "Example Domain",
  "blocked": false,
  "blockReason": null,
  "warnings": [],
  "renderMode": "playwright",
  "timings": { ... },
  "pageSignals": { ... },
  "screenshot": { ... },
  "imageBase64": "data:image/png;base64,iVBORw0KGgoAAAANS..."
}
```

### 4. Cloudflare R2 Storage Upload

Upload screenshot to Cloudflare R2 object storage and receive S3 URL in response.

**Example:**
```bash
GET /api/screenshot?url=https://example.com&meta=1&storage_provider=cloudflare
```

**Response:**
```json
{
  "ok": true,
  "status": "rendered",
  "inputUrl": "https://example.com",
  "finalUrl": "https://example.com/",
  "title": "Example Domain",
  "blocked": false,
  "blockReason": null,
  "warnings": [],
  "renderMode": "playwright",
  "timings": { ... },
  "pageSignals": { ... },
  "screenshot": { ... },
  "s3_url": "https://pub-ce95034f780d447bb043921b1c273e80.r2.dev/screenshots/1710345678901.jpg"
}
```

**Environment Variables Required:**
- `R2_ACCOUNT_ID` - Cloudflare account ID
- `R2_ACCESS_KEY_ID` - R2 access key ID
- `R2_SECRET_ACCESS_KEY` - R2 secret access key
- `R2_BUCKET` - R2 bucket name
- `R2_PUBLIC_BASE_URL` - Public R2 domain URL (e.g., `https://pub-xxx.r2.dev`)

**Object Key Format:**
```
screenshots/<timestamp>.<extension>
```

**Notes:**
- Works with all image formats (jpeg, png, webp)
- If upload fails, warning is added to response and screenshot still returns
- Can be combined with `includeImage=1` to get both S3 URL and base64 image
- Returns public R2 URL if `R2_PUBLIC_BASE_URL` is configured, otherwise returns internal R2 endpoint URL
- Public URL allows direct browser access without authentication

## Status Values

The `status` field indicates the rendering outcome:

- **`rendered`** - Page rendered normally with no issues detected
- **`partial`** - Page rendered but some content appears incomplete (e.g., many images not loaded, skeletons visible)
- **`blocked`** - Bot challenge, captcha, access denied, or other block page detected
- **`failed`** - Navigation or screenshot capture failed

## Page Signals

The endpoint collects DOM signals to help assess page completeness:

```json
{
  "pageSignals": {
    "anchorCount": 42,
    "links": [
      {
        "href": "https://example.com/page1"
      },
      {
        "href": "https://example.com/page2",
        "title": "Page 2 Title"
      }
    ],
    "imageCount": 15,
    "loadedImageCount": 12,
    "brokenImageCount": 3,
    "videoCount": 1,
    "audioCount": 0
  }
}
```

**Link Objects:**
- `href` - The link URL (always present)
- `title` - The link title attribute (optional, only if present in HTML)

## Warnings

The `warnings` array contains human-readable issues detected:

```json
{
  "warnings": [
    "Only 60% of images loaded",
    "5 broken images detected",
    "2 visible overlay(s) may obstruct content",
    "Selector \"#missing\" not found, falling back to page screenshot"
  ]
}
```

## Timings

Performance breakdown in milliseconds:

```json
{
  "timings": {
    "gotoMs": 542,
    "settleMs": 1002,
    "screenshotMs": 15,
    "totalMs": 1971
  }
}
```

- `gotoMs` - Navigation time
- `settleMs` - Time waiting for page to settle (DOM ready, images loaded, platform-specific handling)
- `screenshotMs` - Screenshot capture time
- `totalMs` - Total request time

## Selector-Based Capture

Capture a specific element instead of the full page:

**Example:**
```bash
GET /api/screenshot?url=https://reddit.com/r/example&selector=shreddit-post
```

If the selector is not found, the endpoint falls back to full page capture and adds a warning.

## Format Support

Three image formats are supported:

- `jpeg` (default) - Good compression, supports quality parameter
- `png` - Lossless, larger file size
- `webp` - Modern format, supports quality parameter

**Example:**
```bash
GET /api/screenshot?url=https://example.com&format=png
GET /api/screenshot?url=https://example.com&format=webp&quality=80
```

## Profile Modes

### Fresh Mode (Default)

Uses a fresh incognito browser context for clean, reproducible results.

**Example:**
```bash
GET /api/screenshot?url=https://example.com
```

### Persistent Mode

Uses a persistent browser profile with cookies and state. Useful for sites with aggressive bot detection.

**Example:**
```bash
GET /api/screenshot?url=https://reddit.com/r/example&profileMode=persistent
```

## Platform-Specific Handling

The endpoint includes optimized handling for specific platforms:

### Reddit
- Auto-dismisses cookie banners and popups
- Scrolls to trigger lazy-loaded images
- Waits for Reddit media to load
- Focuses on post container

### Instagram
- Extended wait times for content loading
- Scroll-based lazy load triggering

### Generic Sites
- Standard DOM content loaded wait
- Brief settle period

## Error Responses

All errors return structured JSON:

```json
{
  "ok": false,
  "error": "NAVIGATION_TIMEOUT",
  "message": "Navigation timeout after 30000ms",
  "inputUrl": "https://example.com"
}
```

### Error Codes

- `MISSING_URL` - No URL parameter provided
- `INVALID_URL` - Malformed URL
- `INVALID_URL_PROTOCOL` - Non-HTTP/HTTPS protocol
- `NAVIGATION_TIMEOUT` - Page navigation timed out
- `NAVIGATION_FAILED` - Navigation error (e.g., DNS failure, connection refused)
- `SCREENSHOT_CAPTURE_FAILED` - Screenshot capture failed
- `INTERNAL_ERROR` - Unexpected server error

## Example Use Cases

### 1. Basic Screenshot
```bash
curl "http://localhost:8081/api/screenshot?url=https://example.com" \
  --output screenshot.jpg
```

### 2. Full Page PNG with Download
```bash
curl "http://localhost:8081/api/screenshot?url=https://example.com&fullPage=1&format=png&download=1" \
  --output fullpage.png
```

### 3. Metadata Analysis
```bash
curl "http://localhost:8081/api/screenshot?url=https://example.com&meta=1" | jq
```

### 4. Reddit Post Capture
```bash
curl "http://localhost:8081/api/screenshot?url=https://reddit.com/r/programming/comments/abc123&selector=shreddit-post&profileMode=persistent&meta=1" | jq
```

### 5. High Quality WebP with Metadata
```bash
curl "http://localhost:8081/api/screenshot?url=https://example.com&format=webp&quality=90&meta=1&includeImage=1" | jq
```

### 6. Debug Mode
```bash
curl "http://localhost:8081/api/screenshot?url=https://example.com&meta=1&debug=1" | jq
```

## Backwards Compatibility

All existing query parameters are preserved:
- `url` - Required URL
- `download=1` - Force download
- `fullPage=1` - Full page capture
- `meta=1` - JSON metadata mode
- `debug=1` - Debug logging

New parameters are additive and optional, ensuring existing integrations continue to work.

## Best Practices

1. **Use fresh mode by default** for reproducible results
2. **Use persistent mode** only for sites with aggressive bot detection
3. **Request metadata without image** (`meta=1` without `includeImage=1`) to reduce bandwidth
4. **Use selector capture** for specific elements to reduce screenshot size
5. **Check status and warnings** to detect partial renders or blocks
6. **Monitor timings** to identify slow pages
7. **Use appropriate format**: JPEG for photos, PNG for UI/text, WebP for balance

## Performance Considerations

- Fresh mode is faster (no profile loading)
- Selector capture is faster than full page
- JPEG is smaller than PNG
- Lower quality reduces file size
- Shorter timeouts fail faster
- Metadata-only responses are lightweight

## Resource Cleanup

The endpoint ensures proper cleanup of browser resources:
- Page closed after screenshot
- Context closed after request
- Browser closed (fresh mode only)

All cleanup happens in the `finally` block to prevent resource leaks.
