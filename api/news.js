import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  if (req.method !== 'GET') return res.status(405).end();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Ikke autentisert' });
  }
  const token = authHeader.replace('Bearer ', '');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: { user }, error: authError } = await sb.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Ugyldig token' });

  try {
    const url = `https://financialmodelingprep.com/api/v3/stock_news?tickers=EQNR.OL&limit=5&apikey=${process.env.FMP_API_KEY}`;
    const r = await fetch(url);
    const d = await r.json();

    // Returner rådata for debugging
    return res.status(200).json({ 
      debug: true,
      status: r.status,
      url: url.replace(process.env.FMP_API_KEY, 'HIDDEN'),
      data: d
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
