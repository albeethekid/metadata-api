// In-memory tracker for YouTube Data API v3 quota usage, broken down by
// (sheetUrl, method). Resets on process restart/redeploy — this is a
// diagnostic aid, not a durable audit log. Only successful calls are
// recorded: Google doesn't charge quota for a rejected over-quota request,
// so counting failures would overstate usage (see the 2026-09-14 incident,
// where nearly all calls were failing but the failures themselves cost
// nothing).
//
// Logs one compact line per call — deliberately NOT the full Error object
// or a stack trace, since that's what caused Railway's 500 logs/sec cap to
// start dropping entries during the same incident.

// YouTube Data API v3's per-call quota cost. search.list is the expensive
// one (100 units); nearly everything else is a flat 1 unit regardless of
// how many `part`s or comma-separated `id`s are requested (up to the 50-id
// max on list endpoints).
const UNIT_COSTS = {
  'search.list': 100,
  'videos.list': 1,
  'channels.list': 1,
  'playlistItems.list': 1,
  'commentThreads.list': 1
};

function unitsFor(method) {
  return Object.prototype.hasOwnProperty.call(UNIT_COSTS, method) ? UNIT_COSTS[method] : 1;
}

function todayKey() {
  // Aligns with youtubeClient.js's quota-reset boundary (Pacific midnight).
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
}

// Map<date, Map<sheetUrl, Map<method, {calls, units}>>>
const usage = new Map();

function recordCall({ method, sheetUrl, keyIndex }) {
  const units = unitsFor(method);
  const date = todayKey();
  const sheet = sheetUrl || '(no sheet — direct/API call)';

  if (!usage.has(date)) usage.set(date, new Map());
  const bySheet = usage.get(date);
  if (!bySheet.has(sheet)) bySheet.set(sheet, new Map());
  const byMethod = bySheet.get(sheet);
  const entry = byMethod.get(method) || { calls: 0, units: 0 };
  entry.calls += 1;
  entry.units += units;
  byMethod.set(method, entry);

  const sheetTotal = [...byMethod.values()].reduce((s, e) => s + e.units, 0);
  console.log(
    `[yt-usage] method=${method} units=${units} key=${keyIndex != null ? keyIndex + 1 : '?'} ` +
    `sheet="${sheet}" sheet_total_today=${sheetTotal}`
  );
}

// Summary for a given date (defaults to today), shaped for JSON response:
// { date, bySheet: [{ sheetUrl, totalUnits, totalCalls, byMethod: [{method, calls, units}] }] }
function getSummary(date) {
  const d = date || todayKey();
  const bySheet = usage.get(d) || new Map();
  const rows = [...bySheet.entries()].map(([sheetUrl, byMethod]) => {
    const methods = [...byMethod.entries()].map(([method, e]) => ({ method, calls: e.calls, units: e.units }));
    const totalUnits = methods.reduce((s, m) => s + m.units, 0);
    const totalCalls = methods.reduce((s, m) => s + m.calls, 0);
    return { sheetUrl, totalUnits, totalCalls, byMethod: methods.sort((a, b) => b.units - a.units) };
  }).sort((a, b) => b.totalUnits - a.totalUnits);

  const grandTotalUnits = rows.reduce((s, r) => s + r.totalUnits, 0);
  const grandTotalCalls = rows.reduce((s, r) => s + r.totalCalls, 0);
  return { date: d, grandTotalUnits, grandTotalCalls, bySheet: rows };
}

module.exports = { recordCall, getSummary, UNIT_COSTS };
