import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { requireAuth } from '../middleware/auth.js';
import { query } from '../db/connection.js';
import { sendMagicLink } from '../services/email.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

router.use(requireAuth);

// ── Profile ──────────────────────────────────────────

router.get('/me', async (req, res) => {
  try {
    const userId = req.user.user_id;

    const teamResult = await query(
      `SELECT t.*, tm.role FROM team_members tm
       JOIN teams t ON t.id = tm.team_id
       WHERE tm.user_id = $1 LIMIT 1`,
      [userId]
    );

    const creditsResult = await query(
      'SELECT credits FROM users WHERE user_id = $1', [userId]
    );

    const watchlistCount = await query(
      'SELECT COUNT(*)::int as count FROM watchlist_contracts WHERE user_id = $1', [userId]
    );

    const pipelineCount = await query(
      'SELECT COUNT(*)::int as count FROM opportunity_pipeline WHERE user_id = $1', [userId]
    );

    const team = teamResult.rows[0] || null;

    res.json({
      user: req.user,
      team: team ? { ...team, user_role: team.role } : null,
      credits: creditsResult.rows[0]?.credits || 0,
      watchlist_count: watchlistCount.rows[0].count,
      pipeline_count: pipelineCount.rows[0].count,
    });
  } catch (err) {
    console.error('GET /me error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

router.put('/me', async (req, res) => {
  try {
    const allowed = [
      'full_name', 'phone', 'title', 'timezone',
      'company_name', 'company_uei', 'company_cage', 'company_size',
      'company_state', 'company_naics', 'company_psc',
      'set_aside_sb', 'set_aside_wosb', 'set_aside_sdvosb', 'set_aside_vosb',
      'set_aside_8a', 'set_aside_hubzone', 'seeking_prime', 'seeking_sub',
    ];

    const sets = [];
    const vals = [];
    let idx = 1;

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        sets.push(`${key} = $${idx++}`);
        vals.push(req.body[key]);
      }
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    vals.push(req.user.user_id);
    const result = await query(
      `UPDATE users SET ${sets.join(', ')} WHERE user_id = $${idx} RETURNING *`,
      vals
    );

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('PUT /me error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ── Watchlist: Contracts ─────────────────────────────

router.get('/me/watchlist', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const offset = (page - 1) * limit;

    const result = await query(
      `SELECT wc.*, a.description_of_requirement, a.total_obligated_amount,
              a.awarding_agency_name, a.recipient_name, a.period_of_performance_current_end_date
       FROM watchlist_contracts wc
       LEFT JOIN awards a ON a.award_id = wc.award_id
       WHERE wc.user_id = $1
       ORDER BY wc.added_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.user_id, limit, offset]
    );

    const countResult = await query(
      'SELECT COUNT(*)::int as total FROM watchlist_contracts WHERE user_id = $1',
      [req.user.user_id]
    );

    res.json({ items: result.rows, total: countResult.rows[0].total, page, limit });
  } catch (err) {
    console.error('GET /me/watchlist error:', err);
    res.status(500).json({ error: 'Failed to fetch watchlist' });
  }
});

router.post('/me/watchlist', async (req, res) => {
  try {
    const { award_id, notes, priority, reminder_days_before } = req.body;
    if (!award_id) return res.status(400).json({ error: 'award_id is required' });

    const result = await query(
      `INSERT INTO watchlist_contracts (user_id, award_id, notes, priority, reminder_days_before)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.user_id, award_id, notes || null, priority || 'normal', reminder_days_before || 90]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Already in watchlist' });
    console.error('POST /me/watchlist error:', err);
    res.status(500).json({ error: 'Failed to add to watchlist' });
  }
});

router.put('/me/watchlist/:id', async (req, res) => {
  try {
    const { notes, priority, pipeline_stage } = req.body;
    const result = await query(
      `UPDATE watchlist_contracts SET notes = COALESCE($1, notes), priority = COALESCE($2, priority),
       pipeline_stage = COALESCE($3, pipeline_stage) WHERE id = $4 AND user_id = $5 RETURNING *`,
      [notes, priority, pipeline_stage, req.params.id, req.user.user_id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /me/watchlist error:', err);
    res.status(500).json({ error: 'Failed to update watchlist item' });
  }
});

router.delete('/me/watchlist/:id', async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM watchlist_contracts WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.user_id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /me/watchlist error:', err);
    res.status(500).json({ error: 'Failed to remove from watchlist' });
  }
});

// ── Watchlist: Agencies ──────────────────────────────

router.get('/me/agencies', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM watchlist_agencies WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.user_id]
    );
    res.json({ items: result.rows });
  } catch (err) {
    console.error('GET /me/agencies error:', err);
    res.status(500).json({ error: 'Failed to fetch agency watchlist' });
  }
});

router.post('/me/agencies', async (req, res) => {
  try {
    const { agency_code, agency_name, notes } = req.body;
    if (!agency_code) return res.status(400).json({ error: 'agency_code is required' });

    const result = await query(
      `INSERT INTO watchlist_agencies (user_id, agency_code, agency_name, notes)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.user_id, agency_code, agency_name || null, notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Agency already watched' });
    console.error('POST /me/agencies error:', err);
    res.status(500).json({ error: 'Failed to add agency' });
  }
});

router.delete('/me/agencies/:id', async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM watchlist_agencies WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.user_id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /me/agencies error:', err);
    res.status(500).json({ error: 'Failed to remove agency' });
  }
});

// ── Watchlist: Competitors ───────────────────────────

router.get('/me/competitors', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM watchlist_competitors WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.user_id]
    );
    res.json({ items: result.rows });
  } catch (err) {
    console.error('GET /me/competitors error:', err);
    res.status(500).json({ error: 'Failed to fetch competitors' });
  }
});

router.post('/me/competitors', async (req, res) => {
  try {
    const { recipient_uei, recipient_name, notes } = req.body;
    if (!recipient_uei) return res.status(400).json({ error: 'recipient_uei is required' });

    const result = await query(
      `INSERT INTO watchlist_competitors (user_id, recipient_uei, recipient_name, notes)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.user_id, recipient_uei, recipient_name || null, notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Competitor already watched' });
    console.error('POST /me/competitors error:', err);
    res.status(500).json({ error: 'Failed to add competitor' });
  }
});

router.delete('/me/competitors/:id', async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM watchlist_competitors WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.user_id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /me/competitors error:', err);
    res.status(500).json({ error: 'Failed to remove competitor' });
  }
});

