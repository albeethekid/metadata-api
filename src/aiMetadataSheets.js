// Backs public/ai-metadata-augmentation.html — a copy of the Vermillio
// Report Augmentation tool (see sheetsService.js) that additionally:
//   - fetches YouTube `tags` and `description` (free on the same Data API
//     call urlProcessor already makes; not exposed by the base tool) and
//     writes them to new columns appended at the end of the sheet
//   - checks ScrapingBee for YouTube's "How this was made" / "Made with AI"
//     disclosure label (see youtubeAiLabel.js — the Data API has no
//     equivalent field) and writes TRUE/FALSE into an existing
//     `made_with_ai` column
//
// Reuses sheetsService's Sheets I/O wholesale (same `report` tab / `page_url`
// convention, same fill-blanks-only semantics) via its columnMap parameters
// rather than re-implementing them — only the column set and the per-row
// fetch differ.

const { COLUMN_MAP } = require('./sheetsService');
const { processUrl } = require('./urlProcessor');
const { checkMadeWithAi } = require('./youtubeAiLabel');

// Base columns (title, handle, duration, view_count, ...) plus the three
// new ones this tool adds.
const AI_METADATA_COLUMN_MAP = [
  ...COLUMN_MAP,
  ['tags',          'tags'],
  ['description',   'description'],
  ['made_with_ai',  'madeWithAi']
];

// tags/description are created on the sheet if missing (appended at the
// end). made_with_ai is NOT — it's expected to already exist; if it
// doesn't, it's silently skipped same as any other missing header.
const AUTO_CREATE_COLUMNS = ['tags', 'description'];

/**
 * Fetch one row's normalized metadata: the same base fields
 * urlProcessor.processUrl always returns (now including YouTube tags/
 * description), plus a `madeWithAi` field ('TRUE'|'FALSE') for YouTube URLs
 * whose ScrapingBee check succeeded. The ScrapingBee check runs only when
 * the base fetch itself succeeded and the URL is YouTube; a failed/
 * inconclusive check leaves `madeWithAi` unset so the caller (buildRowUpdates)
 * skips that cell rather than writing a wrong TRUE/FALSE.
 *
 * @param {string} pageUrl
 * @param {object} [opts]  passed through to processUrl (e.g. includeScreenshots)
 */
async function fetchRowNormalized(pageUrl, opts = {}) {
  const result = await processUrl(pageUrl, opts);
  if (result.ok && result.platform === 'youtube') {
    const madeWithAi = await checkMadeWithAi(pageUrl);
    if (madeWithAi != null) result.normalized.madeWithAi = madeWithAi;
  }
  return result;
}

module.exports = {
  AI_METADATA_COLUMN_MAP,
  AUTO_CREATE_COLUMNS,
  fetchRowNormalized
};
