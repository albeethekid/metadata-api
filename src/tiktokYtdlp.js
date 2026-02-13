const YTDlpWrap = require('yt-dlp-wrap').default;
const path = require('path');
const fs = require('fs');

class TikTokYtdlpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

let ytDlpInstance = null;
let isDownloading = false;

function fixYtdlpShebang(binaryPath, pythonPath) {
  try {
    const content = fs.readFileSync(binaryPath, 'utf8');
    const lines = content.split('\n');
    
    if (lines[0].startsWith('#!')) {
      lines[0] = `#!${pythonPath}`;
      fs.writeFileSync(binaryPath, lines.join('\n'), 'utf8');
      console.log('Fixed yt-dlp shebang to use Python 3.11');
    }
  } catch (error) {
    console.warn('Could not fix yt-dlp shebang:', error.message);
  }
}

async function getYtDlpInstance() {
  if (ytDlpInstance) {
    return ytDlpInstance;
  }

  const binaryPath = path.join(__dirname, '..', 'bin', 'yt-dlp');
  const pythonPath = '/opt/homebrew/bin/python3.11';
  
  try {
    ytDlpInstance = new YTDlpWrap(binaryPath, pythonPath);
    await ytDlpInstance.getVersion();
    return ytDlpInstance;
  } catch (error) {
    if (!isDownloading) {
      isDownloading = true;
      console.log('yt-dlp binary not found, downloading...');
      try {
        await YTDlpWrap.downloadFromGithub(binaryPath);
        console.log('yt-dlp binary downloaded successfully');
        
        fixYtdlpShebang(binaryPath, pythonPath);
        
        ytDlpInstance = new YTDlpWrap(binaryPath, pythonPath);
        isDownloading = false;
        return ytDlpInstance;
      } catch (downloadError) {
        isDownloading = false;
        console.error('Failed to download yt-dlp:', downloadError.message);
        throw downloadError;
      }
    } else {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return getYtDlpInstance();
    }
  }
}

async function getTikTokVideoMetricsYtdlp(encodedUrl, verbose = false) {
  const { decodedUrl, videoId } = normalizeUrl(encodedUrl);
  
  try {
    const ytDlpWrap = await getYtDlpInstance();
    
    const metadata = await ytDlpWrap.getVideoInfo(decodedUrl);
    
    return formatResponse(decodedUrl, videoId, metadata, verbose);
  } catch (error) {
    console.error('yt-dlp error:', error.message);
    
    if (error.message && error.message.includes('unsupported version of Python')) {
      throw new TikTokYtdlpError(503, 'PYTHON_VERSION_UNSUPPORTED');
    }
    
    throw new TikTokYtdlpError(502, 'YTDLP_FETCH_FAILED');
  }
}

function normalizeUrl(encodedUrl) {
  let decodedUrl;
  try {
    decodedUrl = decodeURIComponent(encodedUrl);
  } catch (error) {
    throw new TikTokYtdlpError(400, 'INVALID_URL');
  }

  let parsed;
  try {
    parsed = new URL(decodedUrl);
  } catch (error) {
    throw new TikTokYtdlpError(400, 'INVALID_URL');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname.endsWith('tiktok.com')) {
    throw new TikTokYtdlpError(400, 'INVALID_URL');
  }

  if (!/\/video\//.test(parsed.pathname)) {
    throw new TikTokYtdlpError(400, 'INVALID_URL');
  }

  const videoId = extractVideoId(parsed.pathname);

  return { decodedUrl: parsed.toString(), videoId };
}

function extractVideoId(urlString) {
  const match = /\/video\/(\d+)/.exec(urlString);
  if (!match) {
    throw new TikTokYtdlpError(400, 'CANNOT_EXTRACT_VIDEO_ID');
  }
  return match[1];
}

function formatResponse(inputUrl, videoId, metadata, verbose = false) {
  const publishedAt = metadata.timestamp 
    ? new Date(metadata.timestamp * 1000).toISOString() 
    : (metadata.upload_date ? parseUploadDate(metadata.upload_date) : null);

  const description = metadata.description || metadata.title || null;
  
  const heroImageUrl = metadata.thumbnail || null;

  const base = {
    platform: 'tiktok',
    inputUrl: inputUrl,
    videoId: videoId,
    publishedAt: publishedAt,
    description: description,
    heroImageUrl: heroImageUrl,
    metrics: {
      views: toNumber(metadata.view_count),
      likes: toNumber(metadata.like_count),
      comments: toNumber(metadata.comment_count),
      shares: toNumber(metadata.repost_count)
    }
  };

  if (verbose) {
    base.raw = metadata;
  }

  return base;
}

function parseUploadDate(uploadDate) {
  if (!uploadDate || typeof uploadDate !== 'string') return null;
  
  const match = uploadDate.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return null;
  
  try {
    const date = new Date(`${match[1]}-${match[2]}-${match[3]}`);
    return date.toISOString();
  } catch (error) {
    return null;
  }
}

function toNumber(value) {
  if (value === undefined || value === null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

module.exports = {
  getTikTokVideoMetricsYtdlp,
  TikTokYtdlpError
};
