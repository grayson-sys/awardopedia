import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PACKS = {
  starter: { credits: 100, priceId: process.env.STRIPE_PRICE_STARTER, amount: 900 },
  pro:     { credits: 500, priceId: process.env.STRIPE_PRICE_PRO, amount: 2900 },
  power:   { credits: 2000, priceId: process.env.STRIPE_PRICE_POWER, amount: 7900 },
};

export async function createCheckoutSession(packId, userId, email) {
  const pack = PACKS[packId];
  if (!pack) throw new Error('Invalid pack');

  const sessionParams = {
    mode: 'payment',
    customer_email: email,
    metadata: { userId: String(userId), packId },
    success_url: `${process.env.APP_URL || 'https://awardopedia.com'}/credits?success=1`,
    cancel_url: `${process.env.APP_URL || 'https://awardopedia.com'}/credits`,
  };

  if (pack.priceId) {
    sessionParams.line_items = [{ price: pack.priceId, quantity: 1 }];
  } else {
    sessionParams.line_items = [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: `Awardopedia ${packId.charAt(0).toUpperCase() + packId.slice(1)} — ${pack.credits} AI Credits`,
        },
        unit_amount: pack.amount,
      },
      quantity: 1,
    }];
  }

  const session = await stripe.checkout.sessions.create(sessionParams);
  return { url: session.url, sessionId: session.id };
}
