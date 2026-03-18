const { google } = require('googleapis');
require('dotenv').config();

class YouTubeClient {
  constructor() {
    this.apiKey = process.env.YOUTUBE_API_KEY;
    if (!this.apiKey) {
      console.warn('WARNING: YOUTUBE_API_KEY not set - YouTube endpoints will not work');
      this.youtube = null;
    } else {
      this.youtube = google.youtube({
        version: 'v3',
        auth: this.apiKey
      });
    }
  }

  async searchVideos(query, maxResults = 10) {
    try {
      const response = await this.youtube.search.list({
        part: 'snippet',
        q: query,
        type: 'video',
        maxResults: maxResults,
        order: 'relevance'
      });
      
      return response.data.items;
    } catch (error) {
      console.error('Error searching videos:', error.message);
      throw error;
    }
  }

  async searchChannels(query, maxResults = 10) {
    try {
      const response = await this.youtube.search.list({
        part: 'snippet',
        q: query,
        type: 'channel',
        maxResults: maxResults,
        order: 'relevance'
      });
      
      const channels = response.data.items;
      
      // Fetch statistics for each channel to get subscriber counts
      const channelIds = channels.map(item => item.id.channelId).join(',');
      
      if (channelIds) {
        const statsResponse = await this.youtube.channels.list({
          part: 'statistics,snippet',
          id: channelIds
        });
        
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
      const response = await this.youtube.videos.list({
        part: 'snippet,statistics,contentDetails',
        id: videoId
      });
      
      const video = response.data.items[0];
      if (!video) return video;
      
      // Add channel handle information
      if (video.snippet && video.snippet.channelId) {
        try {
          const channelResponse = await this.youtube.channels.list({
            part: 'snippet',
            id: video.snippet.channelId
          });
          
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
      const response = await this.youtube.search.list({
        part: 'snippet',
        channelId: channelId,
        type: 'video',
        maxResults: maxResults,
        order: 'date'
      });
      
      return response.data.items;
    } catch (error) {
      console.error('Error getting channel videos:', error.message);
      throw error;
    }
  }

  async getTrendingVideos(regionCode = 'US', maxResults = 10) {
    try {
      const response = await this.youtube.videos.list({
        part: 'snippet,statistics',
        chart: 'mostPopular',
        regionCode: regionCode,
        maxResults: maxResults
      });
      
      return response.data.items;
    } catch (error) {
      console.error('Error getting trending videos:', error.message);
      throw error;
    }
  }

  async getVideoComments(videoId, maxResults = 20) {
    try {
      const response = await this.youtube.commentThreads.list({
        part: 'snippet',
        videoId: videoId,
        maxResults: maxResults,
        order: 'relevance'
      });
      
      return response.data.items;
    } catch (error) {
      console.error('Error getting video comments:', error.message);
      throw error;
    }
  }

  async getChannelDetails(channelId) {
    try {
      const response = await this.youtube.channels.list({
        part: 'snippet,statistics,brandingSettings',
        id: channelId
      });
      
      return response.data.items[0];
    } catch (error) {
      console.error('Error getting channel details:', error.message);
      throw error;
    }
  }

  async getPlaylistItems(playlistId, maxResults = 50) {
    try {
      const response = await this.youtube.playlistItems.list({
        part: 'snippet',
        playlistId: playlistId,
        maxResults: maxResults
      });
      
      return response.data.items;
    } catch (error) {
      console.error('Error getting playlist items:', error.message);
      throw error;
    }
  }
}

module.exports = YouTubeClient;
