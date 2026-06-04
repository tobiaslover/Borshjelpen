import { createClient } from '@supabase/supabase-js';

const OBX_TICKERS = [
  'EQNR','VAR','DNB','NHY','FRO','AKRBP','NAS','KOG','MOWI','ORK',
  'YAR','TEL','VEND','PROT','SUBC','SALM','KMAR','STB','NOD','DOFG',
  'GJF','TOM','WAWI','BWLPG','HAUTO','BAKKA'
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).end();

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const apiKey = process.env.FMP_API_KEY;

  // Sjekk cache i Supabase (oppdater maks 1 gang per uke)
  try {
    const { data: cached } = await sb
      .from('events_cache')
      .select('events, updated_at')
      .eq('id', 'obx')
      .maybeSingle();

    if (cached && cached.events) {
      const age = Date.now() - new Date(cached.updated_at).getTime();
      const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
      if (age < ONE_WEEK) {
        return res.status(200).json({ events: cached.events, cached: true });
      }
    }
  } catch(e) {}

  try {
    const today = new Date().toISOString().slice(0, 10);
    const future = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const symbols = OBX_TICKERS.map(t => t + '.OL').join(',');

    const [earningsRes, dividendRes] = await Promise.all([
      fetch(`https://financialmodelingprep.com/stable/earning-calendar?symbols=${symbols}&from=${today}&to=${future}&apikey=${apiKey}`),
      fetch(`https://financialmodelingprep.com/stable/dividends-calendar?from=${today}&to=${future}&apikey=${apiKey}`),
    ]);

    let events = [];

    console.log('earnings status:', earningsRes.status);
    console.log('dividend status:', dividendRes.status);
    if (earningsRes.ok) {
      const earningsData = await earningsRes.json();
      console.log('earnings raw:', JSON.stringify(earningsData).slice(0, 200));
      if (Array.isArray(earningsData)) {
        earningsData.forEach(e => {
          const ticker = (e.symbol || '').replace('.OL', '');
          if (OBX_TICKERS.includes(ticker)) {
            events.push({
              date: e.date,
              ticker,
              name: e.name || ticker,
              type: 'rapport',
              label: 'Kvartalsrapport'
            });
          }
        });
      }
    }

    if (dividendRes.ok) {
      const dividendData = await dividendRes.json();
      if (Array.isArray(dividendData)) {
        dividendData.forEach(d => {
          const ticker = (d.symbol || '').replace('.OL', '');
          if (OBX_TICKERS.includes(ticker)) {
            events.push({
              date: d.date || d.paymentDate,
              ticker,
              name: d.name || ticker,
              type: 'utbytte',
              label: 'Utbyttedato',
              amount: d.dividend ? parseFloat(d.dividend).toFixed(2) : null
            });
          }
        });
      }
    }

    // Sorter på dato
    events.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Lagre i Supabase cache
    try {
      await sb.from('events_cache').upsert({ id: 'obx', events, updated_at: new Date().toISOString() });
    } catch(e) { console.error('Cache error:', e.message); }

    return res.status(200).json({ events, cached: false });
  } catch(e) {
    console.error('events error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
