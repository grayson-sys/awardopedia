import { Router } from 'express';
import { getStats } from '../db/queries.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const stats = await getStats();
    res.json(stats);
  } catch (err) {
    console.error('Stats error:', err.message);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

export default router;
