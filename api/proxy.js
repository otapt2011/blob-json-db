import { put, list, del, presignUrl } from '@vercel/blob'; // <-- added presignUrl
import { IncomingForm } from 'formidable';
import fs from 'fs';
import crypto from 'crypto';

const BLOB_READ_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const BLOB_STORE_ID = process.env.BLOB_STORE_ID || '';
const API_SECRET_KEY = process.env.API_SECRET_KEY;

export const config = {
  api: {
    bodyParser: false,
  },
};

// Increase max duration for merging large files (Vercel Pro allows up to 300s)
export const maxDuration = 60; // seconds (adjust as needed)

// ------------------------------------------------------------
// Helper: Infer content type from file extension
// ------------------------------------------------------------
function getContentType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const map = {
    // Images
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'bmp': 'image/bmp',
    'ico': 'image/x-icon',
    'tiff': 'image/tiff',
    // Videos
    'mp4': 'video/mp4',
    'webm': 'video/webm',
    'ogg': 'video/ogg',
    'avi': 'video/x-msvideo',
    'mov': 'video/quicktime',
    'mkv': 'video/x-matroska',
    'flv': 'video/x-flv',
    'wmv': 'video/x-ms-wmv',
    // Audio
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'flac': 'audio/flac',
    'aac': 'audio/aac',
    'ogg': 'audio/ogg',
    'wma': 'audio/x-ms-wma',
    // Documents
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'odt': 'application/vnd.oasis.opendocument.text',
    'ods': 'application/vnd.oasis.opendocument.spreadsheet',
    'odp': 'application/vnd.oasis.opendocument.presentation',
    // Archives
    'zip': 'application/zip',
    'rar': 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed',
    'tar': 'application/x-tar',
    'gz': 'application/gzip',
    // Data
    'json': 'application/json',
    'xml': 'application/xml',
    'csv': 'text/csv',
    'txt': 'text/plain',
    'md': 'text/markdown',
    // Code
    'html': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript',
    'jsx': 'application/javascript',
    'ts': 'application/typescript',
    'tsx': 'application/typescript',
    'vue': 'application/octet-stream',
    'py': 'text/x-python',
    'java': 'text/x-java',
    'c': 'text/x-c',
    'cpp': 'text/x-c++',
  };
  return map[ext] || 'application/octet-stream';
}

