import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).end();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Ikke autentisert' });
  }
  const token = authHeader.replace('Bearer ', '');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: { user }, error: authError } = await sb.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Ugyldig token' });

  const apiKey = process.env.FMP_API_KEY;
  
  try {
    // Test 1: generelle nyheter uten ticker-filter
    const url = `https://financialmodelingprep.com/api/v3/stock_news?limit=10&apikey=${apiKey}`;
    console.log('Fetching FMP news:', url.replace(apiKey, 'HIDDEN'));
    
    const r = await fetch(url);
    const text = await r.text();
    console.log('FMP status:', r.status);
    console.log('FMP raw:', text.slice(0, 500));
    
    let d;
    try { d = JSON.parse(text); } catch(e) { d = text; }

    return res.status(200).json({ 
      fmp_status: r.status,
      fmp_data: d,
      has_key: !!apiKey,
      key_prefix: apiKey ? apiKey.slice(0, 8) + '...' : 'MANGLER'
    });
  } catch(e) {
    console.error('News error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