// ── Saved Searches ───────────────────────────────────

router.get('/me/searches', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM saved_searches WHERE user_id = $1 ORDER BY updated_at DESC',
      [req.user.user_id]
    );
    res.json({ items: result.rows });
  } catch (err) {
    console.error('GET /me/searches error:', err);
    res.status(500).json({ error: 'Failed to fetch saved searches' });
  }
});

router.post('/me/searches', async (req, res) => {
  try {
    const { name, filters, alert_frequency } = req.body;
    if (!name || !filters) return res.status(400).json({ error: 'name and filters are required' });

    const result = await query(
      `INSERT INTO saved_searches (user_id, name, filters, alert_frequency)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.user_id, name, JSON.stringify(filters), alert_frequency || 'weekly']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /me/searches error:', err);
    res.status(500).json({ error: 'Failed to save search' });
  }
});

router.put('/me/searches/:id', async (req, res) => {
  try {
    const { name, filters, alert_frequency, alert_enabled } = req.body;
    const result = await query(
      `UPDATE saved_searches SET
       name = COALESCE($1, name), filters = COALESCE($2, filters),
       alert_frequency = COALESCE($3, alert_frequency), alert_enabled = COALESCE($4, alert_enabled)
       WHERE id = $5 AND user_id = $6 RETURNING *`,
      [name, filters ? JSON.stringify(filters) : null, alert_frequency, alert_enabled, req.params.id, req.user.user_id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /me/searches error:', err);
    res.status(500).json({ error: 'Failed to update search' });
  }
});

router.delete('/me/searches/:id', async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM saved_searches WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.user_id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /me/searches error:', err);
    res.status(500).json({ error: 'Failed to delete search' });
  }
});

// ── Opportunity Pipeline ─────────────────────────────

router.get('/me/pipeline', async (req, res) => {
  try {
    const result = await query(
      `SELECT op.*, a.description_of_requirement, a.awarding_agency_name, a.recipient_name
       FROM opportunity_pipeline op
       LEFT JOIN awards a ON a.award_id = op.award_id
       WHERE op.user_id = $1
       ORDER BY op.due_date ASC NULLS LAST`,
      [req.user.user_id]
    );
    res.json({ items: result.rows });
  } catch (err) {
    console.error('GET /me/pipeline error:', err);
    res.status(500).json({ error: 'Failed to fetch pipeline' });
  }
});

router.post('/me/pipeline', async (req, res) => {
  try {
    const { title, award_id, stage, estimated_value, due_date, notes } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });

    const result = await query(
      `INSERT INTO opportunity_pipeline (user_id, title, award_id, stage, estimated_value, due_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.user.user_id, title, award_id || null, stage || 'identified', estimated_value || null, due_date || null, notes || null]
    );

    // Log creation activity
    await query(
      `INSERT INTO pipeline_activities (pipeline_id, user_id, activity_type, to_stage, note)
       VALUES ($1, $2, 'created', $3, 'Pipeline opportunity created')`,
      [result.rows[0].id, req.user.user_id, stage || 'identified']
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /me/pipeline error:', err);
    res.status(500).json({ error: 'Failed to create pipeline item' });
  }
});

router.put('/me/pipeline/:id', async (req, res) => {
  try {
    const { stage, notes, probability_pct, bid_decision, estimated_value, due_date, title } = req.body;

    // Fetch current state for stage change logging
    const current = await query(
      'SELECT * FROM opportunity_pipeline WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.user_id]
    );
    if (!current.rows[0]) return res.status(404).json({ error: 'Not found' });

    const result = await query(
      `UPDATE opportunity_pipeline SET
       title = COALESCE($1, title), stage = COALESCE($2, stage),
       notes = COALESCE($3, notes), probability_pct = COALESCE($4, probability_pct),
       bid_decision = COALESCE($5, bid_decision), estimated_value = COALESCE($6, estimated_value),
       due_date = COALESCE($7, due_date)
       WHERE id = $8 AND user_id = $9 RETURNING *`,
      [title, stage, notes, probability_pct, bid_decision, estimated_value, due_date, req.params.id, req.user.user_id]
    );

    // Log stage change
    if (stage && stage !== current.rows[0].stage) {
      await query(
        `INSERT INTO pipeline_activities (pipeline_id, user_id, activity_type, from_stage, to_stage, note)
         VALUES ($1, $2, 'stage_change', $3, $4, $5)`,
        [req.params.id, req.user.user_id, current.rows[0].stage, stage, notes || null]
      );
    }

    // Log bid decision change
    if (bid_decision && bid_decision !== current.rows[0].bid_decision) {
      await query(
        `INSERT INTO pipeline_activities (pipeline_id, user_id, activity_type, note)
         VALUES ($1, $2, 'bid_decision', $3)`,
        [req.params.id, req.user.user_id, `Bid decision changed to: ${bid_decision}`]
      );
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /me/pipeline error:', err);
    res.status(500).json({ error: 'Failed to update pipeline item' });
  }
});

router.delete('/me/pipeline/:id', async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM opportunity_pipeline WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.user_id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /me/pipeline error:', err);
    res.status(500).json({ error: 'Failed to delete pipeline item' });
  }
});

