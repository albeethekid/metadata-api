const { getTikTokVideoMetricsYtdlp } = require('./src/tiktokYtdlp');

const testUrl = 'https://www.tiktok.com/@yaroslavslonsky/video/7568246874558237965';

console.log('Testing TikTok yt-dlp scraper...');
console.log('URL:', testUrl);
console.log('');

getTikTokVideoMetricsYtdlp(testUrl, true)
  .then(result => {
    console.log('✅ Success!');
    console.log('');
    console.log('Result:');
    console.log(JSON.stringify(result, null, 2));
  })
  .catch(error => {
    console.error('❌ Error:', error.message);
    console.error('Status:', error.status);
    console.error('Code:', error.code);
  });
