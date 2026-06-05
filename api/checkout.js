import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
const PRICE_IDS = {
  investor: 'price_1Tf56fRzknTRj7hIbLhwquKo',
  proff: 'price_1Tf56zRzknTRj7hIP9cMHf5c'
};
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Kun POST støttes' });
  const { plan, email } = req.body || {};
  if (!plan || !PRICE_IDS[plan]) return res.status(400).json({ error: 'Ugyldig plan' });

  // Diagnostikk: bekreft at nødvendige miljøvariabler faktisk finnes i den kjørende
  // deployen (uten å lekke selve verdiene). Dukker dette opp i Vercel Logs, vet vi
  // umiddelbart om en variabel mangler/ikke er deployet.
  const key = process.env.STRIPE_SECRET_KEY;
  console.log('CHECKOUT_ENV', {
    plan,
    priceId: PRICE_IDS[plan],
    hasStripeKey: !!key,
    stripeKeyPrefix: (key || '').slice(0, 8),
    stripeKeyLen: (key || '').length,
    hasSupabaseUrl: !!process.env.SUPABASE_URL,
    hasSupabaseServiceKey: !!process.env.SUPABASE_SERVICE_KEY
  });
  if (!key) {
    console.error('CHECKOUT_ERROR: STRIPE_SECRET_KEY mangler i miljøet');
    return res.status(500).json({ error: 'Server mangler STRIPE_SECRET_KEY' });
  }

  // Hvis frontend sender en innlogget brukers token, verifiser den server-side og
  // bruk den VERIFISERTE bruker-id-en og e-posten. Det gjør webhook-matchingen
  // entydig (client_reference_id = user.id) og hindrer at klienten kan oppgi en
  // annens e-post. Sendes ingen token, faller vi tilbake på e-post fra bodyen
  // (bakoverkompatibelt — ingenting brytes).
  let userId = null;
  let userEmail = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await sb.auth.getUser(token);
      if (user) { userId = user.id; userEmail = user.email; }
    } catch (e) {
      console.error('CHECKOUT_AUTH_WARN', e.message);
    }
  }

  try {
    const stripe = new Stripe(key);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: PRICE_IDS[plan], quantity: 1 }],
      allow_promotion_codes: true,
      customer_email: userEmail || email || undefined,
      client_reference_id: userId || undefined,
      success_url: 'https://borshjelpen.no/profil.html?subscribed=true',
      cancel_url: 'https://borshjelpen.no/priser.html',
      metadata: { plan, user_id: userId || '' },
      subscription_data: {
        metadata: { plan, user_id: userId || '' }
      }
    });
    res.status(200).json({ url: session.url });
  } catch (err) {
    // Logg HELE Stripe-feilen til Vercel Logs, og returner type/kode til klienten.
    console.error('CHECKOUT_ERROR', {
      message: err.message,
      type: err.type,
      code: err.code,
      statusCode: err.statusCode,
      param: err.param
    });
    res.status(500).json({ error: err.message, type: err.type, code: err.code });
  }
}
