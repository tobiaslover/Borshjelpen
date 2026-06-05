import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

function randomSuffix(len) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // uten lett forvekslbare tegn (0/O, 1/I)
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  // Verifiser bruker
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Ikke autentisert' });
  }
  const token = authHeader.replace('Bearer ', '');

  const couponId = process.env.STRIPE_WELCOME_COUPON_ID;
  if (!couponId) return res.status(500).json({ error: 'Velkomstkupong ikke konfigurert' });

  let user;
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  try {
    const { data: { user: u }, error } = await sb.auth.getUser(token);
    if (error || !u) return res.status(401).json({ error: 'Ugyldig token' });
    user = u;
  } catch (e) {
    return res.status(500).json({ error: 'Klarte ikke å verifisere bruker' });
  }

  try {
    // Idempotent: har brukeren allerede fått en kode, returner den.
    const { data: existing } = await sb
      .from('user_promo')
      .select('code')
      .eq('user_id', user.id)
      .maybeSingle();
    if (existing && existing.code) {
      return res.status(200).json({ code: existing.code, existing: true });
    }

    // Lag en unik promotion code i Stripe som peker til velkomstkupongen.
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const code = 'VELKOMMEN' + randomSuffix(5);
    let promo;
    try {
      // Koden er gyldig i 30 dager fra den genereres
      const expiresAt = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
      promo = await stripe.promotionCodes.create({
        coupon: couponId,
        code: code,
        max_redemptions: 1,
        expires_at: expiresAt,
        restrictions: { first_time_transaction: true },
        metadata: { user_id: user.id }
      });
    } catch (e) {
      // Svært sjelden kodekollisjon e.l. — be brukeren prøve igjen.
      return res.status(500).json({ error: 'Kunne ikke generere rabattkode akkurat nå.' });
    }

    // Lagre på brukeren (idempotent via unik user_id).
    await sb.from('user_promo').upsert(
      { user_id: user.id, code: promo.code, stripe_promotion_code_id: promo.id },
      { onConflict: 'user_id' }
    );

    return res.status(200).json({ code: promo.code, existing: false });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
