import { Router } from 'express';
import { listAgencies, getAgencyByCode } from '../db/queries.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const result = await listAgencies(req.query);
    res.json(result);
  } catch (err) {
    console.error('Agencies list error:', err.message);
    res.status(500).json({ error: 'Failed to list agencies' });
  }
});

router.get('/:code', async (req, res) => {
  try {
    const agency = await getAgencyByCode(req.params.code);
    if (!agency) return res.status(404).json({ error: 'Agency not found' });
    res.json(agency);
  } catch (err) {
    console.error('Agency detail error:', err.message);
    res.status(500).json({ error: 'Failed to get agency' });
  }
});

export default router;
