// YouTube transcript fetcher backed by yt-dlp.
//
// We avoid scraping the watch page ourselves: yt-dlp handles YouTube's
// signature/PO-token mechanics internally. Flow:
//   1. yt-dlp -J --skip-download URL  →  metadata listing `subtitles` (manual)
//      and `automatic_captions` (auto) per language.
//   2. Pick best track: preferred-lang manual > preferred-lang auto > any manual.
//   3. yt-dlp --skip-download --write-subs/--write-auto-subs --sub-langs LANG
//      --sub-format json3 -o TEMP  →  writes the json3 file to disk.
//   4. Read + parse + clean up the file.
//
// Reuses the same yt-dlp binary management as ./tiktokYtdlp.js
// (binary path, Python detection, auto-download from GitHub).

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const crypto = require('crypto');
const YTDlpWrap = require('yt-dlp-wrap').default;

class TranscriptError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ── yt-dlp binary bootstrap (mirrors tiktokYtdlp.js) ─────────────────────────

let ytDlpInstance = null;
let isDownloading = false;

function isServerlessEnvironment() {
  return process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT;
}

function getBinaryPath() {
  if (isServerlessEnvironment()) return path.join('/tmp', 'yt-dlp');
  return path.join(__dirname, '..', 'bin', 'yt-dlp');
}

function getPythonPath() {
  if (fs.existsSync('/opt/homebrew/bin/python3.11')) return '/opt/homebrew/bin/python3.11';
  if (fs.existsSync('/usr/bin/python3.11'))          return '/usr/bin/python3.11';
  if (fs.existsSync('/usr/bin/python3.10'))          return '/usr/bin/python3.10';
  return 'python3';
}

// Linux kernels require an absolute path in `#!`. If pythonPath is bare
// (e.g. just "python3" because we couldn't detect an absolute Python on this
// host — happens on Railway/Linux containers), wrap with `/usr/bin/env` so
// the kernel can exec the shebang and `env` does PATH resolution.
function shebangInterpreter(pythonPath) {
  return pythonPath.startsWith('/') ? pythonPath : `/usr/bin/env ${pythonPath}`;
}

function fixYtdlpShebang(binaryPath, pythonPath) {
  try {
    const content = fs.readFileSync(binaryPath);
    let newlineIndex = -1;
    for (let i = 0; i < content.length; i++) {
      if (content[i] === 0x0a) { newlineIndex = i; break; }
    }
    if (newlineIndex === -1 || content[0] !== 0x23 || content[1] !== 0x21) return;
    const newShebang = Buffer.from(`#!${shebangInterpreter(pythonPath)}\n`);
    fs.writeFileSync(binaryPath, Buffer.concat([newShebang, content.slice(newlineIndex + 1)]));
    try { fs.chmodSync(binaryPath, 0o755); } catch (_) {}
  } catch (e) {
    console.warn('Could not fix yt-dlp shebang:', e.message);
  }
}

async function getYtDlpInstance() {
  if (ytDlpInstance) return ytDlpInstance;
  const binaryPath = getBinaryPath();
  const pythonPath = getPythonPath();
  try {
    ytDlpInstance = new YTDlpWrap(binaryPath, pythonPath);
    await ytDlpInstance.getVersion();
    return ytDlpInstance;
  } catch (_) {
    if (!isDownloading) {
      isDownloading = true;
      try {
        await YTDlpWrap.downloadFromGithub(binaryPath);
        fixYtdlpShebang(binaryPath, pythonPath);
        ytDlpInstance = new YTDlpWrap(binaryPath, pythonPath);
        isDownloading = false;
        return ytDlpInstance;
      } catch (downloadError) {
        isDownloading = false;
        throw downloadError;
      }
    } else {
      await new Promise(r => setTimeout(r, 1000));
      return getYtDlpInstance();
    }
  }
}

// ── Language matching ────────────────────────────────────────────────────────

// Match `en` against tracks like `en`, `en-US`, `en-GB`, etc.
function findLangKey(subsDict, lang) {
  if (!subsDict || typeof subsDict !== 'object') return null;
  if (subsDict[lang]) return lang;
  const lower = lang.toLowerCase();
  for (const k of Object.keys(subsDict)) {
    const kLower = k.toLowerCase();
    if (kLower === lower || kLower.startsWith(lower + '-')) return k;
  }
  return null;
}

// ── json3 parsing ────────────────────────────────────────────────────────────

