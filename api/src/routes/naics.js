import { Router } from 'express';
import { getNaicsByCode } from '../db/queries.js';

const router = Router();

router.get('/:code', async (req, res) => {
  try {
    const naics = await getNaicsByCode(req.params.code);
    if (!naics) return res.status(404).json({ error: 'NAICS code not found' });
    res.json(naics);
  } catch (err) {
    console.error('NAICS detail error:', err.message);
    res.status(500).json({ error: 'Failed to get NAICS data' });
  }
});

export default router;
