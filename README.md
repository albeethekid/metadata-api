# YouTube API Project

A comprehensive Node.js project for integrating with the YouTube Data API v3. This project provides both a REST API server and a client library for common YouTube operations.

## Features

- Search for videos
- Get video details and statistics
- Retrieve channel information and videos
- Fetch trending videos
- Get video comments
- Access playlist items
- REST API endpoints for all operations
- Example usage scripts

## Setup

### 1. Get YouTube API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the YouTube Data API v3
4. Create credentials (API Key)
5. Copy your API key

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

Copy the example environment file and add your API key:

```bash
cp .env.example .env
```

Edit `.env` and replace `your_youtube_api_key_here` with your actual API key:

```
YOUTUBE_API_KEY=your_actual_api_key_here
```

## Usage

### Running the REST API Server

```bash
npm start
```

The server will start on `http://localhost:3000`. Visit the root URL for API documentation.

### Running the Example Script

```bash
node examples/basic-usage.js
```

This will demonstrate all available API methods with sample data.

## API Endpoints

### Search Videos
```
GET /api/search?q=query&maxResults=10
```

### Get Video Details
```
GET /api/video/:videoId
```

### Get Channel Videos
```
GET /api/channel/:channelId/videos?maxResults=10
```

### Get Trending Videos
```
GET /api/trending?regionCode=US&maxResults=10
```

### Get Video Comments
```
GET /api/video/:videoId/comments?maxResults=20
```

### Get Channel Details
```
GET /api/channel/:channelId
```

### Get Playlist Items
```
GET /api/playlist/:playlistId?maxResults=50
```

## Programmatic Usage

```javascript
const YouTubeClient = require('./src/youtubeClient');

const youtubeClient = new YouTubeClient();

// Search for videos
const videos = await youtubeClient.searchVideos('JavaScript tutorial', 10);

// Get video details
const details = await youtubeClient.getVideoDetails('dQw4w9WgXcQ');

// Get trending videos
const trending = await youtubeClient.getTrendingVideos('US', 5);
```

## Available Methods

### YouTubeClient Class

- `searchVideos(query, maxResults)` - Search for videos by query
- `getVideoDetails(videoId)` - Get detailed information about a video
- `getChannelVideos(channelId, maxResults)` - Get videos from a specific channel
- `getTrendingVideos(regionCode, maxResults)` - Get trending videos by region
- `getVideoComments(videoId, maxResults)` - Get comments for a video
- `getChannelDetails(channelId)` - Get channel information
- `getPlaylistItems(playlistId, maxResults)` - Get items from a playlist

## Error Handling

All methods throw errors with descriptive messages. Make sure to wrap your API calls in try-catch blocks:

```javascript
try {
  const videos = await youtubeClient.searchVideos('query');
  console.log(videos);
} catch (error) {
  console.error('API Error:', error.message);
}
```

## API Quotas

The YouTube Data API has quota limits:
- Default quota: 10,000 units per day
- Search operation: 100 units per request
- Video details: 1 unit per request
- Channel details: 1 unit per request

Be mindful of your usage to avoid exceeding quotas.

## Development

### Running in Development Mode

```bash
npm run dev
```

This uses nodemon for automatic restarts on file changes.

### Running Tests

```bash
npm test
```

## License

MIT License
