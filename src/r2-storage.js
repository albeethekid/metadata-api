const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

/**
 * Upload a screenshot buffer to Cloudflare R2 storage
 * @param {Buffer} buffer - Screenshot buffer
 * @param {string} contentType - MIME type (e.g., 'image/jpeg')
 * @param {string} extension - File extension (e.g., 'jpg')
 * @returns {Promise<string>} - S3 URL of uploaded object
 */
async function uploadToR2(buffer, contentType, extension) {
  const {
    R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    R2_BUCKET,
    R2_PUBLIC_BASE_URL
  } = process.env;

  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    throw new Error('Missing R2 environment variables. Required: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET');
  }

  const s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY
    }
  });

  const timestamp = Date.now();
  const key = `screenshots/${timestamp}.${extension}`;

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType
  });

  await s3Client.send(command);

  // Use public URL if configured, otherwise fall back to R2 endpoint
  const s3Url = R2_PUBLIC_BASE_URL 
    ? `${R2_PUBLIC_BASE_URL}/${key}`
    : `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${key}`;
  
  return s3Url;
}

module.exports = { uploadToR2 };