// ------------------------------------------------------------
// Main API Handler
// ------------------------------------------------------------
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ---------- AUTHENTICATION ----------
  const authHeader = req.headers.authorization || '';
  const clientKey = authHeader.replace('Bearer ', '');

  if (!clientKey || clientKey !== API_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
  }

  // ---------- POST: Upload a file or generate presigned URL ----------
  if (req.method === 'POST') {
    // Check if this is a presign request
    if (req.query.action === 'presign') {
      const form = new IncomingForm();
      try {
        // Parse the multipart form data (only fields, no files)
        const { fields } = await new Promise((resolve, reject) => {
          form.parse(req, (err, fields, files) => {
            if (err) reject(err);
            else resolve({ fields, files });
          });
        });

        // Extract fields (formidable gives arrays)
        const filename = fields.filename?.[0] || fields.filename;
        const category = fields.category?.[0] || fields.category || 'others';

        if (!filename) {
          return res.status(400).json({ error: 'filename is required' });
        }

        // Build the pathname (same folder structure)
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
        console.error('Error generating presigned URL:', error);
        return res.status(500).json({ error: error.message });
      }
    }

    // --- Normal or chunked upload (existing logic) ---
    const form = new IncomingForm();
    try {
      const { fields, files } = await new Promise((resolve, reject) => {
        form.parse(req, (err, fields, files) => {
          if (err) reject(err);
          else resolve({ fields, files });
        });
      });

      // Check if this is a chunked upload
      const isChunked = fields.chunkIndex !== undefined && fields.totalChunks !== undefined && fields.fileId;

      if (isChunked) {
        return await handleChunkUpload(fields, files, res);
      } else {
        return await handleNormalUpload(fields, files, req, res);
      }
    } catch (error) {
      console.error('Upload error:', error);
      return res.status(500).json({ error: error.message || 'Upload failed' });
    }
  }

  // ---------- GET: List all blobs ----------
  if (req.method === 'GET') {
    try {
      const result = await list({ token: BLOB_READ_WRITE_TOKEN });

      const blobsWithMeta = result.blobs.map(blob => {
        let lastModified = blob.uploadedAt; // fallback

        if (blob.metadata?.lastModified) {
          lastModified = Number(blob.metadata.lastModified);
        } else {
          // Try to parse date from folder structure
          const parts = blob.pathname.split('/').filter(p => p.length > 0);
          if (parts.length >= 4) {
            const year = parseInt(parts[parts.length - 4], 10);
            const month = parseInt(parts[parts.length - 3], 10);
            const day = parseInt(parts[parts.length - 2], 10);
            if (!isNaN(year) && !isNaN(month) && !isNaN(day) &&
              month >= 1 && month <= 12 && day >= 1 && day <= 31) {
              const parsed = new Date(year, month - 1, day).getTime();
              if (!isNaN(parsed)) {
                lastModified = parsed;
              }
            }
          }
        }

        return { ...blob, lastModified };
      });

      return res.status(200).json({
        blobs: blobsWithMeta,
        storeId: BLOB_STORE_ID,
      });
    } catch (error) {
      console.error('List error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  // ---------- DELETE: Remove a blob (pathname from query parameter) ----------
  if (req.method === 'DELETE') {
    try {
      const { pathname } = req.query;

      if (!pathname) {
        return res.status(400).json({ error: 'Missing pathname query parameter' });
      }

      await del(pathname, { token: BLOB_READ_WRITE_TOKEN });
      return res.status(200).json({ success: true, pathname });
    } catch (error) {
      console.error('Delete error:', error);
      return res.status(500).json({ error: error.message });
    }
  }
}

// ------------------------------------------------------------
// Helper: Handle normal (non‑chunked) upload
// ------------------------------------------------------------
async function handleNormalUpload(fields, files, req, res) {
  let file = files.image;
  if (Array.isArray(file)) file = file[0];
  if (!file) throw new Error('No image file provided (field "image")');

  const lastModified = req.query.lastModified || fields.lastModified || Date.now();

  // Determine folder
  let folder = '';
  const customFolder = req.query.folder;
  const category = req.query.category;

  if (customFolder) {
    folder = customFolder + '/';
  } else if (category) {
    folder = `uploads/${category}/`;
  } else {
    folder = 'uploads/';
  }

  // Filename
  let filename = file.originalFilename || file.name || file.filename;
  if (!filename) {
    const ext = file.mimetype ? file.mimetype.split('/')[1] : 'png';
    filename = `${crypto.randomUUID()}.${ext}`;
  }
  const pathname = folder + filename;

  const buffer = fs.readFileSync(file.filepath);

  // Determine content type dynamically
  const contentType = getContentType(filename) || file.mimetype || 'application/octet-stream';

  const blob = await put(pathname, buffer, {
    access: 'public',
    contentType: contentType,
    token: BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: false,
    metadata: {
      lastModified: String(lastModified),
    },
  });

  return res.status(200).json(blob);
}

// ------------------------------------------------------------
// Helper: Handle chunked upload (supports all file types)
// ------------------------------------------------------------
async function handleChunkUpload(fields, files, res) {
  const fileId = String(fields.fileId);
  const chunkIndex = parseInt(fields.chunkIndex, 10);
  const totalChunks = parseInt(fields.totalChunks, 10);
  const fileName = fields.fileName || fileId; // final filename
  const category = fields.category || 'json-data';
  const lastModified = fields.lastModified || Date.now();

  // Validate chunk metadata
  if (isNaN(chunkIndex) || isNaN(totalChunks) || chunkIndex < 0 || totalChunks <= 0 || chunkIndex >= totalChunks) {
    throw new Error('Invalid chunk metadata');
  }

  // Get the chunk file (field name can be "chunk" or "image")
  let chunkFile = files.chunk || files.image;
  if (Array.isArray(chunkFile)) chunkFile = chunkFile[0];
  if (!chunkFile) throw new Error('No chunk file provided');

  // Read chunk buffer
  const chunkBuffer = fs.readFileSync(chunkFile.filepath);

  // Temporary path for this chunk in Vercel Blob
  const chunkPath = `tmp/chunks/${fileId}/${chunkIndex}`;

  // Upload the chunk
  await put(chunkPath, chunkBuffer, {
    access: 'public',
    contentType: 'application/octet-stream',
    token: BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: false,
    metadata: {
      fileId,
      chunkIndex: String(chunkIndex),
      totalChunks: String(totalChunks),
      lastModified: String(lastModified),
    },
  });

  // Count how many chunks are present for this fileId
  const { blobs } = await list({
    token: BLOB_READ_WRITE_TOKEN,
    prefix: `tmp/chunks/${fileId}/`,
  });

  const uploadedChunks = blobs.length;

  // If all chunks are uploaded, merge them
  if (uploadedChunks === totalChunks) {
    // Retrieve all chunks in correct order
    const chunks = await Promise.all(
      blobs.map(async (blob) => {
        const response = await fetch(blob.url);
        const arrayBuffer = await response.arrayBuffer();
        return { index: parseInt(blob.pathname.split('/').pop(), 10), data: Buffer.from(arrayBuffer) };
      })
    );

    // Sort by chunk index
    chunks.sort((a, b) => a.index - b.index);

    // Concatenate buffers
    const finalBuffer = Buffer.concat(chunks.map(c => c.data));

    // Determine final folder (same logic as normal upload)
    let folder = '';
    const customFolder = fields.folder || '';
    if (customFolder) {
      folder = customFolder + '/';
    } else if (category) {
      folder = `uploads/${category}/`;
    } else {
      folder = 'uploads/';
    }

    const finalPath = folder + fileName;

    // ----- Dynamically infer content type from file name -----
    const contentType = getContentType(fileName);

    // Upload the complete file
    const finalBlob = await put(finalPath, finalBuffer, {
      access: 'public',
      contentType: contentType,   // now works for any file type
      token: BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: false,
      metadata: {
        lastModified: String(lastModified),
      },
    });

    // Delete all temporary chunk blobs
    await Promise.all(
      blobs.map(async (blob) => {
        await del(blob.pathname, { token: BLOB_READ_WRITE_TOKEN });
      })
    );

    return res.status(200).json(finalBlob);
  } else {
    // Not all chunks uploaded yet – respond with partial success
    return res.status(200).json({
      received: true,
      chunkIndex,
      totalChunks,
      uploadedChunks,
      remaining: totalChunks - uploadedChunks,
    });
  }
}
