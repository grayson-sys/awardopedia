import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

import awardsRouter      from './routes/awards.js';
import agenciesRouter    from './routes/agencies.js';
import naicsRouter       from './routes/naics.js';
import contractorsRouter from './routes/contractors.js';
import expiringRouter    from './routes/expiring.js';
import statsRouter       from './routes/stats.js';
import aiRouter          from './routes/ai.js';
import webhooksRouter    from './routes/webhooks.js';
import usersRouter       from './routes/users.js';
// uploadsRouter disabled until DO Spaces keys are configured
// import uploadsRouter     from './routes/uploads.js';

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));
app.use('/webhooks', express.raw({ type: 'application/json' }));
app.use(express.json());

// Global rate limit
app.use(rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false }));

// ── Health ────────────────────────────────────────────
app.get('/health',     (_, res) => res.json({ status: 'ok', ts: Date.now() }));
app.get('/api/health', (_, res) => res.json({ status: 'ok', ts: Date.now() }));
app.get('/debug-env',  (_, res) => res.json({
  ROUTE_PREFIX: process.env.ROUTE_PREFIX || '(not set)',
  DB_URL_TAIL: (process.env.DATABASE_URL || '').slice(-40),
  NODE_ENV: process.env.NODE_ENV,
}));

// ── Path normalizer — strips /api prefix if DO App Platform didn't ──────
// Works correctly whether or not DO strips the /api service prefix
app.use((req, _res, next) => {
  if (req.path.startsWith('/api/') || req.path === '/api') {
    req.url = req.url.replace(/^\/api/, '') || '/';
  }
  next();
});

// ── Routes ────────────────────────────────────────────
app.use('/awards',      awardsRouter);
app.use('/agencies',    agenciesRouter);
app.use('/naics',       naicsRouter);
app.use('/contractors', contractorsRouter);
app.use('/expiring',    expiringRouter);
app.use('/stats',       statsRouter);
app.use('/ai',          aiRouter);
app.use('/webhooks',    webhooksRouter);
app.use('/users',       usersRouter);
// app.use('/uploads',  uploadsRouter);  // re-enable after DO Spaces setup

// ── 404 ───────────────────────────────────────────────
app.use((_, res) => res.status(404).json({ error: 'Not found' }));

// ── Error handler ─────────────────────────────────────
app.use((err, _, res, __) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => console.log(`Awardopedia API on :${PORT}`));
