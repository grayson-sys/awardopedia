import { Router } from 'express';
import { getContractorByUei, searchContractors } from '../db/queries.js';

const router = Router();

router.get('/search', async (req, res) => {
  try {
    const result = await searchContractors(req.query);
    res.json(result);
  } catch (err) {
    console.error('Contractor search error:', err.message);
    res.status(500).json({ error: 'Failed to search contractors' });
  }
});

router.get('/:uei', async (req, res) => {
  try {
    const contractor = await getContractorByUei(req.params.uei);
    if (!contractor) return res.status(404).json({ error: 'Contractor not found' });
    res.json(contractor);
  } catch (err) {
    console.error('Contractor detail error:', err.message);
    res.status(500).json({ error: 'Failed to get contractor' });
  }
});

export default router;
