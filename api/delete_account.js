import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  // Verifiser Supabase JWT
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Ikke autentisert' });
  }
  const token = authHeader.replace('Bearer ', '');

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const { data: { user }, error: authError } = await sb.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Ugyldig token' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const { data: planData } = await sb
      .from('user_plans')
      .select('stripe_subscription_id')
      .eq('user_id', user.id)
      .single();

    if (planData?.stripe_subscription_id) {
      try {
        await stripe.subscriptions.cancel(planData.stripe_subscription_id);
      } catch(e) {}
    }

    await sb.from('user_activity').delete().eq('user_id', user.id);
    await sb.from('user_plans').delete().eq('user_id', user.id);
    await sb.auth.admin.deleteUser(user.id);

    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