// ── Notification Preferences ─────────────────────────

router.get('/me/notifications', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM notification_preferences WHERE user_id = $1',
      [req.user.user_id]
    );
    if (!result.rows[0]) {
      // Return defaults if not yet created
      return res.json({
        email_enabled: true, email_watchlist_alerts: true,
        email_saved_search_digest: true, email_expiring_reminders: true,
        email_pipeline_reminders: true, email_marketing: false,
        digest_frequency: 'weekly', digest_day_of_week: 1, digest_time: '08:00:00',
      });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /me/notifications error:', err);
    res.status(500).json({ error: 'Failed to fetch notification preferences' });
  }
});

router.put('/me/notifications', async (req, res) => {
  try {
    const fields = [
      'email_enabled', 'email_watchlist_alerts', 'email_saved_search_digest',
      'email_expiring_reminders', 'email_pipeline_reminders', 'email_marketing',
      'digest_frequency', 'digest_day_of_week', 'digest_time',
      'quiet_hours_start', 'quiet_hours_end',
    ];

    const sets = [];
    const vals = [];
    let idx = 1;

    for (const key of fields) {
      if (req.body[key] !== undefined) {
        sets.push(`${key} = $${idx++}`);
        vals.push(req.body[key]);
      }
    }

    vals.push(req.user.user_id);

    const result = await query(
      `INSERT INTO notification_preferences (user_id, ${sets.map(s => s.split(' = ')[0]).join(', ')})
       VALUES ($${idx}, ${vals.slice(0, -1).map((_, i) => `$${i + 1}`).join(', ')})
       ON CONFLICT (user_id) DO UPDATE SET ${sets.join(', ')}
       RETURNING *`,
      vals
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /me/notifications error:', err);
    res.status(500).json({ error: 'Failed to update notification preferences' });
  }
});

// ── API Keys ─────────────────────────────────────────

router.get('/me/api-keys', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, key_prefix, label, scopes, last_used_at, created_at, revoked_at
       FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL
       ORDER BY created_at DESC`,
      [req.user.user_id]
    );
    res.json({ items: result.rows });
  } catch (err) {
    console.error('GET /me/api-keys error:', err);
    res.status(500).json({ error: 'Failed to fetch API keys' });
  }
});

router.post('/me/api-keys', async (req, res) => {
  try {
    const { label, scopes } = req.body;

    const rawKey = crypto.randomBytes(32).toString('hex');
    const prefix = 'aw_' + rawKey.slice(0, 8);
    const keyHash = await bcrypt.hash(rawKey, 10);

    const result = await query(
      `INSERT INTO api_keys (user_id, key_hash, key_prefix, label, scopes)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, key_prefix, label, scopes, created_at`,
      [req.user.user_id, keyHash, prefix, label || null, JSON.stringify(scopes || [])]
    );

    res.status(201).json({
      ...result.rows[0],
      key: rawKey, // Return FULL key only this once
    });
  } catch (err) {
    console.error('POST /me/api-keys error:', err);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

router.delete('/me/api-keys/:id', async (req, res) => {
  try {
    const result = await query(
      `UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id`,
      [req.params.id, req.user.user_id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /me/api-keys error:', err);
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

// ── Team ─────────────────────────────────────────────

router.get('/me/team', async (req, res) => {
  try {
    const membership = await query(
      `SELECT tm.team_id, tm.role FROM team_members tm WHERE tm.user_id = $1 LIMIT 1`,
      [req.user.user_id]
    );
    if (!membership.rows[0]) return res.json({ team: null, members: [] });

    const teamId = membership.rows[0].team_id;

    const team = await query('SELECT * FROM teams WHERE id = $1', [teamId]);
    const members = await query(
      `SELECT tm.id, tm.role, tm.joined_at, u.user_id, u.email, u.full_name, u.avatar_url, u.title
       FROM team_members tm JOIN users u ON u.user_id = tm.user_id
       WHERE tm.team_id = $1 ORDER BY tm.joined_at`,
      [teamId]
    );

    res.json({ team: team.rows[0], members: members.rows, your_role: membership.rows[0].role });
  } catch (err) {
    console.error('GET /me/team error:', err);
    res.status(500).json({ error: 'Failed to fetch team' });
  }
});

router.post('/me/team', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    // Check if user already in a team
    const existing = await query(
      'SELECT id FROM team_members WHERE user_id = $1', [req.user.user_id]
    );
    if (existing.rows[0]) return res.status(409).json({ error: 'Already in a team' });

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const team = await query(
      `INSERT INTO teams (name, slug) VALUES ($1, $2) RETURNING *`,
      [name, slug]
    );

    await query(
      `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [team.rows[0].id, req.user.user_id]
    );

    res.status(201).json({ team: team.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Team slug already taken' });
    console.error('POST /me/team error:', err);
    res.status(500).json({ error: 'Failed to create team' });
  }
});

