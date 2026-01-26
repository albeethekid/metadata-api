const YouTubeClient = require('../src/youtubeClient');

async function demonstrateAPI() {
  const youtubeClient = new YouTubeClient();
  
  try {
    console.log('=== YouTube API Demo ===\n');
    
    console.log('1. Searching for "JavaScript tutorial" videos...');
    const searchResults = await youtubeClient.searchVideos('JavaScript tutorial', 5);
    console.log(`Found ${searchResults.length} videos:`);
    searchResults.forEach((video, index) => {
      console.log(`  ${index + 1}. ${video.snippet.title} - ${video.snippet.channelTitle}`);
    });
    console.log();
    
    if (searchResults.length > 0) {
      const videoId = searchResults[0].id.videoId;
      console.log(`2. Getting details for video: ${searchResults[0].snippet.title}`);
      const videoDetails = await youtubeClient.getVideoDetails(videoId);
      console.log(`  Views: ${videoDetails.statistics.viewCount}`);
      console.log(`  Likes: ${videoDetails.statistics.likeCount}`);
      console.log(`  Channel: ${videoDetails.channel.title} (${videoDetails.channel.handle || 'no handle'})`);
      console.log(`  Description: ${videoDetails.snippet.description.substring(0, 100)}...`);
      console.log();
      
      console.log('3. Getting comments for this video...');
      const comments = await youtubeClient.getVideoComments(videoId, 3);
      console.log(`Found ${comments.length} comments:`);
      comments.forEach((comment, index) => {
        console.log(`  ${index + 1}. ${comment.snippet.topLevelComment.snippet.authorDisplayName}: ${comment.snippet.topLevelComment.snippet.textDisplay.substring(0, 80)}...`);
      });
      console.log();
    }
    
    console.log('4. Getting trending videos in US...');
    const trendingVideos = await youtubeClient.getTrendingVideos('US', 5);
    console.log(`Found ${trendingVideos.length} trending videos:`);
    trendingVideos.forEach((video, index) => {
      console.log(`  ${index + 1}. ${video.snippet.title} - ${video.snippet.channelTitle} (${video.statistics.viewCount} views)`);
    });
    console.log();
    
    if (searchResults.length > 0) {
      const channelId = searchResults[0].snippet.channelId;
      console.log(`5. Getting channel details for: ${searchResults[0].snippet.channelTitle}`);
      const channelDetails = await youtubeClient.getChannelDetails(channelId);
      console.log(`  Subscribers: ${channelDetails.statistics.subscriberCount}`);
      console.log(`  Total videos: ${channelDetails.statistics.videoCount}`);
      console.log(`  Total views: ${channelDetails.statistics.viewCount}`);
      console.log();
      
      console.log('6. Getting recent videos from this channel...');
      const channelVideos = await youtubeClient.getChannelVideos(channelId, 3);
      console.log(`Found ${channelVideos.length} recent videos:`);
      channelVideos.forEach((video, index) => {
        console.log(`  ${index + 1}. ${video.snippet.title} - ${video.snippet.publishedAt}`);
      });
    }
    
  } catch (error) {
    console.error('Error during demonstration:', error.message);
  }
}

if (require.main === module) {
  demonstrateAPI();
}

module.exports = demonstrateAPI;
