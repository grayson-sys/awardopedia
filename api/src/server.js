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

// ── Routes ────────────────────────────────────────────
// Mount under /api so DO App Platform path prefix is preserved
const prefix = process.env.ROUTE_PREFIX || '';
app.use(`${prefix}/awards`,      awardsRouter);
app.use(`${prefix}/agencies`,    agenciesRouter);
app.use(`${prefix}/naics`,       naicsRouter);
app.use(`${prefix}/contractors`, contractorsRouter);
app.use(`${prefix}/expiring`,    expiringRouter);
app.use(`${prefix}/stats`,       statsRouter);
app.use(`${prefix}/ai`,          aiRouter);
app.use(`${prefix}/webhooks`,    webhooksRouter);

// ── 404 ───────────────────────────────────────────────
app.use((_, res) => res.status(404).json({ error: 'Not found' }));

// ── Error handler ─────────────────────────────────────
app.use((err, _, res, __) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => console.log(`Awardopedia API on :${PORT}`));
