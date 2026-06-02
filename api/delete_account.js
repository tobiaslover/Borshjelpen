import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Kun POST støttes' });

  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id mangler' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    // 1. Hent abonnementsinfo
    const { data: planData } = await sb
      .from('user_plans')
      .select('stripe_subscription_id, stripe_customer_id')
      .eq('user_id', user_id)
      .single();

    // 2. Avbryt Stripe-abonnement umiddelbart hvis det finnes
    if (planData?.stripe_subscription_id) {
      try {
        await stripe.subscriptions.cancel(planData.stripe_subscription_id);
      } catch(e) {
        // Abonnement kan allerede være avsluttet — fortsett
      }
    }

    // 3. Anonymiser aktivitetsdata
    await sb
      .from('user_activity')
      .delete()
      .eq('user_id', user_id);

    // 4. Slett plan-rad
    await sb
      .from('user_plans')
      .delete()
      .eq('user_id', user_id);

    // 5. Slett brukerkonto i Supabase Auth
    await sb.auth.admin.deleteUser(user_id);

    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
