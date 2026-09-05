import { presignUrl } from '@vercel/blob';

const BLOB_READ_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const API_SECRET_KEY = process.env.API_SECRET_KEY;

export default async function handler(req, res) {
  // CORS (adjust in production)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth – same as your server
  const authHeader = req.headers.authorization || '';
  const clientKey = authHeader.replace('Bearer ', '');
  if (!clientKey || clientKey !== API_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { filename, category = 'others' } = req.body;
    if (!filename) {
      return res.status(400).json({ error: 'filename is required' });
    }

    // Use the same folder structure as before
    const pathname = `uploads/${category}/${filename}`;

    // Generate a presigned URL (valid 15 min)
    const { presignedUrl } = await presignUrl(
      { token: BLOB_READ_WRITE_TOKEN, operation: 'put' },
      {
        pathname,
        operation: 'put',
        validUntil: Date.now() + 15 * 60 * 1000,
      }
    );

    const blobUrl = presignedUrl.split('?')[0];
    return res.status(200).json({ presignedUrl, blobUrl, pathname });
  } catch (error) {
    console.error('Error generating upload URL:', error);
    return res.status(500).json({ error: error.message });
  }
}
