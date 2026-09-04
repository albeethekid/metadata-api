// Detects YouTube's "How this was made" content-disclosure panel (the
// "Made with AI" / "Altered or synthetic content" label creators can attach
// to a video) via ScrapingBee. The YouTube Data API has no equivalent field,
// so this scrapes the watch page instead.
//
// The panel is server-rendered into the watch page's `ytInitialData` JSON
// blob, so a plain (non-JS-rendered) ScrapingBee fetch is enough — cheaper
// than the default render_js=true and just as reliable for this signal.
// Scoped to YouTube URLs only.

const { fetchHtml } = require('./scrapingBeeClient');

// Presence of this renderer key in ytInitialData is the disclosure signal —
// it only appears in the description's structured-content sections when the
// uploader has applied the label.
const HOW_THIS_WAS_MADE_MARKER = '"howThisWasMadeSectionViewModel"';

/**
 * Check whether a YouTube watch URL carries the "How this was made"
 * disclosure label.
 *
 * @param {string} youtubeUrl
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<'TRUE'|'FALSE'|null>}  null = check failed/inconclusive
 *   (network error, upstream error, empty response) — callers should treat
 *   this as "unknown" and skip writing, not as a false "FALSE".
 */
async function checkMadeWithAi(youtubeUrl, opts = {}) {
  try {
    const { html } = await fetchHtml(youtubeUrl, {
      params: { render_js: 'false' },
      timeoutMs: opts.timeoutMs || 20000
    });
    if (!html) return null;
    return html.includes(HOW_THIS_WAS_MADE_MARKER) ? 'TRUE' : 'FALSE';
  } catch (_) {
    return null;
  }
}

module.exports = { checkMadeWithAi };
