const { google } = require('googleapis');
require('dotenv').config();

class YouTubeClient {
  constructor() {
    this.apiKey = process.env.YOUTUBE_API_KEY;
    if (!this.apiKey) {
      throw new Error('YOUTUBE_API_KEY environment variable is required');
    }
    
    this.youtube = google.youtube({
      version: 'v3',
      auth: this.apiKey
    });
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

  async getVideoDetails(videoId) {
    try {
      const response = await this.youtube.videos.list({
        part: 'snippet,statistics,contentDetails',
        id: videoId
      });
      
      return response.data.items[0];
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
