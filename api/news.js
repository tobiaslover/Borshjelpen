import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
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

  // Norske Oslo Børs tickers
  const norwegianTickers = 'EQNR,DNB,AKRBP,TEL,MOWI,YAR,NHY,ORK,SALM,SUBC';

  const endpoints = [
    `https://financialmodelingprep.com/stable/news/stock?symbols=${norwegianTickers}&limit=10&apikey=${apiKey}`,
    `https://financialmodelingprep.com/stable/news/stock?limit=20&apikey=${apiKey}`,
  ];

  for (const url of endpoints) {
    try {
      const r = await fetch(url);
      if (r.status !== 200) continue;
      const text = await r.text();
      let d;
      try { d = JSON.parse(text); } catch(e) { continue; }
      if (!Array.isArray(d) || !d.length) continue;

      // Hvis andre endpoint (generell), filtrer på norske tickers
      const norske = ['EQNR','DNB','AKRBP','TEL','MOWI','YAR','NHY','ORK','SALM','SUBC'];
      let filtered = d.filter(item => norske.includes(item.symbol));
      if (!filtered.length) filtered = d; // Fallback til alt hvis ingen norske

      const news = filtered.slice(0, 10).map(item => ({
        title: item.title,
        url: item.url,
        source: item.site || '',
        ticker: item.symbol || null,
        published: item.publishedDate || item.date || '',
      }));

      return res.status(200).json({ news });
    } catch(e) {
      continue;
    }
  }

  return res.status(200).json({ news: [] });
}
