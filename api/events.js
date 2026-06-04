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

  // Sjekk Supabase cache (1 uke)
  try {
    const { data: cached } = await sb
      .from('events_cache')
      .select('events, updated_at')
      .eq('id', 'obx')
      .maybeSingle();
    if (cached && cached.events) {
      const age = Date.now() - new Date(cached.updated_at).getTime();
      if (age < 7 * 24 * 60 * 60 * 1000) {
        return res.status(200).json({ events: cached.events, cached: true });
      }
    }
  } catch(e) {}

  try {
    const today = new Date().toISOString().slice(0, 10);
    const future = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Hent kvartalsrapporter og utbytter parallelt for alle OBX-tickers
    const [earningsRes, dividendsRes] = await Promise.all([
      // Earning calendar — hent alle, filtrer på OBX
      fetch(`https://financialmodelingprep.com/stable/earning-calendar?from=${today}&to=${future}&apikey=${apiKey}`),
      // Dividends calendar — hent alle, filtrer på OBX
      fetch(`https://financialmodelingprep.com/stable/dividends-calendar?from=${today}&to=${future}&apikey=${apiKey}`),
    ]);

    console.log('earnings status:', earningsRes.status);
    console.log('dividends status:', dividendsRes.status);

    let events = [];
    const obxSet = new Set(OBX_TICKERS.map(t => t + '.OL'));
    const obxSetPlain = new Set(OBX_TICKERS);

    if (earningsRes.ok) {
      const data = await earningsRes.json();
      console.log('earnings count:', Array.isArray(data) ? data.length : 'not array');
      if (Array.isArray(data)) {
        data.forEach(e => {
          const sym = e.symbol || '';
          const ticker = sym.replace('.OL', '');
          if (obxSet.has(sym) || obxSetPlain.has(ticker)) {
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

    if (dividendsRes.ok) {
      const data = await dividendsRes.json();
      console.log('dividends count:', Array.isArray(data) ? data.length : 'not array');
      if (Array.isArray(data)) {
        data.forEach(d => {
          const sym = d.symbol || '';
          const ticker = sym.replace('.OL', '');
          if (obxSet.has(sym) || obxSetPlain.has(ticker)) {
            events.push({
              date: d.date || d.paymentDate || d.recordDate,
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

    console.log('total events:', events.length);

    // Sorter på dato og ta de nærmeste
    events = events
      .filter(e => e.date && e.date >= today)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    // Lagre i cache
    try {
      await sb.from('events_cache').upsert({
        id: 'obx',
        events,
        updated_at: new Date().toISOString()
      });
    } catch(e) { console.error('Cache error:', e.message); }

    return res.status(200).json({ events, cached: false });
  } catch(e) {
    console.error('events error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
