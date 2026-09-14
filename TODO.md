# TODO

## Stop logging full Error objects in src/index.js (log-spam cleanup)

`console.error('label:', error)` prints the full Node stack trace, not just
the message. One instance of this (`discover-siblings error:`) directly
contributed to Railway's 500-logs/sec cap getting hit and dropping log
entries during the 2026-09-14 YouTube quota incident — every failed request
was emitting 70+ lines of stack trace. That one is fixed; these are the
remaining spots doing the same thing, found via:

```
grep -n "console.error(" src/index.js | grep -v "error.message\|err.message\|e.message"
```

Fix is mechanical: change `error` → `error.message` (or `e` → `e.message`)
in each call below. Two lines the grep flagged are **not** included —
`Instagram tagged-music parse failed:` (src/index.js:2205) already logs
`.message`, and `EnsembleData TikTok user search failed` (src/index.js:1738)
logs a plain `{status, detail}` object, not an Error, so it has no stack
trace to spam.

- [ ] `src/index.js:577` — `transcript error:`
- [ ] `src/index.js:1465` — `Unexpected TikTok metrics error:`
- [ ] `src/index.js:1525` — `Unexpected TikTok yt-dlp error:`
- [ ] `src/index.js:1542` — `Unexpected TikTok tagged-music error:`
- [ ] `src/index.js:1684` — `Unexpected Instagram profiles error:`
- [ ] `src/index.js:1853` — `Unexpected TikTok profiles error:`
- [ ] `src/index.js:1955` — `Unexpected Twitter profiles error:`
- [ ] `src/index.js:2049` — `Instagram scraping error:`
- [ ] `src/index.js:2235` — `Unexpected Instagram Apify error:`
- [ ] `src/index.js:2254` — `Unexpected Instagram tagged-music error:`
- [ ] `src/index.js:2412` — `[Spotify endpoint] Client error:`
- [ ] `src/index.js:2566` — `Spotify metadata error:`
- [ ] `src/index.js:2610` — `[Chartmetric endpoint] Client error:`
- [ ] `src/index.js:2687` — `Chartmetric metadata error:`
- [ ] `src/index.js:2855` — `Error extracting page metadata:`
- [ ] `src/index.js:3006` — `Screenshot error:`

(Line numbers as of the 2026-09-14 session; re-grep before fixing since
later edits may shift them.)

## Other flagged-but-not-fixed items

- [ ] `isQuotaError()` in `src/youtubeClient.js` only rotates keys on
      `quotaExceeded`/`dailyLimitExceeded` reasons — a `rateLimitExceeded`
      response (burst throttling, distinct from full daily exhaustion) won't
      trigger rotation to the next key. Not the cause of the 2026-09-14
      incident (that was genuine exhaustion, correctly detected), but worth
      fixing now that more keys are configured.
