# New TikTok yt-dlp Endpoint - Summary

## What Was Created

A new API endpoint `/api/tiktok/ytdlp` that uses the yt-dlp library to fetch TikTok video metadata as an alternative to the existing HTTP scraping approach.

## Files Created/Modified

### New Files
1. **`src/tiktokYtdlp.js`** - TikTok scraper module using yt-dlp
   - Automatically downloads yt-dlp binary on first use
   - Handles URL validation and normalization
   - Formats response to match existing TikTok endpoint structure
   - Custom error handling with `TikTokYtdlpError` class

2. **`test-tiktok-ytdlp.js`** - Test script for the new endpoint
   - Standalone test without requiring YouTube API key
   - Tests with sample TikTok URL

3. **`YTDLP_SETUP.md`** - Comprehensive setup documentation
   - Python version requirements
   - Installation instructions for different platforms
   - API endpoint documentation
   - Comparison between yt-dlp and HTTP scraping approaches

4. **`NEW_TIKTOK_ENDPOINT.md`** - This summary document

### Modified Files
1. **`src/index.js`**
   - Added import for `tiktokYtdlp` module
   - Added new `/api/tiktok/ytdlp` endpoint
   - Updated root endpoint documentation to include new endpoint

2. **`.gitignore`**
   - Added `bin/` directory to ignore yt-dlp binary

3. **`package.json`** (via npm install)
   - Added `yt-dlp-wrap` dependency

## Dependencies Added

```json
{
  "yt-dlp-wrap": "^latest"
}
```

## API Endpoint Details

### Endpoint
```
GET /api/tiktok/ytdlp
```

### Query Parameters
- `url` (required): URL-encoded TikTok video URL
- `verbose` (optional): Set to `1` to include raw yt-dlp metadata

### Example Usage
```bash
# Basic request
curl "http://localhost:8080/api/tiktok/ytdlp?url=https%3A%2F%2Fwww.tiktok.com%2F%40username%2Fvideo%2F1234567890"

# Verbose request
curl "http://localhost:8080/api/tiktok/ytdlp?url=https%3A%2F%2Fwww.tiktok.com%2F%40username%2Fvideo%2F1234567890&verbose=1"
```

### Response Format
```json
{
  "platform": "tiktok",
  "inputUrl": "https://www.tiktok.com/@username/video/1234567890",
  "videoId": "1234567890",
  "publishedAt": "2024-01-15T12:00:00.000Z",
  "description": "Video caption/description",
  "heroImageUrl": "https://...",
  "metrics": {
    "views": 12345,
    "likes": 678,
    "comments": 90,
    "shares": 12
  }
}
```

### Error Responses
- `400 MISSING_URL` - No URL parameter provided
- `400 INVALID_URL` - Invalid or non-TikTok URL
- `400 CANNOT_EXTRACT_VIDEO_ID` - Could not extract video ID
- `502 YTDLP_FETCH_FAILED` - yt-dlp failed to fetch data
- `503 PYTHON_VERSION_UNSUPPORTED` - Python version < 3.10

## Important Requirements

### Python 3.10+
The yt-dlp library requires Python 3.10 or higher. The current system has Python 3.9.6, which is **not compatible**.

To use this endpoint, you need to:
1. Install Python 3.10 or higher
2. The yt-dlp binary will auto-download to `bin/yt-dlp` on first use

### Installation Options

**macOS:**
```bash
brew install python@3.11
```

**Ubuntu/Debian:**
```bash
sudo apt install python3.11
```

## Testing

Once Python 3.10+ is installed, test with:
```bash
node test-tiktok-ytdlp.js
```

## Advantages Over HTTP Scraping

1. **More Reliable** - Uses TikTok's internal APIs via yt-dlp
2. **Better Metadata** - Access to more complete video information
3. **Active Maintenance** - yt-dlp is actively maintained by a large community
4. **Handles Edge Cases** - Better support for various TikTok URL formats

## Trade-offs

1. **Python Dependency** - Requires Python 3.10+
2. **Performance** - Slightly slower due to spawning Python process
3. **Binary Size** - yt-dlp binary is ~10MB

## Next Steps

1. **Install Python 3.10+** on the deployment environment
2. **Test the endpoint** with real TikTok URLs
3. **Update main README.md** to document this new endpoint
4. **Consider making this the default** TikTok endpoint if it proves more reliable
5. **Update the CSV tool UI** to use this endpoint (optional)

## Files Structure
```
youtube-api-project/
├── src/
│   ├── tiktokYtdlp.js          # New yt-dlp scraper
│   ├── tiktokMetrics.js        # Existing HTTP scraper
│   └── index.js                # Updated with new endpoint
├── bin/                        # Auto-created, gitignored
│   └── yt-dlp                  # Auto-downloaded binary
├── test-tiktok-ytdlp.js        # Test script
├── YTDLP_SETUP.md              # Setup documentation
└── NEW_TIKTOK_ENDPOINT.md      # This file
```
