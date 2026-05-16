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

function fixYtdlpShebang(binaryPath, pythonPath) {
  try {
    const content = fs.readFileSync(binaryPath);
    let newlineIndex = -1;
    for (let i = 0; i < content.length; i++) {
      if (content[i] === 0x0a) { newlineIndex = i; break; }
    }
    if (newlineIndex === -1 || content[0] !== 0x23 || content[1] !== 0x21) return;
    const newShebang = Buffer.from(`#!${pythonPath}\n`);
    fs.writeFileSync(binaryPath, Buffer.concat([newShebang, content.slice(newlineIndex + 1)]));
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

/**
 * @param {string} videoId
 * @param {string} [preferredLang='en']
 * @returns {Promise<{language:string,isGenerated:boolean,segments:Array}>}
 */
async function getTranscript(videoId, preferredLang = 'en') {
  if (!videoId || typeof videoId !== 'string') {
    throw new TranscriptError('INVALID_VIDEO_ID', 'videoId is required');
  }

  const ytDlp   = await getYtDlpInstance();
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // 1. Metadata pass — learn what tracks exist
  let metadata;
  try {
    metadata = await ytDlp.getVideoInfo(videoUrl, ['--skip-download']);
  } catch (e) {
    const msg = String(e && e.message || '');
    if (/private video|video unavailable|removed|sign in to confirm|members[- ]only|copyright|terminated/i.test(msg)) {
      throw new TranscriptError('VIDEO_UNAVAILABLE', msg.split('\n').slice(-2)[0] || 'Video unavailable');
    }
    throw new TranscriptError('WATCH_PAGE_FAILED', `yt-dlp metadata fetch failed: ${msg.slice(0, 300)}`);
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
      throw new TranscriptError(
        'TRANSCRIPTS_DISABLED',
        'Transcripts are disabled or unavailable for this video'
      );
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
      '--sub-langs',   chosenLang,
      '--sub-format',  'json3',
      '-o',            outputTemplate,
      '--no-warnings',
      '--quiet'
    ]);
  } catch (e) {
    cleanupTmp(tmpDir, tmpId);
    throw new TranscriptError(
      'TRANSCRIPT_FETCH_FAILED',
      `yt-dlp subtitle download failed: ${String(e && e.message || '').slice(0, 300)}`
    );
  }

  // 4. Locate + read the produced file (yt-dlp may normalize lang code variants)
  let producedFile;
  try {
    const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(`yt-transcript-${tmpId}-`));
    if (files.length === 0) {
      throw new TranscriptError('NO_TRANSCRIPT', 'yt-dlp ran but no transcript file was produced');
    }
    // Prefer .json3, otherwise take the first
    producedFile = files.find(f => f.endsWith('.json3')) || files[0];
    const fullPath    = path.join(tmpDir, producedFile);
    const fileContent = fs.readFileSync(fullPath, 'utf8');
    cleanupTmp(tmpDir, tmpId);

    let json3;
    try { json3 = JSON.parse(fileContent); }
    catch (e) { throw new TranscriptError('PARSE_FAILED', `Could not parse json3 file: ${e.message}`); }

    const segments = parseJson3Events(json3);
    if (segments.length === 0) {
      throw new TranscriptError('TRANSCRIPT_EMPTY', 'Transcript exists but contains no text segments');
    }

    return {
      language: chosenLang,
      isGenerated,
      segments
    };
  } catch (e) {
    cleanupTmp(tmpDir, tmpId);
    if (e instanceof TranscriptError) throw e;
    throw new TranscriptError('PARSE_FAILED', e.message);
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
