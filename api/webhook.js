import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).json({ error: 'Webhook feil: ' + err.message });
  }

  const session = event.data.object;

  if (event.type === 'checkout.session.completed') {
    const email = session.customer_email;
    const plan = session.metadata?.plan;
    if (email && plan) {
      // Finn bruker i Supabase og oppdater plan
      const { data: users } = await sb.auth.admin.listUsers();
      const user = (users?.users || []).find(u => u.email === email);
      if (user) {
        await sb.from('user_plans').upsert({
          user_id: user.id,
          plan: plan,
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          updated_at: new Date().toISOString()
        });
      }
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const customerId = session.customer;
    const { data } = await sb.from('user_plans').select('user_id').eq('stripe_customer_id', customerId).single();
    if (data) {
      await sb.from('user_plans').update({ plan: 'free', updated_at: new Date().toISOString() }).eq('user_id', data.user_id);
    }
  }

  res.status(200).json({ received: true });
}
