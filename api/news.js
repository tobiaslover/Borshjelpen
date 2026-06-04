import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  if (req.method !== 'GET') return res.status(405).end();

  // Verifiser JWT
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Ikke autentisert' });
  }
  const token = authHeader.replace('Bearer ', '');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: { user }, error: authError } = await sb.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Ugyldig token' });

  try {
    const tickers = 'EQNR,DNB,AKRBP,TEL,MOWI,YAR,NHY,KAHOT';
    const url = `https://financialmodelingprep.com/api/v3/stock_news?tickers=${tickers}&limit=10&apikey=${process.env.FMP_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok || !Array.isArray(data)) {
      return res.status(500).json({ error: 'Kunne ikke hente nyheter' });
    }

    // Filtrer og formater
    const news = data.map(item => ({
      title: item.title,
      url: item.url,
      source: item.site,
      ticker: item.symbol,
      published: item.publishedDate,
      image: item.image || null
    }));

    return res.status(200).json({ news });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
