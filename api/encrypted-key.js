// api/encrypted-key.js
// Stores encrypted key in environment variables or database
// This version is more secure as key can be rotated without redeployment

const ENCRYPTED_JFR_KEY = JSON.parse(process.env.ENCRYPTED_JFR_KEY || '{}');

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET', 'OPTIONS']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    try {
        if (!ENCRYPTED_JFR_KEY || !ENCRYPTED_JFR_KEY.ciphertext) {
            return res.status(404).json({ 
                error: 'Encrypted key not configured',
                jfrKey: null 
            });
        }

        return res.status(200).json({
            success: true,
            jfrKey: ENCRYPTED_JFR_KEY
        });
    } catch (error) {
        console.error('Error fetching encrypted key:', error);
        return res.status(500).json({ error: error.message });
    }
}