router.post('/me/team/invite', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email is required' });

    // Verify caller is owner or admin
    const membership = await query(
      `SELECT tm.team_id, tm.role, t.slug FROM team_members tm
       JOIN teams t ON t.id = tm.team_id
       WHERE tm.user_id = $1 AND tm.role IN ('owner', 'admin') LIMIT 1`,
      [req.user.user_id]
    );
    if (!membership.rows[0]) return res.status(403).json({ error: 'Must be team owner or admin' });

    const { team_id, slug } = membership.rows[0];

    // Check member count
    const count = await query(
      'SELECT COUNT(*)::int as cnt FROM team_members WHERE team_id = $1', [team_id]
    );
    const maxMembers = await query('SELECT max_members FROM teams WHERE id = $1', [team_id]);
    if (count.rows[0].cnt >= (maxMembers.rows[0]?.max_members || 5)) {
      return res.status(403).json({ error: 'Team is at maximum capacity' });
    }

    // Create invite token
    const inviteToken = jwt.sign(
      { teamId: team_id, email: email.toLowerCase().trim(), invitedBy: req.user.user_id },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const baseUrl = process.env.APP_URL || 'https://awardopedia.com';
    const magicToken = crypto.randomBytes(32).toString('hex');

    // Create or find the user and set magic token
    const invitedUser = await query(
      `INSERT INTO users (email) VALUES ($1) ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING user_id, email`,
      [email.toLowerCase().trim()]
    );

    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await query(
      'UPDATE users SET magic_token = $1, magic_token_expires_at = $2 WHERE user_id = $3',
      [magicToken, expires, invitedUser.rows[0].user_id]
    );

    await sendMagicLink(email.toLowerCase().trim(), magicToken, `${baseUrl}/auth/verify?join_team=${slug}`);

    res.json({ ok: true, message: `Invite sent to ${email}` });
  } catch (err) {
    console.error('POST /me/team/invite error:', err);
    res.status(500).json({ error: 'Failed to send invite' });
  }
});

