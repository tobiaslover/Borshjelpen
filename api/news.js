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
    // v4 endepunkt
    const url = `https://financialmodelingprep.com/api/v4/stock_news_sentiments_rss_feed?page=0&apikey=${apiKey}`;
    console.log('Fetching FMP v4 news');

    const r = await fetch(url);
    const text = await r.text();
    console.log('FMP v4 status:', r.status, text.slice(0, 300));

    let d;
    try { d = JSON.parse(text); } catch(e) { d = []; }

    if (!Array.isArray(d) || !d.length) {
      // Fallback: prøv general_news
      const r2 = await fetch(`https://financialmodelingprep.com/api/v4/general_news?page=0&apikey=${apiKey}`);
      const t2 = await r2.text();
      console.log('FMP general_news status:', r2.status, t2.slice(0, 300));
      try { d = JSON.parse(t2); } catch(e) { d = []; }
    }

    if (!Array.isArray(d) || !d.length) {
      return res.status(200).json({ news: [], debug: 'no data' });
    }

    const news = d.slice(0, 10).map(item => ({
      title: item.title,
      url: item.url,
      source: item.site || item.publisher || '',
      ticker: item.symbol || null,
      published: item.publishedDate || item.date || '',
      sentiment: item.sentiment || null
    }));

    return res.status(200).json({ news });
  } catch(e) {
    console.error('News error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
