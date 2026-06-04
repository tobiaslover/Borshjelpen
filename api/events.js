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
  const today = new Date().toISOString().slice(0, 10);
  const force = req.query.force === '1';

  // Sjekk cache
  if (!force) {
    try {
      const { data: cached } = await sb.from('events_cache').select('events, updated_at').eq('id', 'obx').maybeSingle();
      if (cached?.events?.length > 0) {
        const age = Date.now() - new Date(cached.updated_at).getTime();
        if (age < 7 * 24 * 60 * 60 * 1000) {
          return res.status(200).json({ events: cached.events, cached: true });
        }
      }
    } catch(e) {}
  }

  const yHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
    'Referer': 'https://finance.yahoo.com/',
  };

  try {
    // Hent earnings dates fra Yahoo Finance for alle OBX-tickers parallelt
    const results = await Promise.all(
      OBX_TICKERS.map(t =>
        fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${t}.OL?modules=calendarEvents,summaryDetail`, { headers: yHeaders })
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      )
    );

    let events = [];

    results.forEach((data, i) => {
      const ticker = OBX_TICKERS[i];
      if (!data) return;
      try {
        const result = data?.quoteSummary?.result?.[0];
        const cal = result?.calendarEvents;
        const sd = result?.summaryDetail;

        // Kvartalsrapport-dato
        const earningsDates = cal?.earnings?.earningsDate;
        if (Array.isArray(earningsDates) && earningsDates.length > 0) {
          const raw = earningsDates[0]?.raw;
          if (raw) {
            const date = new Date(raw * 1000).toISOString().slice(0, 10);
            if (date >= today) {
              events.push({ date, ticker, name: ticker, type: 'rapport', label: 'Kvartalsrapport' });
            }
          }
        }

        // Ex-dividend dato
        const exDiv = cal?.exDividendDate?.raw || sd?.exDividendDate?.raw;
        if (exDiv) {
          const date = new Date(exDiv * 1000).toISOString().slice(0, 10);
          if (date >= today) {
            const divAmount = sd?.dividendRate?.raw ? sd.dividendRate.raw.toFixed(2) : null;
            events.push({ date, ticker, name: ticker, type: 'utbytte', label: 'Utbyttedato', amount: divAmount });
          }
        }
      } catch(e) {}
    });

    console.log('rapport:', events.filter(e=>e.type==='rapport').length);
    console.log('utbytte:', events.filter(e=>e.type==='utbytte').length);

    events.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Cache i Supabase
    try {
      await sb.from('events_cache').upsert({ id: 'obx', events, updated_at: new Date().toISOString() });
    } catch(e) {}

    return res.status(200).json({ events, cached: false });
  } catch(e) {
    console.error('events error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
