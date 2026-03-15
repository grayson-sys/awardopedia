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
app.get('/health', (_, res) => res.json({ status: 'ok', ts: Date.now() }));

// ── Routes ────────────────────────────────────────────
app.use('/awards',      awardsRouter);
app.use('/agencies',    agenciesRouter);
app.use('/naics',       naicsRouter);
app.use('/contractors', contractorsRouter);
app.use('/expiring',    expiringRouter);
app.use('/stats',       statsRouter);
app.use('/ai',          aiRouter);
app.use('/webhooks',    webhooksRouter);

// ── 404 ───────────────────────────────────────────────
app.use((_, res) => res.status(404).json({ error: 'Not found' }));

// ── Error handler ─────────────────────────────────────
app.use((err, _, res, __) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => console.log(`Awardopedia API on :${PORT}`));
