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
// Finn bruker på e-post — paginerer gjennom alle sider, ikke bare den første.
// (sb.auth.admin.listUsers() returnerer som standard kun ~50 brukere.)
async function findUserByEmail(sb, email) {
  const target = (email || '').toLowerCase().trim();
  if (!target) return null;
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage });
    const users = (data && data.users) || [];
    if (error || users.length === 0) return null;
    const found = users.find(u => (u.email || '').toLowerCase() === target);
    if (found) return found;
    if (users.length < perPage) return null; // siste side
    page++;
  }
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
    const plan = session.metadata?.plan;
    let user = null;
    // 1) Foretrekk client_reference_id (vår egen user_id) — skalerer og er entydig.
    //    Send den med fra checkout.js (client_reference_id: user.id) for best resultat.
    if (session.client_reference_id) {
      try {
        const r = await sb.auth.admin.getUserById(session.client_reference_id);
        user = (r && r.data && r.data.user) || null;
      } catch (e) {}
    }
    // 2) Fallback: match på e-post (customer_email er ikke alltid satt — sjekk også customer_details).
    if (!user) {
      const email = session.customer_email || session.customer_details?.email;
      user = await findUserByEmail(sb, email);
    }
    if (user && plan) {
      await sb.from('user_plans').upsert({
        user_id: user.id,
        plan: plan,
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription,
        cancel_at: null, // nytt/fornyet abonnement — fjern evt. tidligere avslutningsdato
        updated_at: new Date().toISOString()
      });
    }
  }
  if (event.type === 'customer.subscription.deleted') {
    const customerId = session.customer;
    const { data } = await sb.from('user_plans').select('user_id').eq('stripe_customer_id', customerId).maybeSingle();
    if (data) {
      await sb.from('user_plans').update({ plan: 'free', cancel_at: null, updated_at: new Date().toISOString() }).eq('user_id', data.user_id);
    }
  }
  res.status(200).json({ received: true });
}
