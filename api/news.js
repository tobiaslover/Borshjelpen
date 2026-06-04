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

  // Prøv nye stabile endepunkter i rekkefølge
  const endpoints = [
    `https://financialmodelingprep.com/stable/news/stock?limit=10&apikey=${apiKey}`,
    `https://financialmodelingprep.com/stable/news/general?limit=10&apikey=${apiKey}`,
    `https://financialmodelingprep.com/api/v3/stock_news?limit=10&apikey=${apiKey}`,
  ];

  for (const url of endpoints) {
    try {
      console.log('Trying:', url.replace(apiKey, 'HIDDEN'));
      const r = await fetch(url);
      const text = await r.text();
      console.log('Status:', r.status, text.slice(0, 200));

      if (r.status !== 200) continue;

      let d;
      try { d = JSON.parse(text); } catch(e) { continue; }
      if (!Array.isArray(d) || !d.length) continue;

      const news = d.slice(0, 10).map(item => ({
        title: item.title,
        url: item.url,
        source: item.site || item.publisher || '',
        ticker: item.symbol || null,
        published: item.publishedDate || item.date || '',
      }));

      return res.status(200).json({ news });
    } catch(e) {
      console.error('Endpoint error:', e.message);
      continue;
    }
  }

  return res.status(200).json({ news: [], error: 'Ingen nyhetsendepunkter fungerte' });
}