router.delete('/me/team/members/:userId', async (req, res) => {
  try {
    const targetUserId = parseInt(req.params.userId);

    // Verify caller is owner or admin
    const membership = await query(
      `SELECT tm.team_id, tm.role FROM team_members tm WHERE tm.user_id = $1 AND tm.role IN ('owner', 'admin') LIMIT 1`,
      [req.user.user_id]
    );
    if (!membership.rows[0]) return res.status(403).json({ error: 'Must be team owner or admin' });

    const teamId = membership.rows[0].team_id;

    // Can't remove yourself if owner
    if (targetUserId === req.user.user_id && membership.rows[0].role === 'owner') {
      return res.status(400).json({ error: 'Owner cannot remove themselves' });
    }

    // Can't remove another owner unless you're also an owner
    const targetMembership = await query(
      'SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2',
      [teamId, targetUserId]
    );
    if (!targetMembership.rows[0]) return res.status(404).json({ error: 'Member not found' });
    if (targetMembership.rows[0].role === 'owner' && membership.rows[0].role !== 'owner') {
      return res.status(403).json({ error: 'Only owners can remove other owners' });
    }

    await query(
      'DELETE FROM team_members WHERE team_id = $1 AND user_id = $2',
      [teamId, targetUserId]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /me/team/members error:', err);
    res.status(500).json({ error: 'Failed to remove team member' });
  }
});

export default router;
