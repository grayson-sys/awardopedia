import { Router } from 'express';
import Stripe from 'stripe';
import { addCredits, recordCreditPurchase } from '../db/queries.js';

const router = Router();

const PACK_CREDITS = {
  starter: 100,
  pro: 500,
  power: 2000,
};

router.post('/stripe', async (req, res) => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = parseInt(session.metadata?.userId, 10);
    const packId = session.metadata?.packId;
    const credits = PACK_CREDITS[packId] || 0;

    if (userId && credits > 0) {
      try {
        await addCredits(userId, credits);
        await recordCreditPurchase({
          userId,
          stripeSessionId: session.id,
          stripePaymentId: session.payment_intent,
          credits,
          amountCents: session.amount_total,
          status: 'complete',
        });
        console.log(`Added ${credits} credits to user ${userId}`);
      } catch (err) {
        console.error('Failed to add credits:', err.message);
      }
    }
  }

  res.json({ received: true });
});

export default router;
