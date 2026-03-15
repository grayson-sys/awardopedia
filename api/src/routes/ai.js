import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireCredits } from '../middleware/credits.js';
import { aiLimiter } from '../middleware/ratelimit.js';
import { analyzeAward, summarizeEntity } from '../services/claude.js';
import { getAwardById, deductCredits, recordCreditUsage, getCachedAnalysis } from '../db/queries.js';

const router = Router();

router.post('/analyze', requireAuth, requireCredits(1), aiLimiter, async (req, res) => {
  try {
    const { awardId, question } = req.body;
    if (!awardId) return res.status(400).json({ error: 'awardId is required' });

    const cached = await getCachedAnalysis(awardId, 'analyze');
    if (cached && !question) {
      return res.json({ analysis: cached, cached: true });
    }

    const award = await getAwardById(awardId);
    if (!award) return res.status(404).json({ error: 'Award not found' });

    const deducted = await deductCredits(req.user.user_id, 1);
    if (!deducted) return res.status(402).json({ error: 'Insufficient credits' });

    const analysis = await analyzeAward(award, question);
    await recordCreditUsage({
      userId: req.user.user_id,
      awardId: award.award_id,
      action: 'analyze',
      creditsUsed: 1,
      result: analysis,
    });

    res.json({ analysis, credits: deducted.credits });
  } catch (err) {
    console.error('AI analyze error:', err.message);
    res.status(500).json({ error: 'AI analysis failed' });
  }
});

router.post('/summarize', requireAuth, requireCredits(1), aiLimiter, async (req, res) => {
  try {
    const { entityType, entityId } = req.body;
    if (!entityType || !entityId) {
      return res.status(400).json({ error: 'entityType and entityId are required' });
    }

    const deducted = await deductCredits(req.user.user_id, 1);
    if (!deducted) return res.status(402).json({ error: 'Insufficient credits' });

    const summary = await summarizeEntity(entityType, entityId);
    await recordCreditUsage({
      userId: req.user.user_id,
      awardId: null,
      action: 'summarize',
      creditsUsed: 1,
      result: summary,
    });

    res.json({ summary, credits: deducted.credits });
  } catch (err) {
    console.error('AI summarize error:', err.message);
    res.status(500).json({ error: 'AI summarization failed' });
  }
});

export default router;
