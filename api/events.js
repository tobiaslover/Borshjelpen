import { createClient } from '@supabase/supabase-js';

const OBX_TICKERS = new Set([
  'EQNR','VAR','DNB','NHY','FRO','AKRBP','NAS','KOG','MOWI','ORK',
  'YAR','TEL','VEND','PROT','SUBC','SALM','KMAR','STB','NOD','DOFG',
  'GJF','TOM','WAWI','BWLPG','HAUTO','BAKKA'
]);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).end();

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const apiKey = process.env.FMP_API_KEY;
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Sjekk cache — kun bruk hvis den er fra i dag eller nyere
  try {
    const { data: cached } = await sb
      .from('events_cache')
      .select('events, updated_at')
      .eq('id', 'obx')
      .maybeSingle();
    if (cached?.events?.length > 0) {
      const cacheDate = new Date(cached.updated_at).toISOString().slice(0, 10);
      if (cacheDate === today) {
        return res.status(200).json({ events: cached.events, cached: true });
      }
    }
  } catch(e) {}

  try {
    // ETT kall for dividends + ETT for earnings på OSE-børsen
    const [divRes, earnRes] = await Promise.all([
      fetch(`https://financialmodelingprep.com/stable/dividends-calendar?from=${today}&to=${future}&apikey=${apiKey}`),
      fetch(`https://financialmodelingprep.com/stable/earning-calendar?from=${today}&to=${future}&exchange=OSL&apikey=${apiKey}`),
    ]);

    console.log('div:', divRes.status, 'earn:', earnRes.status);

    let events = [];

    // Parse dividends
    if (divRes.ok) {
      const data = await divRes.json();
      if (Array.isArray(data)) {
        data.forEach(d => {
          const raw = (d.symbol || '').toUpperCase();
          const ticker = raw.replace('.OL','').replace(':OSE','');
          if (OBX_TICKERS.has(ticker) || OBX_TICKERS.has(raw)) {
            const date = d.date || d.paymentDate || d.recordDate;
            if (date && date >= today) {
              events.push({ date, ticker, name: d.name || ticker, type: 'utbytte', label: 'Utbyttedato', amount: d.dividend ? parseFloat(d.dividend).toFixed(2) : null });
            }
          }
        });
      }
      console.log('div events funnet:', events.filter(e=>e.type==='utbytte').length);
    }

    // Parse earnings
    if (earnRes.ok) {
      const data = await earnRes.json();
      console.log('earn count:', Array.isArray(data) ? data.length : typeof data, Array.isArray(data) ? JSON.stringify(data[0]).slice(0,100) : '');
      if (Array.isArray(data)) {
        data.forEach(e => {
          const raw = (e.symbol || '').toUpperCase();
          const ticker = raw.replace('.OL','').replace(':OSE','');
          if (OBX_TICKERS.has(ticker) || OBX_TICKERS.has(raw)) {
            if (e.date && e.date >= today) {
              events.push({ date: e.date, ticker, name: e.name || ticker, type: 'rapport', label: 'Kvartalsrapport' });
            }
          }
        });
      }
      console.log('rapport events funnet:', events.filter(e=>e.type==='rapport').length);
    }

    events.sort((a, b) => new Date(a.date) - new Date(b.date));
    console.log('total:', events.length);

    // Lagre cache
    try {
      await sb.from('events_cache').upsert({ id: 'obx', events, updated_at: new Date().toISOString() });
    } catch(e) { console.error('cache err:', e.message); }

    return res.status(200).json({ events, cached: false });
  } catch(e) {
    console.error('error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
