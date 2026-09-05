import { presignUrl } from '@vercel/blob';
import { getToken } from 'next-auth/jwt'; // if you use NextAuth – or use your own auth

const BLOB_READ_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const API_SECRET_KEY = process.env.API_SECRET_KEY;

export default async function handler(req, res) {
  // CORS headers – allow your frontend origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // ---------- AUTHENTICATION ----------
  const authHeader = req.headers.authorization || '';
  const clientKey = authHeader.replace('Bearer ', '');
  if (!clientKey || clientKey !== API_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Only POST allowed
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { filename, category = 'others' } = req.body;

    if (!filename) {
      return res.status(400).json({ error: 'filename is required' });
    }

    // Build the final path (same logic as your existing server)
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

    // Return the presigned URL and the final blob URL
    const blobUrl = presignedUrl.split('?')[0];

    return res.status(200).json({
      presignedUrl,
      blobUrl,
      pathname,
    });
  } catch (error) {
    console.error('Error generating upload URL:', error);
    return res.status(500).json({ error: error.message });
  }
}
