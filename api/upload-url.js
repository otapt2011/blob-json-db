import { presignUrl } from '@vercel/blob';

const BLOB_READ_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const API_SECRET_KEY = process.env.API_SECRET_KEY;

export default async function handler(req, res) {
  // 1. Set CORS headers for all responses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  // 2. Handle preflight OPTIONS request immediately
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 3. Authentication
  const authHeader = req.headers.authorization || '';
  const clientKey = authHeader.replace('Bearer ', '');
  if (!clientKey || clientKey !== API_SECRET_KEY) {
    console.warn('Unauthorized attempt from', req.headers.origin || 'unknown');
    return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
  }

  // 4. Only POST allowed
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { filename, category = 'others' } = req.body;

    if (!filename) {
      return res.status(400).json({ error: 'filename is required' });
    }

    // Build the pathname (same folder structure as your server)
    const pathname = `uploads/${category}/${filename}`;

    // Generate a presigned URL valid for 15 minutes
    const { presignedUrl } = await presignUrl(
      { token: BLOB_READ_WRITE_TOKEN, operation: 'put' },
      {
        pathname,
        operation: 'put',
        validUntil: Date.now() + 15 * 60 * 1000, // 15 min
      }
    );

    const blobUrl = presignedUrl.split('?')[0];

    // Optional: log successful generation
    console.log(`Generated presigned URL for ${pathname}`);

    return res.status(200).json({
      presignedUrl,
      blobUrl,
      pathname,
    });
  } catch (error) {
    console.error('Error generating upload URL:', error);
    return res.status(500).json({
      error: 'Failed to generate upload URL: ' + error.message,
    });
  }
}
