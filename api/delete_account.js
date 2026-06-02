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

  const { data: { user }, error: authError } = await sb.auth.getUser(token);
  if (authError || !user) {
    console.error('Auth getUser feil:', authError?.message);
    return res.status(401).json({ error: 'Ugyldig token' });
  }

  console.log('Sletter bruker:', user.id, user.email);

  // 1. Avbryt Stripe
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const { data: planData } = await sb.from('user_plans').select('stripe_subscription_id').eq('user_id', user.id).maybeSingle();
    if (planData?.stripe_subscription_id) {
      await stripe.subscriptions.cancel(planData.stripe_subscription_id);
      console.log('Stripe avsluttet');
    }
  } catch(e) { console.error('Stripe feil:', e.message); }

  // 2. Slett aktivitetsdata
  try {
    await sb.from('user_activity').delete().eq('user_id', user.id);
    console.log('Aktivitet slettet');
  } catch(e) { console.error('Activity feil:', e.message); }

  // 3. Slett plan
  try {
    await sb.from('user_plans').delete().eq('user_id', user.id);
    console.log('Plan slettet');
  } catch(e) { console.error('Plans feil:', e.message); }

  // 4. Slett bruker via admin
  try {
    const { error: deleteError } = await sb.auth.admin.deleteUser(user.id);
    if (deleteError) {
      console.error('Admin deleteUser feil:', deleteError.message, deleteError.status);
    } else {
      console.log('Bruker slettet fra auth');
    }
  } catch(e) { console.error('DeleteUser exception:', e.message); }

  return res.status(200).json({ success: true });
}
