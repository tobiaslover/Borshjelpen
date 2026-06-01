import Stripe from 'stripe';

const PRICE_IDS = {
  investor: 'price_1TdRLURo4ICbszahft9ufQZP',
  proff: 'price_1TdRMNRo4ICbszahkffRfUgL'
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Kun POST støttes' });

  const { plan, email } = req.body;
  if (!plan || !PRICE_IDS[plan]) return res.status(400).json({ error: 'Ugyldig plan' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: PRICE_IDS[plan], quantity: 1 }],
      customer_email: email || undefined,
      success_url: 'https://borshjelpen.vercel.app/profil.html?subscribed=true',
      cancel_url: 'https://borshjelpen.vercel.app/priser.html',
      metadata: { plan },
      subscription_data: {
        metadata: { plan }
      }
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
