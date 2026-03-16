import { Router } from 'express';
import { searchAwards, getAwardById, getRelatedAwards, enrichAwardFromUSASpending } from '../db/queries.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const result = await searchAwards(req.query);
    res.json(result);
  } catch (err) {
    console.error('Awards search error:', err.message, err.stack?.split('\n')[1]);
    res.status(500).json({ error: 'Failed to search awards', detail: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const award = await getAwardById(req.params.id);
    if (!award) return res.status(404).json({ error: 'Award not found' });
    const related = await getRelatedAwards(award);
    res.json({ award, related });
  } catch (err) {
    console.error('Award detail error:', err.message);
    res.status(500).json({ error: 'Failed to get award' });
  }
});

router.post('/:id/enrich', async (req, res) => {
  try {
    const award = await enrichAwardFromUSASpending(req.params.id);
    if (!award) return res.status(404).json({ error: 'Award not found' });
    res.json({ award });
  } catch (err) {
    console.error('Enrich error:', err.message);
    res.status(500).json({ error: 'Failed to enrich award' });
  }
});

export default router;
