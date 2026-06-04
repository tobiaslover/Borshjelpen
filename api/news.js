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
    // Prøv først med generelle Oslo Børs-nyheter
    const queries = [
      `https://financialmodelingprep.com/api/v3/stock_news?tickers=EQNR.OL,DNB.OL,AKRBP.OL,TEL.OL,MOWI.OL,YAR.OL,NHY.OL&limit=10&apikey=${process.env.FMP_API_KEY}`,
      `https://financialmodelingprep.com/api/v4/general_news?page=0&apikey=${process.env.FMP_API_KEY}`
    ];

    let news = [];

    // Prøv Oslo Børs tickers først
    const r1 = await fetch(queries[0]);
    const d1 = await r1.json();
    if (Array.isArray(d1) && d1.length > 0) {
      news = d1;
    } else {
      // Fallback til generelle finansnyheter
      const r2 = await fetch(queries[1]);
      const d2 = await r2.json();
      if (Array.isArray(d2) && d2.length > 0) {
        news = d2.slice(0, 10);
      }
    }

    if (!news.length) {
      return res.status(200).json({ news: [] });
    }

    const formatted = news.map(item => ({
      title: item.title,
      url: item.url,
      source: item.site || item.publisher || '',
      ticker: item.symbol || null,
      published: item.publishedDate || item.date || '',
      image: item.image || null
    }));

    return res.status(200).json({ news: formatted });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
