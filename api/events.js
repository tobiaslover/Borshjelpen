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
    if (cached && cached.events && cached.events.length > 0) {
      const age = Date.now() - new Date(cached.updated_at).getTime();
      if (age < 7 * 24 * 60 * 60 * 1000) {
        return res.status(200).json({ events: cached.events, cached: true });
      }
    }
  } catch(e) {}

  try {
    const today = new Date().toISOString().slice(0, 10);
    const future = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Bygg OBX symbol-sett med alle mulige varianter
    const obxVariants = new Set([
      ...OBX_TICKERS,
      ...OBX_TICKERS.map(t => t + '.OL'),
      ...OBX_TICKERS.map(t => t + ':OSE'),
    ]);

    // Hent earnings per ticker (v3 format) + dividends kalender parallelt
    const earningsSymbols = OBX_TICKERS.map(t => t + '.OL').join(',');
    
    const [earningsRes, dividendsRes] = await Promise.all([
      fetch(`https://financialmodelingprep.com/stable/earnings-surprises?symbol=${OBX_TICKERS[0]}.OL&apikey=${apiKey}`),
      fetch(`https://financialmodelingprep.com/stable/dividends-calendar?from=${today}&to=${future}&apikey=${apiKey}`),
    ]);

    // For earnings — hent for hver ticker individuelt
    const earningsPromises = OBX_TICKERS.map(t =>
      fetch(`https://financialmodelingprep.com/stable/earnings-calendar?symbol=${t}.OL&apikey=${apiKey}`)
        .then(r => r.ok ? r.json() : [])
        .catch(() => [])
    );
    const earningsResults = await Promise.all(earningsPromises);

    let events = [];

    // Parse kvartalsrapporter
    earningsResults.forEach((data, i) => {
      const ticker = OBX_TICKERS[i];
      if (Array.isArray(data)) {
        data.filter(e => e.date && e.date >= today && e.date <= future).forEach(e => {
          events.push({
            date: e.date,
            ticker,
            name: e.name || ticker,
            type: 'rapport',
            label: 'Kvartalsrapport'
          });
        });
      }
    });

    // Parse utbytter
    if (dividendsRes.ok) {
      const divData = await dividendsRes.json();
      if (Array.isArray(divData)) {
        divData.forEach(d => {
          const sym = (d.symbol || '').toUpperCase();
          const ticker = sym.replace('.OL','').replace(':OSE','');
          if (obxVariants.has(sym) || OBX_TICKERS.includes(ticker)) {
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

    console.log('rapport events:', events.filter(e => e.type === 'rapport').length);
    console.log('utbytte events:', events.filter(e => e.type === 'utbytte').length);

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
