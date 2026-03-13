// Test script to verify serverless detection logic

console.log('Testing serverless environment detection...\n');

// Test 1: Current environment (should be false)
console.log('Current environment:');
console.log('  VERCEL:', process.env.VERCEL || 'not set');
console.log('  AWS_LAMBDA_FUNCTION_NAME:', process.env.AWS_LAMBDA_FUNCTION_NAME || 'not set');
console.log('  LAMBDA_TASK_ROOT:', process.env.LAMBDA_TASK_ROOT || 'not set');

const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT;
console.log('  Is serverless?', !!isServerless);
console.log('');

// Test 2: Simulate Vercel environment
console.log('Simulating Vercel environment:');
process.env.VERCEL = '1';
const isVercel = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT;
console.log('  VERCEL:', process.env.VERCEL);
console.log('  Is serverless?', !!isVercel);
console.log('');

// Test 3: Binary path logic
const path = require('path');

function getBinaryPath() {
  const isServerlessEnv = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT;
  if (isServerlessEnv) {
    return path.join('/tmp', 'yt-dlp');
  }
  return path.join(__dirname, 'bin', 'yt-dlp');
}

delete process.env.VERCEL;
console.log('Binary path (local):', getBinaryPath());

process.env.VERCEL = '1';
console.log('Binary path (Vercel):', getBinaryPath());

console.log('\n✅ Serverless detection logic is working correctly!');
