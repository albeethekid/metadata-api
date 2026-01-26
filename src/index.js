const YouTubeClient = require('./youtubeClient');
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

const youtubeClient = new YouTubeClient();

app.get('/api/search', async (req, res) => {
  try {
    const { q, maxResults = 10 } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }
    
    const results = await youtubeClient.searchVideos(q, parseInt(maxResults));
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/video/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const verbose = req.query.verbose === '1';
    
    const videoDetails = await youtubeClient.getVideoDetails(videoId);
    
    if (verbose) {
      return res.json(videoDetails);
    }
    
    // Compact response format
    const compact = {
      videoId: videoId,
      publishedAt: videoDetails.snippet?.publishedAt || null,
      durationIso: videoDetails.contentDetails?.duration || null,
      durationSeconds: parseDurationToSeconds(videoDetails.contentDetails?.duration) || null,
      viewCount: parseInt(videoDetails.statistics?.viewCount) || null,
      likeCount: parseInt(videoDetails.statistics?.likeCount) || null,
      commentCount: parseInt(videoDetails.statistics?.commentCount) || null,
      engagement: {
        likeRate: calculateRate(parseInt(videoDetails.statistics?.likeCount), parseInt(videoDetails.statistics?.viewCount)),
        commentRate: calculateRate(parseInt(videoDetails.statistics?.commentCount), parseInt(videoDetails.statistics?.viewCount))
      },
      heroImageUrl: getHeroImageUrl(videoDetails.snippet?.thumbnails),
      channelHandle: videoDetails.channel?.handle || null
    };
    
    res.json(compact);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper function to parse ISO 8601 duration to seconds
function parseDurationToSeconds(duration) {
  if (!duration) return null;
  
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return null;
  
  const hours = parseInt(match[1]) || 0;
  const minutes = parseInt(match[2]) || 0;
  const seconds = parseInt(match[3]) || 0;
  
  return hours * 3600 + minutes * 60 + seconds;
}

// Helper function to calculate engagement rates
function calculateRate(count, viewCount) {
  if (!count || !viewCount || viewCount === 0) return null;
  return parseFloat((count / viewCount).toFixed(4));
}

// Helper function to get hero image URL
function getHeroImageUrl(thumbnails) {
  if (!thumbnails) return null;
  
  return thumbnails.maxres?.url ||
         thumbnails.standard?.url ||
         thumbnails.high?.url ||
         thumbnails.medium?.url ||
         thumbnails.default?.url ||
         null;
}

app.get('/api/channel/:channelId/videos', async (req, res) => {
  try {
    const { channelId } = req.params;
    const { maxResults = 10 } = req.query;
    const videos = await youtubeClient.getChannelVideos(channelId, parseInt(maxResults));
    res.json(videos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/trending', async (req, res) => {
  try {
    const { regionCode = 'US', maxResults = 10 } = req.query;
    const trending = await youtubeClient.getTrendingVideos(regionCode, parseInt(maxResults));
    res.json(trending);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/video/:videoId/comments', async (req, res) => {
  try {
    const { videoId } = req.params;
    const { maxResults = 20 } = req.query;
    const comments = await youtubeClient.getVideoComments(videoId, parseInt(maxResults));
    res.json(comments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/channel/:channelId', async (req, res) => {
  try {
    const { channelId } = req.params;
    const channelDetails = await youtubeClient.getChannelDetails(channelId);
    res.json(channelDetails);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/playlist/:playlistId', async (req, res) => {
  try {
    const { playlistId } = req.params;
    const { maxResults = 50 } = req.query;
    const items = await youtubeClient.getPlaylistItems(playlistId, parseInt(maxResults));
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/', (req, res) => {
  res.json({
    message: 'YouTube API Server',
    endpoints: {
      search: '/api/search?q=query&maxResults=10',
      video: '/api/video/:videoId?verbose=1 (verbose=1 returns full response, default returns compact)',
      channelVideos: '/api/channel/:channelId/videos?maxResults=10',
      trending: '/api/trending?regionCode=US&maxResults=10',
      videoComments: '/api/video/:videoId/comments?maxResults=20',
      channel: '/api/channel/:channelId',
      playlist: '/api/playlist/:playlistId?maxResults=50'
    }
  });
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`YouTube API server running on port ${port}`);
    console.log(`Visit http://localhost:${port} for API documentation`);
  });
}

module.exports = app;
