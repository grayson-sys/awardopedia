import jwt from 'jsonwebtoken';
import { getUserById } from '../db/queries.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
}

export function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    getUserById(payload.userId).then((user) => {
      req.user = user || null;
      next();
    }).catch(() => {
      req.user = null;
      next();
    });
  } catch {
    req.user = null;
    next();
  }
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    getUserById(payload.userId).then((user) => {
      if (!user) return res.status(401).json({ error: 'User not found' });
      req.user = user;
      next();
    }).catch(() => res.status(401).json({ error: 'Authentication failed' }));
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
