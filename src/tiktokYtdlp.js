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

function isServerlessEnvironment() {
  // Detect Vercel, AWS Lambda, or other serverless environments
  return process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT;
}

function getBinaryPath() {
  // Use /tmp for serverless (writable), otherwise use project bin/ directory
  if (isServerlessEnvironment()) {
    return path.join('/tmp', 'yt-dlp');
  }
  return path.join(__dirname, '..', 'bin', 'yt-dlp');
}

function fixYtdlpShebang(binaryPath, pythonPath) {
  try {
    // Read as binary to preserve zipapp structure
    const content = fs.readFileSync(binaryPath);
    
    // Find the first newline (end of shebang line)
    let newlineIndex = -1;
    for (let i = 0; i < content.length; i++) {
      if (content[i] === 0x0a) { // \n
        newlineIndex = i;
        break;
      }
    }
    
    if (newlineIndex === -1 || content[0] !== 0x23 || content[1] !== 0x21) { // #!
      console.warn('No valid shebang found in yt-dlp binary');
      return;
    }
    
    // Create new shebang
    const newShebang = Buffer.from(`#!${pythonPath}\n`);
    
    // Combine new shebang with rest of binary (after original newline)
    const restOfFile = content.slice(newlineIndex + 1);
    const newContent = Buffer.concat([newShebang, restOfFile]);
    
    // Write back as binary
    fs.writeFileSync(binaryPath, newContent);
    console.log(`Fixed yt-dlp shebang to use ${pythonPath}`);
  } catch (error) {
    console.warn('Could not fix yt-dlp shebang:', error.message);
  }
}

function getPythonPath() {
  // Check for Homebrew Python 3.11 (macOS)
  if (fs.existsSync('/opt/homebrew/bin/python3.11')) {
    return '/opt/homebrew/bin/python3.11';
  }
  
  // Check for system Python 3.11 (Docker/Linux)
  if (fs.existsSync('/usr/bin/python3.11')) {
    return '/usr/bin/python3.11';
  }
  
  // Check for system Python 3.10 (Ubuntu Jammy default)
  if (fs.existsSync('/usr/bin/python3.10')) {
    return '/usr/bin/python3.10';
  }
  
  // Fallback to python3 in PATH (should be 3.10+ on modern systems)
  return 'python3';
}

async function getYtDlpInstance() {
  if (ytDlpInstance) {
    return ytDlpInstance;
  }

  const binaryPath = getBinaryPath();
  const pythonPath = getPythonPath();
  
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

async function getTikTokVideoMetricsYtdlp(encodedUrl, verbose = false, useProxy = null) {
  const { decodedUrl, videoId } = normalizeUrl(encodedUrl);
  
  try {
    const ytDlpWrap = await getYtDlpInstance();
    
    // Build yt-dlp options with proxy if enabled
    const options = [];
    
    // Add proxy configuration if available
    if (useProxy !== false) {
      const { getAxiosProxyConfig, isProxyEnabled } = require('./proxy-config');
      const proxyConfig = getAxiosProxyConfig('oxylabs', useProxy);
      
      if (proxyConfig && isProxyEnabled(useProxy)) {
        const proxyUrl = `${proxyConfig.protocol}://${proxyConfig.auth.username}:${proxyConfig.auth.password}@${proxyConfig.host}:${proxyConfig.port}`;
        options.push('--proxy', proxyUrl);
        console.log('[TikTok yt-dlp] Using proxy:', `${proxyConfig.protocol}://${proxyConfig.host}:${proxyConfig.port}`);
      }
    }
    
    const metadata = await ytDlpWrap.getVideoInfo(decodedUrl, options);
    
    return formatResponse(decodedUrl, videoId, metadata, verbose);
  } catch (error) {
    console.error('yt-dlp error:', error.message);
    
    // Check for Python version issues
    if (error.message && error.message.includes('unsupported version of Python')) {
      throw new TikTokYtdlpError(503, 'PYTHON_VERSION_UNSUPPORTED');
    }
    
    // Check for Python not found (common in serverless)
    if (error.message && (error.message.includes('python3.11') || error.message.includes('ENOENT'))) {
      if (isServerlessEnvironment()) {
        throw new TikTokYtdlpError(503, 'SERVERLESS_UNSUPPORTED');
      }
      throw new TikTokYtdlpError(503, 'PYTHON_NOT_FOUND');
    }
    
    // Check for filesystem write errors (serverless read-only filesystem)
    if (error.message && (error.message.includes('EROFS') || error.message.includes('read-only'))) {
      throw new TikTokYtdlpError(503, 'SERVERLESS_UNSUPPORTED');
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
