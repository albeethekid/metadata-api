// Test proxy configuration
require('dotenv').config();
const { getPlaywrightProxyConfig, isProxyEnabled } = require('./src/proxy-config');

console.log('Environment variables:');
console.log('USE_PROXY:', process.env.USE_PROXY);
console.log('OXYLABS_PROXY_SERVER:', process.env.OXYLABS_PROXY_SERVER);
console.log('OXYLABS_USERNAME:', process.env.OXYLABS_USERNAME ? '***' : 'not set');
console.log('OXYLABS_PASSWORD:', process.env.OXYLABS_PASSWORD ? '***' : 'not set');
console.log('\nProxy enabled:', isProxyEnabled());
console.log('\nPlaywright proxy config:', JSON.stringify(getPlaywrightProxyConfig('oxylabs'), null, 2));
