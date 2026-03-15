import { Router } from 'express';
import { getExpiringContracts } from '../db/queries.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const result = await getExpiringContracts(req.query);
    res.json(result);
  } catch (err) {
    console.error('Expiring contracts error:', err.message);
    res.status(500).json({ error: 'Failed to get expiring contracts' });
  }
});

export default router;
