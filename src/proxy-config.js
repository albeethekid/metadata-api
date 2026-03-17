/**
 * Proxy configuration module
 * Provides a loosely coupled interface for proxy services
 */

/**
 * Get proxy configuration for Playwright/Chromium
 * @param {string} provider - Proxy provider name (e.g., 'oxylabs')
 * @param {boolean|null} useProxy - Override to enable/disable proxy. If null, defaults to true if credentials exist.
 * @returns {Object|null} Playwright proxy config or null if disabled
 */
function getPlaywrightProxyConfig(provider = 'oxylabs', useProxy = null) {
  if (provider === 'oxylabs') {
    const server = process.env.OXYLABS_PROXY_SERVER;
    const username = process.env.OXYLABS_USERNAME;
    const password = process.env.OXYLABS_PASSWORD;

    if (!server || !username || !password) {
      console.warn('[Proxy] Oxylabs credentials not configured. Skipping proxy.');
      return null;
    }

    // If useProxy is explicitly set, use that value
    // Otherwise default to true (enabled by default if credentials exist)
    const shouldUseProxy = useProxy !== null ? useProxy : true;
    
    if (!shouldUseProxy) {
      return null;
    }

    // Parse server URL to extract host and port
    const url = new URL(server);
    
    return {
      server: server,
      username: `user-${username}`,
      password: password
    };
  }

  console.warn(`[Proxy] Unknown provider: ${provider}`);
  return null;
}

/**
 * Get proxy configuration for Axios/HTTP clients
 * @param {string} provider - Proxy provider name (e.g., 'oxylabs')
 * @param {boolean|null} useProxy - Override to enable/disable proxy. If null, defaults to true if credentials exist.
 * @returns {Object|null} Axios proxy config or null if disabled
 */
function getAxiosProxyConfig(provider = 'oxylabs', useProxy = null) {
  if (provider === 'oxylabs') {
    const server = process.env.OXYLABS_PROXY_SERVER;
    const username = process.env.OXYLABS_USERNAME;
    const password = process.env.OXYLABS_PASSWORD;

    if (!server || !username || !password) {
      console.warn('[Proxy] Oxylabs credentials not configured. Skipping proxy.');
      return null;
    }

    // If useProxy is explicitly set, use that value
    // Otherwise default to true (enabled by default if credentials exist)
    const shouldUseProxy = useProxy !== null ? useProxy : true;
    
    if (!shouldUseProxy) {
      return null;
    }

    // Parse server URL to extract protocol, host, and port
    const url = new URL(server);
    
    return {
      protocol: url.protocol.replace(':', ''),
      host: url.hostname,
      port: parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80),
      auth: {
        username: `user-${username}`,
        password: password
      }
    };
  }

  console.warn(`[Proxy] Unknown provider: ${provider}`);
  return null;
}

/**
 * Check if proxy is enabled
 * @param {boolean|null} useProxy - Override value. If null, defaults to true if credentials exist.
 * @returns {boolean}
 */
function isProxyEnabled(useProxy = null) {
  // Check if credentials exist
  const hasCredentials = !!(
    process.env.OXYLABS_PROXY_SERVER &&
    process.env.OXYLABS_USERNAME &&
    process.env.OXYLABS_PASSWORD
  );
  
  // If useProxy is explicitly set, use that value
  // Otherwise default to true if credentials exist
  if (useProxy !== null) {
    return useProxy && hasCredentials;
  }
  
  return hasCredentials;
}

module.exports = {
  getPlaywrightProxyConfig,
  getAxiosProxyConfig,
  isProxyEnabled
};
