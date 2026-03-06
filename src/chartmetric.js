const fetch = require('node-fetch');

let accessToken = null;
let tokenExpiry = null;

async function getAccessToken() {
  const now = Date.now();
  
  if (accessToken && tokenExpiry && now < tokenExpiry) {
    return accessToken;
  }

  const refreshToken = process.env.CHARTMETRICS_API_KEY || process.env.CHARTMETRIC_REFRESH_TOKEN;

  if (!refreshToken) {
    throw new Error('Missing CHARTMETRICS_API_KEY or CHARTMETRIC_REFRESH_TOKEN');
  }

  console.log('[Chartmetric OAuth] Fetching access token...');
  
  const response = await fetch('https://api.chartmetric.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      refreshtoken: refreshToken
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Chartmetric OAuth] Error response:', response.status, errorText);
    throw new Error(`Chartmetric OAuth failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  console.log('[Chartmetric OAuth] Token response:', JSON.stringify(data));
  console.log('[Chartmetric OAuth] Access token obtained, expires in:', data.expires_in || 3600, 'seconds');
  
  accessToken = data.token || data.access_token;
  tokenExpiry = now + ((data.expires_in || 3600) * 1000) - 60000;
  
  console.log('[Chartmetric OAuth] Using token:', accessToken ? accessToken.substring(0, 20) + '...' : 'null');
  
  return accessToken;
}

async function chartmetricApiCall(endpoint) {
  const token = await getAccessToken();
  
  console.log('[Chartmetric API] Calling endpoint:', endpoint);
  
  const response = await fetch(`https://api.chartmetric.com/api${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Chartmetric API] Error response:', response.status, errorText);
    throw new Error(`Chartmetric API error: ${response.status} ${errorText}`);
  }

  console.log('[Chartmetric API] Success:', response.status);
  return response.json();
}

const chartmetricClient = {
  artist: {
    get: async (id) => chartmetricApiCall(`/artist/${id}`),
    getBySpotifyId: async (spotifyId) => {
      const ids = await chartmetricApiCall(`/artist/spotify/${spotifyId}/get-ids`);
      if (!ids || !ids.obj || !ids.obj.cm_artist) {
        throw new Error('Chartmetric artist ID not found for Spotify ID');
      }
      return chartmetricApiCall(`/artist/${ids.obj.cm_artist}`);
    }
  },
  track: {
    get: async (id) => chartmetricApiCall(`/track/${id}`),
    getBySpotifyId: async (spotifyId) => {
      const ids = await chartmetricApiCall(`/track/spotify/${spotifyId}/get-ids`);
      console.log('[Chartmetric] get-ids response:', JSON.stringify(ids));
      if (!ids || !ids.obj || !Array.isArray(ids.obj) || ids.obj.length === 0 || !ids.obj[0].chartmetric_ids || ids.obj[0].chartmetric_ids.length === 0) {
        console.error('[Chartmetric] Failed to extract chartmetric_ids from response');
        throw new Error('Chartmetric track ID not found for Spotify ID');
      }
      const chartmetricId = ids.obj[0].chartmetric_ids[0];
      console.log('[Chartmetric] Using Chartmetric track ID:', chartmetricId);
      return chartmetricApiCall(`/track/${chartmetricId}`);
    }
  },
  album: {
    get: async (id) => chartmetricApiCall(`/album/${id}`),
    getBySpotifyId: async (spotifyId) => {
      const ids = await chartmetricApiCall(`/album/spotify/${spotifyId}/get-ids`);
      if (!ids || !ids.obj || !ids.obj.cm_album) {
        throw new Error('Chartmetric album ID not found for Spotify ID');
      }
      return chartmetricApiCall(`/album/${ids.obj.cm_album}`);
    }
  },
  playlist: {
    get: async (id) => chartmetricApiCall(`/playlist/${id}`),
    getBySpotifyId: async (spotifyId) => {
      // Search for the playlist using Spotify URI format
      const searchResults = await chartmetricApiCall(`/search?q=spotify:playlist:${spotifyId}&type=playlists`);
      console.log('[Chartmetric] Playlist search results:', JSON.stringify(searchResults));
      
      if (!searchResults || !searchResults.obj || !searchResults.obj.playlists || !searchResults.obj.playlists.spotify || searchResults.obj.playlists.spotify.length === 0) {
        throw new Error('Chartmetric playlist not found for Spotify ID');
      }
      
      // Get the first result
      const chartmetricId = searchResults.obj.playlists.spotify[0].id;
      console.log('[Chartmetric] Using Chartmetric playlist ID from search:', chartmetricId);
      
      return chartmetricApiCall(`/playlist/spotify/${chartmetricId}`);
    }
  }
};

async function getChartmetricClient() {
  return chartmetricClient;
}

module.exports = { getChartmetricClient };
