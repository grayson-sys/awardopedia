import { Router } from 'express';
import crypto from 'crypto';
import { findOrCreateUser, setMagicToken, verifyMagicToken, getUserById } from '../db/queries.js';
import { signToken } from '../middleware/auth.js';
import { sendMagicLink } from '../services/email.js';
import jwt from 'jsonwebtoken';
import { query } from '../db/connection.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// POST /auth/magic-link — send magic link email
router.post('/magic-link', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required' });
    }

    const normalized = email.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const user = await findOrCreateUser(normalized);
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await setMagicToken(user.user_id, token, expires);
    await sendMagicLink(normalized, token);

    res.json({ ok: true, message: 'Magic link sent' });
  } catch (err) {
    console.error('Magic link error:', err);
    res.status(500).json({ error: 'Failed to send magic link' });
  }
});

// GET /auth/verify?token=xxx — verify token, return JWT
router.get('/verify', async (req, res) => {
  try {
    const { token, teamInvite } = req.query;
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    const user = await verifyMagicToken(token);
    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Mark email as verified
    await query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()), last_active_at = NOW() WHERE user_id = $1', [user.user_id]);

    // If there's a team invite token, process it
    if (teamInvite) {
      try {
        const invite = jwt.verify(teamInvite, JWT_SECRET);
        if (invite.teamId && invite.email === user.email) {
          await query(
            `INSERT INTO team_members (team_id, user_id, role, invited_by)
             VALUES ($1, $2, 'member', $3)
             ON CONFLICT (team_id, user_id) DO NOTHING`,
            [invite.teamId, user.user_id, invite.invitedBy]
          );
        }
      } catch {
        // Invalid invite token — ignore, still log them in
      }
    }

    // Get team membership
    const teamResult = await query(
      `SELECT t.id as team_id, t.name as team_name, tm.role
       FROM team_members tm JOIN teams t ON t.id = tm.team_id
       WHERE tm.user_id = $1 LIMIT 1`,
      [user.user_id]
    );
    const team = teamResult.rows[0] || null;

    const jwtPayload = { userId: user.user_id, email: user.email };
    if (team) jwtPayload.teamId = team.team_id;

    const jwtToken = signToken(user.user_id);

    res.cookie('awardopedia_token', jwtToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    res.json({
      ok: true,
      token: jwtToken,
      user: {
        user_id: user.user_id,
        email: user.email,
        full_name: user.full_name,
        credits: user.credits,
        avatar_url: user.avatar_url,
        onboarding_completed_at: user.onboarding_completed_at,
      },
      team: team ? { id: team.team_id, name: team.team_name, role: team.role } : null,
    });
  } catch (err) {
    console.error('Verify error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// POST /auth/logout — clear cookie
router.post('/logout', (req, res) => {
  res.clearCookie('awardopedia_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
  res.json({ ok: true });
});

// POST /auth/refresh — refresh JWT from existing valid token
router.post('/refresh', async (req, res) => {
  try {
    const header = req.headers.authorization;
    const cookieToken = req.cookies?.awardopedia_token;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : cookieToken;

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const payload = jwt.verify(token, JWT_SECRET);
    const user = await getUserById(payload.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    await query('UPDATE users SET last_active_at = NOW() WHERE user_id = $1', [user.user_id]);

    const teamResult = await query(
      `SELECT t.id as team_id FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.user_id = $1 LIMIT 1`,
      [user.user_id]
    );
    const teamId = teamResult.rows[0]?.team_id || null;

    const newToken = signToken(user.user_id);

    res.cookie('awardopedia_token', newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({
      ok: true,
      token: newToken,
      user: {
        user_id: user.user_id,
        email: user.email,
        full_name: user.full_name,
        credits: user.credits,
        avatar_url: user.avatar_url,
      },
    });
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
});

export default router;
