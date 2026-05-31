const { google } = require('googleapis');
require('dotenv').config();

// Daily-quota errors from googleapis surface as 403 with one of these reasons.
const QUOTA_REASONS = new Set(['quotaExceeded', 'dailyLimitExceeded']);

function isQuotaError(error) {
  if (!error) return false;
  const errs =
    (Array.isArray(error.errors) && error.errors) ||
    (error.response && error.response.data && error.response.data.error && error.response.data.error.errors) ||
    [];
  if (errs.some(e => e && QUOTA_REASONS.has(e.reason))) return true;
  // Fallback: 403 with a quota-flavored message.
  const msg = (error.message || '').toLowerCase();
  return error.code === 403 && (msg.includes('quota') || msg.includes('daily limit'));
}

// ms remaining until the next midnight in America/Los_Angeles, which is when
// YouTube Data API daily quotas reset. Falls back to 12h if Intl is missing.
function msUntilNextPacificMidnight() {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    const parts = Object.fromEntries(
      fmt.formatToParts(new Date()).filter(p => p.type !== 'literal').map(p => [p.type, p.value])
    );
    let hh = parseInt(parts.hour, 10);
    if (hh === 24) hh = 0; // some locales return '24' for midnight
    const mm = parseInt(parts.minute, 10);
    const ss = parseInt(parts.second, 10);
    const usedMs = ((hh * 60 + mm) * 60 + ss) * 1000;
    return 24 * 60 * 60 * 1000 - usedMs + 60_000; // +1m safety buffer
  } catch {
    return 12 * 60 * 60 * 1000;
  }
}

