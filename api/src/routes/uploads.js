import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { generateUploadUrl } from '../services/storage.js';
import { query } from '../db/connection.js';

const router = Router();

const ALLOWED_FILE_TYPES = ['avatar', 'company_logo', 'capability_statement', 'proposal_doc'];

// POST /uploads/presign — get a presigned upload URL
router.post('/presign', requireAuth, async (req, res) => {
  try {
    const { file_type, mime_type, filename } = req.body;

    if (!file_type || !ALLOWED_FILE_TYPES.includes(file_type)) {
      return res.status(400).json({ error: `file_type must be one of: ${ALLOWED_FILE_TYPES.join(', ')}` });
    }
    if (!mime_type) {
      return res.status(400).json({ error: 'mime_type is required' });
    }

    const result = await generateUploadUrl(req.user.user_id, file_type, mime_type);

    res.json({ uploadUrl: result.uploadUrl, cdnUrl: result.cdnUrl, storageKey: result.storageKey });
  } catch (err) {
    console.error('POST /uploads/presign error:', err);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

// POST /uploads/confirm — confirm upload and save to DB
router.post('/confirm', requireAuth, async (req, res) => {
  try {
    const { storageKey, file_type, file_size_bytes } = req.body;

    if (!storageKey || !file_type) {
      return res.status(400).json({ error: 'storageKey and file_type are required' });
    }

    const cdnBase = process.env.DO_SPACES_CDN || `https://${process.env.DO_SPACES_BUCKET || 'awardopedia-assets'}.${process.env.DO_SPACES_REGION || 'nyc3'}.cdn.digitaloceanspaces.com`;
    const cdnUrl = `${cdnBase}/${storageKey}`;

    // Save file record
    const upload = await query(
      `INSERT INTO file_uploads (user_id, file_type, storage_key, cdn_url, file_size_bytes)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.user_id, file_type, storageKey, cdnUrl, file_size_bytes || null]
    );

    // Update relevant user/team field based on file_type
    if (file_type === 'avatar') {
      await query('UPDATE users SET avatar_url = $1 WHERE user_id = $2', [cdnUrl, req.user.user_id]);
    } else if (file_type === 'capability_statement') {
      await query('UPDATE users SET capability_statement_url = $1 WHERE user_id = $2', [cdnUrl, req.user.user_id]);
    } else if (file_type === 'company_logo') {
      // Update the team logo if user is in a team
      const membership = await query(
        'SELECT team_id FROM team_members WHERE user_id = $1 LIMIT 1',
        [req.user.user_id]
      );
      if (membership.rows[0]) {
        await query('UPDATE teams SET logo_url = $1 WHERE id = $2', [cdnUrl, membership.rows[0].team_id]);
      }
    }

    res.json({ ok: true, upload: upload.rows[0] });
  } catch (err) {
    console.error('POST /uploads/confirm error:', err);
    res.status(500).json({ error: 'Failed to confirm upload' });
  }
});

export default router;