function parseJson3Events(json3) {
  const events = json3 && Array.isArray(json3.events) ? json3.events : [];
  const segments = [];
  for (const ev of events) {
    if (!ev || !Array.isArray(ev.segs)) continue;
    const text = ev.segs
      .map(s => (s && typeof s.utf8 === 'string') ? s.utf8 : '')
      .join('')
      .replace(/\s*\n\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    segments.push({
      start:    Number(((ev.tStartMs || 0)    / 1000).toFixed(3)),
      duration: Number(((ev.dDurationMs || 0) / 1000).toFixed(3)),
      text
    });
  }
  return segments;
}

// ── Main entry point ─────────────────────────────────────────────────────────

// Build the `--proxy <url>` flag pair from project's Oxylabs config.
//
// We append `-cc-us-sessid-<rand>` to the username to (a) force a US-pool
// residential IP and (b) get a fresh rotating session per request. Plain
// `user-USERNAME` auth gives unpredictable IP geo and may reuse "warm" IPs
// that YouTube has already soft-flagged.
//
// Returns { flags, info } so callers can surface whether the proxy was applied.
function buildProxyFlags(useProxy) {
  if (useProxy === false) {
    return { flags: [], info: { applied: false, reason: 'disabled by request (proxy=false)' } };
  }
  try {
    const { getAxiosProxyConfig, isProxyEnabled } = require('./proxy-config');
    const cfg = getAxiosProxyConfig('oxylabs', useProxy);
    if (!cfg || !isProxyEnabled(useProxy)) {
      return { flags: [], info: { applied: false, reason: 'no credentials / proxy disabled in config' } };
    }
    const sessid       = crypto.randomBytes(6).toString('hex');
    const enhancedUser = `${cfg.auth.username}-cc-us-sessid-${sessid}`;
    const proxyUrl     = `${cfg.protocol}://${enhancedUser}:${cfg.auth.password}@${cfg.host}:${cfg.port}`;
    const display      = `${cfg.protocol}://${cfg.host}:${cfg.port}`;
    console.log('[YouTube transcript] Using proxy:', display, 'user:', enhancedUser);
    return {
      flags: ['--proxy', proxyUrl],
      info:  { applied: true, server: display, user: enhancedUser, sessid }
    };
  } catch (e) {
    console.warn('[YouTube transcript] Proxy config error, continuing without proxy:', e.message);
    return { flags: [], info: { applied: false, reason: `error: ${e.message}` } };
  }
}

// Player clients that bypass the "Sign in to confirm you're not a bot" wall
// without requiring PO tokens. We deliberately exclude `default` (which puts
// the heavily-fingerprinted `web` client first) and focus on the TV/mobile
// clients that are softer-checked in 2025.
const YOUTUBE_EXTRACTOR_ARGS = 'youtube:player_client=tv_simply,mweb,web_safari,android_vr';

// When `YT_DLP_IMPERSONATE` is set (e.g. on Railway, where curl_cffi is
// installed via Dockerfile), tell yt-dlp to use a real browser TLS/HTTP
// fingerprint. Without this, YouTube fingerprints yt-dlp's Python urllib
// signature and bot-walls our requests even through residential proxies.
function impersonateFlags() {
  const target = (process.env.YT_DLP_IMPERSONATE || '').trim();
  if (!target) return { flags: [], target: null };
  return { flags: ['--impersonate', target], target };
}

/**
 * @param {string} videoId
 * @param {string} [preferredLang='en']
 * @param {boolean|null} [useProxy=null]  null = use default (proxy on if credentials exist), false = force off
 * @returns {Promise<{language:string,isGenerated:boolean,segments:Array}>}
 */
async function getTranscript(videoId, preferredLang = 'en', useProxy = null) {
  if (!videoId || typeof videoId !== 'string') {
    throw new TranscriptError('INVALID_VIDEO_ID', 'videoId is required');
  }

  const ytDlp                   = await getYtDlpInstance();
  const videoUrl                = `https://www.youtube.com/watch?v=${videoId}`;
  const { flags: proxyFlags, info: proxyInfo } = buildProxyFlags(useProxy);
  const { flags: impFlags, target: impTarget } = impersonateFlags();
  proxyInfo.impersonate = impTarget;

  // Helper to attach proxyInfo to any TranscriptError we throw
  const fail = (code, message) => {
    const err = new TranscriptError(code, message);
    err.proxyInfo = proxyInfo;
    throw err;
  };

  // 1. Metadata pass — learn what tracks exist
  let metadata;
  try {
    metadata = await ytDlp.getVideoInfo(videoUrl, [
      '--skip-download',
      '--extractor-args', YOUTUBE_EXTRACTOR_ARGS,
      ...impFlags,
      ...proxyFlags
    ]);
  } catch (e) {
    const msg = String(e && e.message || '');
    if (/private video|video unavailable|removed|sign in to confirm|members[- ]only|copyright|terminated/i.test(msg)) {
      fail('VIDEO_UNAVAILABLE', msg.split('\n').slice(-2)[0] || 'Video unavailable');
    }
    fail('WATCH_PAGE_FAILED', `yt-dlp metadata fetch failed: ${msg.slice(0, 300)}`);
  }

  const manualSubs = metadata.subtitles          || {};
  const autoSubs   = metadata.automatic_captions || {};

  // 2. Choose best track (manual > auto, preferred lang > any other manual)
  const manualLang = findLangKey(manualSubs, preferredLang);
  const autoLang   = manualLang ? null : findLangKey(autoSubs, preferredLang);

  let chosenLang, isGenerated, sourceFlag;
  if (manualLang) {
    chosenLang  = manualLang;
    isGenerated = false;
    sourceFlag  = '--write-subs';
  } else if (autoLang) {
    chosenLang  = autoLang;
    isGenerated = true;
    sourceFlag  = '--write-auto-subs';
  } else {
    // Fall back to any manual track in any language
    const anyManual = Object.keys(manualSubs).find(k => Array.isArray(manualSubs[k]) && manualSubs[k].length);
    if (anyManual) {
      chosenLang  = anyManual;
      isGenerated = false;
      sourceFlag  = '--write-subs';
    } else {
      fail('TRANSCRIPTS_DISABLED', 'Transcripts are disabled or unavailable for this video');
    }
  }

  // 3. Download the chosen subtitle file via yt-dlp
  const tmpId          = crypto.randomBytes(8).toString('hex');
  const tmpDir         = os.tmpdir();
  const outputTemplate = path.join(tmpDir, `yt-transcript-${tmpId}-%(id)s.%(ext)s`);

  try {
    await ytDlp.execPromise([
      videoUrl,
      '--skip-download',
      sourceFlag,
      '--sub-langs',     chosenLang,
      '--sub-format',    'json3',
      '-o',              outputTemplate,
      '--extractor-args', YOUTUBE_EXTRACTOR_ARGS,
      '--no-warnings',
      '--quiet',
      ...impFlags,
      ...proxyFlags
    ]);
  } catch (e) {
    cleanupTmp(tmpDir, tmpId);
    fail('TRANSCRIPT_FETCH_FAILED', `yt-dlp subtitle download failed: ${String(e && e.message || '').slice(0, 300)}`);
  }

  // 4. Locate + read the produced file (yt-dlp may normalize lang code variants)
  let producedFile;
  try {
    const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(`yt-transcript-${tmpId}-`));
    if (files.length === 0) {
      fail('NO_TRANSCRIPT', 'yt-dlp ran but no transcript file was produced');
    }
    // Prefer .json3, otherwise take the first
    producedFile = files.find(f => f.endsWith('.json3')) || files[0];
    const fullPath    = path.join(tmpDir, producedFile);
    const fileContent = fs.readFileSync(fullPath, 'utf8');
    cleanupTmp(tmpDir, tmpId);

    let json3;
    try { json3 = JSON.parse(fileContent); }
    catch (e) { fail('PARSE_FAILED', `Could not parse json3 file: ${e.message}`); }

    const segments = parseJson3Events(json3);
    if (segments.length === 0) {
      fail('TRANSCRIPT_EMPTY', 'Transcript exists but contains no text segments');
    }

    return {
      language: chosenLang,
      isGenerated,
      segments,
      proxyInfo
    };
  } catch (e) {
    cleanupTmp(tmpDir, tmpId);
    if (e instanceof TranscriptError) throw e;
    const wrapped = new TranscriptError('PARSE_FAILED', e.message);
    wrapped.proxyInfo = proxyInfo;
    throw wrapped;
  }
}

function cleanupTmp(tmpDir, tmpId) {
  try {
    const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(`yt-transcript-${tmpId}-`));
    for (const f of files) {
      try { fs.unlinkSync(path.join(tmpDir, f)); } catch (_) {}
    }
  } catch (_) {}
}

module.exports = { getTranscript, TranscriptError };