function loadKeys() {
  const multi = (process.env.YOUTUBE_API_KEYS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (multi.length > 0) return multi;
  const single = (process.env.YOUTUBE_API_KEY || '').trim();
  return single ? [single] : [];
}

class YouTubeClient {
  constructor() {
    const keys = loadKeys();
    this.clients = keys.map(key => ({
      key,
      youtube: google.youtube({ version: 'v3', auth: key }),
      exhaustedUntilMs: 0
    }));
    this.cursor = 0;

    if (this.clients.length === 0) {
      console.warn('WARNING: YOUTUBE_API_KEY (or YOUTUBE_API_KEYS) not set — YouTube endpoints will not work');
      this.youtube = null;
    } else {
      // Back-compat surface for any external callers; the rotating helper is preferred.
      this.youtube = this.clients[0].youtube;
      if (this.clients.length > 1) {
        console.log(`YouTube client initialized with ${this.clients.length} API keys (rotation enabled).`);
      }
    }
  }

  // Returns the index of the next non-exhausted client, or null if all keys
  // are currently rate-limited until next Pacific midnight.
  _pickIndex() {
    if (this.clients.length === 0) return null;
    const now = Date.now();
    for (let i = 0; i < this.clients.length; i++) {
      const idx = (this.cursor + i) % this.clients.length;
      if ((this.clients[idx].exhaustedUntilMs || 0) <= now) {
        this.cursor = idx;
        return idx;
      }
    }
    return null;
  }

  // Run `fn(youtubeClient)` against the current key. On quotaExceeded /
  // dailyLimitExceeded, mark the key exhausted until the next PT midnight,
  // rotate to the next key, and retry. Up to one attempt per key per call.
  async _call(fn) {
    if (this.clients.length === 0) {
      const e = new Error('YOUTUBE_API_KEY (or YOUTUBE_API_KEYS) is not configured.');
      e.code = 'YOUTUBE_NOT_CONFIGURED';
      throw e;
    }
    const tried = new Set();
    while (tried.size < this.clients.length) {
      const i = this._pickIndex();
      if (i == null) break;
      if (tried.has(i)) {
        // Defensive: should never happen because exhausted keys are skipped above.
        break;
      }
      tried.add(i);
      try {
        return await fn(this.clients[i].youtube);
      } catch (error) {
        if (!isQuotaError(error)) throw error;
        const resetMs = msUntilNextPacificMidnight();
        this.clients[i].exhaustedUntilMs = Date.now() + resetMs;
        this.cursor = (i + 1) % this.clients.length;
        console.warn(
          `YouTube API key #${i + 1}/${this.clients.length} hit daily quota. ` +
          `Marking exhausted for ~${Math.round(resetMs / 3_600_000)}h (until next PT midnight). ` +
          `${this.clients.length - tried.size} key(s) left to try.`
        );
      }
    }
    const e = new Error(
      `All ${this.clients.length} configured YouTube API key(s) have exceeded their daily quota.`
    );
    e.code = 'YOUTUBE_QUOTA_EXHAUSTED';
    throw e;
  }

  async searchVideos(query, maxResults = 10) {
    try {
      const response = await this._call(yt => yt.search.list({
        part: 'snippet',
        q: query,
        type: 'video',
        maxResults: maxResults,
        order: 'relevance'
      }));
      return response.data.items;
    } catch (error) {
      console.error('Error searching videos:', error.message);
      throw error;
    }
  }

  async searchChannels(query, maxResults = 10) {
    try {
      const response = await this._call(yt => yt.search.list({
        part: 'snippet',
        q: query,
        type: 'channel',
        maxResults: maxResults,
        order: 'relevance'
      }));

      const channels = response.data.items;

      // Fetch statistics for each channel to get subscriber counts
      const channelIds = channels.map(item => item.id.channelId).join(',');

      if (channelIds) {
        const statsResponse = await this._call(yt => yt.channels.list({
          part: 'statistics,snippet',
          id: channelIds
        }));

        // Map statistics and handle back to channels
        const statsMap = {};
        const handleMap = {};
        statsResponse.data.items.forEach(item => {
          statsMap[item.id] = item.statistics;
          handleMap[item.id] = item.snippet?.customUrl || item.snippet?.handle || null;
        });

        // Augment channels with statistics and handle
        channels.forEach(channel => {
          const channelId = channel.id.channelId;
          if (statsMap[channelId]) {
            channel.statistics = statsMap[channelId];
          }
          if (handleMap[channelId]) {
            channel.handle = handleMap[channelId];
          }
        });
      }

      return channels;
    } catch (error) {
      console.error('Error searching channels:', error.message);
      throw error;
    }
  }

  async getVideoDetails(videoId) {
    try {
      const response = await this._call(yt => yt.videos.list({
        part: 'snippet,statistics,contentDetails',
        id: videoId
      }));

      const video = response.data.items[0];
      if (!video) return video;

      // Add channel handle information
      if (video.snippet && video.snippet.channelId) {
        try {
          const channelResponse = await this._call(yt => yt.channels.list({
            part: 'snippet',
            id: video.snippet.channelId
          }));

          const channel = channelResponse.data.items[0];
          if (channel && channel.snippet) {
            const handle = channel.snippet.handle || channel.snippet.customUrl || null;

            // Augment response with channel information
            video.channel = {
              id: video.snippet.channelId,
              title: video.snippet.channelTitle,
              handle: handle
            };
          }
        } catch (channelError) {
          // Fail gracefully - channel lookup errors don't fail the main request
          console.warn('Channel lookup failed:', channelError.message);
          video.channel = {
            id: video.snippet.channelId,
            title: video.snippet.channelTitle,
            handle: null
          };
        }
      }

      return video;
    } catch (error) {
      console.error('Error getting video details:', error.message);
      throw error;
    }
  }

  async getChannelVideos(channelId, maxResults = 10) {
    try {
      const response = await this._call(yt => yt.search.list({
        part: 'snippet',
        channelId: channelId,
        type: 'video',
        maxResults: maxResults,
        order: 'date'
      }));
      return response.data.items;
    } catch (error) {
      console.error('Error getting channel videos:', error.message);
      throw error;
    }
  }

  async getTrendingVideos(regionCode = 'US', maxResults = 10) {
    try {
      const response = await this._call(yt => yt.videos.list({
        part: 'snippet,statistics',
        chart: 'mostPopular',
        regionCode: regionCode,
        maxResults: maxResults
      }));
      return response.data.items;
    } catch (error) {
      console.error('Error getting trending videos:', error.message);
      throw error;
    }
  }

  async getVideoComments(videoId, maxResults = 20) {
    try {
      const response = await this._call(yt => yt.commentThreads.list({
        part: 'snippet',
        videoId: videoId,
        maxResults: maxResults,
        order: 'relevance'
      }));
      return response.data.items;
    } catch (error) {
      console.error('Error getting video comments:', error.message);
      throw error;
    }
  }

  async getChannelDetails(channelId) {
    try {
      const response = await this._call(yt => yt.channels.list({
        part: 'snippet,statistics,brandingSettings',
        id: channelId
      }));
      return response.data.items[0];
    } catch (error) {
      console.error('Error getting channel details:', error.message);
      throw error;
    }
  }

  async getPlaylistItems(playlistId, maxResults = 50) {
    try {
      const response = await this._call(yt => yt.playlistItems.list({
        part: 'snippet',
        playlistId: playlistId,
        maxResults: maxResults
      }));
      return response.data.items;
    } catch (error) {
      console.error('Error getting playlist items:', error.message);
      throw error;
    }
  }

  async getChannelContentDetails(channelId) {
    try {
      const isHandle = channelId.startsWith('@');
      const params = { part: 'snippet,contentDetails' };
      if (isHandle) {
        params.forHandle = channelId.slice(1); // strip leading @
      } else {
        params.id = channelId;
      }
      const response = await this._call(yt => yt.channels.list(params));
      return response.data.items[0] || null;
    } catch (error) {
      console.error('Error getting channel content details:', error.message);
      throw error;
    }
  }

  async getPlaylistItemsAll(playlistId, maxResults = 100) {
    const items = [];
    let pageToken = undefined;
    const perPage = 50;

    while (items.length < maxResults) {
      const fetchCount = Math.min(perPage, maxResults - items.length);
      const params = {
        part: 'snippet',
        playlistId: playlistId,
        maxResults: fetchCount
      };
      if (pageToken) params.pageToken = pageToken;

      const response = await this._call(yt => yt.playlistItems.list(params));
      const batch = response.data.items || [];
      items.push(...batch);
      pageToken = response.data.nextPageToken;
      if (!pageToken || batch.length === 0) break;
    }

    return items;
  }
}

module.exports = YouTubeClient;
