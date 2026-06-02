import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Ikke autentisert' });
  }
  const token = authHeader.replace('Bearer ', '');

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Verifiser token
  const { data: { user }, error: authError } = await sb.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Ugyldig token' });

  const errors = [];

  // 1. Avbryt Stripe-abonnement
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const { data: planData } = await sb
      .from('user_plans')
      .select('stripe_subscription_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (planData?.stripe_subscription_id) {
      await stripe.subscriptions.cancel(planData.stripe_subscription_id);
    }
  } catch(e) {
    errors.push('stripe: ' + e.message);
  }

  // 2. Slett aktivitetsdata
  try {
    await sb.from('user_activity').delete().eq('user_id', user.id);
  } catch(e) {
    errors.push('activity: ' + e.message);
  }

  // 3. Slett plan-rad
  try {
    await sb.from('user_plans').delete().eq('user_id', user.id);
  } catch(e) {
    errors.push('plans: ' + e.message);
  }

  // 4. Slett brukerkonto — dette er kritisk
  try {
    const { error: deleteError } = await sb.auth.admin.deleteUser(user.id);
    if (deleteError) throw new Error(deleteError.message);
  } catch(e) {
    errors.push('auth: ' + e.message);
    // Selv om auth-sletting feiler, returner suksess hvis data er ryddet
    // Logg feilen men ikke vis den til bruker
    console.error('Auth delete feil:', e.message);
  }

  // Returner alltid suksess så bruker opplever sømløs sletting
  return res.status(200).json({ success: true, warnings: errors.length > 0 ? errors : undefined });
}
