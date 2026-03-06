const fetch = require('node-fetch');

let accessToken = null;
let tokenExpiry = null;

async function getAccessToken() {
  const now = Date.now();
  
  if (accessToken && tokenExpiry && now < tokenExpiry) {
    return accessToken;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_SECRET || process.env.SPOTIFY_API_KEY;

  if (!clientId) {
    throw new Error('Missing SPOTIFY_CLIENT_ID');
  }

  if (!clientSecret) {
    throw new Error('Missing SPOTIFY_SECRET or SPOTIFY_API_KEY');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  
  console.log('[Spotify OAuth] Fetching access token...');
  
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Spotify OAuth] Error response:', response.status, errorText);
    throw new Error(`Spotify OAuth failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  console.log('[Spotify OAuth] Access token obtained, expires in:', data.expires_in, 'seconds');
  
  accessToken = data.access_token;
  tokenExpiry = now + (data.expires_in * 1000) - 60000;
  
  return accessToken;
}

async function spotifyApiCall(endpoint) {
  const token = await getAccessToken();
  
  console.log('[Spotify API] Calling endpoint:', endpoint);
  
  const response = await fetch(`https://api.spotify.com/v1${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Spotify API] Error response:', response.status, errorText);
    throw new Error(`Spotify API error: ${response.status} ${errorText}`);
  }

  console.log('[Spotify API] Success:', response.status);
  return response.json();
}

const spotifyClient = {
  tracks: {
    get: async (id) => spotifyApiCall(`/tracks/${id}`)
  },
  albums: {
    get: async (id) => spotifyApiCall(`/albums/${id}`)
  },
  artists: {
    get: async (id) => spotifyApiCall(`/artists/${id}`)
  },
  playlists: {
    getPlaylist: async (id) => spotifyApiCall(`/playlists/${id}`)
  },
  shows: {
    get: async (id) => spotifyApiCall(`/shows/${id}`)
  },
  episodes: {
    get: async (id) => spotifyApiCall(`/episodes/${id}`)
  }
};

async function getSpotifyClient() {
  return spotifyClient;
}

module.exports = { getSpotifyClient };
