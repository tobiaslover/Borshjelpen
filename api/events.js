import { createClient } from '@supabase/supabase-js';

const OBX = [
  {ticker:'EQNR', name:'Equinor'},
  {ticker:'VAR', name:'Vår Energi'},
  {ticker:'DNB', name:'DNB'},
  {ticker:'NHY', name:'Norsk Hydro'},
  {ticker:'FRO', name:'Frontline'},
  {ticker:'AKRBP', name:'Aker BP'},
  {ticker:'NAS', name:'Norwegian'},
  {ticker:'KOG', name:'Kongsberg Gruppen'},
  {ticker:'MOWI', name:'Mowi'},
  {ticker:'ORK', name:'Orkla'},
  {ticker:'YAR', name:'Yara'},
  {ticker:'TEL', name:'Telenor'},
  {ticker:'VEND', name:'Vend'},
  {ticker:'PROT', name:'Protector'},
  {ticker:'SUBC', name:'Subsea 7'},
  {ticker:'SALM', name:'SalMar'},
  {ticker:'KMAR', name:'Kongsberg Maritime'},
  {ticker:'STB', name:'Storebrand'},
  {ticker:'NOD', name:'Nordic Semiconductor'},
  {ticker:'DOFG', name:'DOF Group'},
  {ticker:'GJF', name:'Gjensidige'},
  {ticker:'TOM', name:'Tomra'},
  {ticker:'WAWI', name:'Wallenius Wilhelmsen'},
  {ticker:'BWLPG', name:'BW LPG'},
  {ticker:'HAUTO', name:'Höegh Autoliners'},
  {ticker:'BAKKA', name:'Bakkafrost'},
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).end();

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const today = new Date().toISOString().slice(0, 10);
  const force = req.query.force === '1';

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
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://finance.yahoo.com/',
    'Origin': 'https://finance.yahoo.com',
  };

  try {
    const results = await Promise.all(
      OBX.map(s =>
        fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${s.ticker}.OL?modules=calendarEvents&interval=1d&range=1d`, { headers: yHeaders })
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      )
    );

    let events = [];

    results.forEach((data, i) => {
      const { ticker, name } = OBX[i];
      if (!data) return;
      try {
        const meta = data?.chart?.result?.[0]?.meta;
        
        // Earnings date fra meta
        if (meta?.earningsTimestamp) {
          const date = new Date(meta.earningsTimestamp * 1000).toISOString().slice(0, 10);
          if (date >= today) {
            events.push({ date, ticker, name, type: 'rapport', label: 'Kvartalsrapport' });
          }
        }

        // Ex-dividend fra meta
        if (meta?.exDividendDate) {
          const date = new Date(meta.exDividendDate * 1000).toISOString().slice(0, 10);
          if (date >= today) {
            events.push({ date, ticker, name, type: 'utbytte', label: 'Utbyttedato' });
          }
        }
      } catch(e) {}
    });

    console.log('rapport:', events.filter(e=>e.type==='rapport').length);
    console.log('utbytte:', events.filter(e=>e.type==='utbytte').length);
    console.log('total:', events.length);

    events.sort((a, b) => new Date(a.date) - new Date(b.date));

    try {
      await sb.from('events_cache').upsert({ id: 'obx', events, updated_at: new Date().toISOString() });
    } catch(e) {}

    return res.status(200).json({ events, cached: false });
  } catch(e) {
    console.error('error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
