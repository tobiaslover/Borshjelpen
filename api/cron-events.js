// api/cron-events.js
// UKENTLIG JOBB: henter hele Oslo Bors-universet + kalendere fra FMP en gang,
// bygger ferdig events-liste, og lagrer den i Supabase (market_cache, key='events').
// Kjores av Vercel Cron. /api/events leser deretter bare fra Supabase -> null
// FMP-kall ved vanlige besok.
//
// ENV som trengs i Vercel:
//   FMP_API_KEY (eller FMP_KEY)        - samme som dine andre FMP-ruter
//   SUPABASE_URL                       - prosjektets URL
//   SUPABASE_SERVICE_ROLE_KEY          - service role (KUN server-side, aldri i frontend!)
//   CRON_SECRET                        - valgfri, men anbefalt (beskytter ruta)

import { createClient } from '@supabase/supabase-js';

const FMP_KEY = process.env.FMP_API_KEY || process.env.FMP_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

const HORIZON_DAYS = 90; // FMP-kalenderne tillater maks ~3 mnd
const ymd = (d) => d.toISOString().slice(0, 10);

async function fmpGet(url) {
  try {
    const r = await fetch(url);
    let b = null; try { b = await r.json(); } catch (e) {}
    return { status: r.status, body: b };
  } catch (e) { return { status: 0, body: null, err: String(e) }; }
}

// Prov stable, sa v3. Returner array (tom ved feil).
async function getCalendar(stableUrl, v3Url) {
  const s = await fmpGet(stableUrl);
  if (Array.isArray(s.body)) return s.body;
  const v = await fmpGet(v3Url);
  if (Array.isArray(v.body)) return v.body;
  return [];
}

export default async function handler(req, res) {
  // --- Auth: Vercel Cron sender "Authorization: Bearer <CRON_SECRET>".
  //     Tillat ogsa manuell trigger via ?key=<CRON_SECRET>.
  const auth = req.headers['authorization'] || '';
  const keyParam = req.query && req.query.key;
  if (CRON_SECRET && auth !== 'Bearer ' + CRON_SECRET && keyParam !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!FMP_KEY || !SUPABASE_URL || !SERVICE_ROLE) {
    return res.status(500).json({
      error: 'Mangler env-variabler',
      have: { FMP: !!FMP_KEY, SUPABASE_URL: !!SUPABASE_URL, SERVICE_ROLE: !!SERVICE_ROLE },
    });
  }

  const today = new Date();
  const from = ymd(today);
  const to = ymd(new Date(today.getTime() + HORIZON_DAYS * 86400000));

  // 1) Hele aksjelista -> navnekart for alle .OL-symboler (1 kall)
  let listRaw = await fmpGet('https://financialmodelingprep.com/stable/company-symbols-list?apikey=' + FMP_KEY);
  let list = Array.isArray(listRaw.body) ? listRaw.body : null;
  if (!list) {
    const v = await fmpGet('https://financialmodelingprep.com/api/v3/stock/list?apikey=' + FMP_KEY);
    list = Array.isArray(v.body) ? v.body : [];
  }
  const nameMap = {};
  list.forEach((it) => {
    if (!it || !it.symbol || !it.symbol.endsWith('.OL')) return;
    nameMap[it.symbol] = it.name || it.companyName || it.symbol.replace('.OL', '');
  });

  // 2) Kalendere (2 kall)
  const div = await getCalendar(
    'https://financialmodelingprep.com/stable/dividends-calendar?from=' + from + '&to=' + to + '&apikey=' + FMP_KEY,
    'https://financialmodelingprep.com/api/v3/stock_dividend_calendar?from=' + from + '&to=' + to + '&apikey=' + FMP_KEY
  );
  const earn = await getCalendar(
    'https://financialmodelingprep.com/stable/earnings-calendar?from=' + from + '&to=' + to + '&apikey=' + FMP_KEY,
    'https://financialmodelingprep.com/api/v3/earning_calendar?from=' + from + '&to=' + to + '&apikey=' + FMP_KEY
  );

  const nameOf = (s) => nameMap[s] || s.replace('.OL', '');
  const strip = (s) => s.replace('.OL', '');
  let events = [];

  // Utbytte: ALLE .OL-aksjer (ikke lenger begrenset til OBX)
  div.forEach((d) => {
    if (!d || !d.symbol || !d.symbol.endsWith('.OL') || !d.date || d.date < from) return;
    const amt = d.dividend != null ? Number(d.dividend) : (d.adjDividend != null ? Number(d.adjDividend) : null);
    events.push({
      date: d.date, ticker: strip(d.symbol), name: nameOf(d.symbol), type: 'utbytte',
      amount: amt != null && !isNaN(amt) ? amt.toFixed(2) : undefined,
    });
  });

  // Rapporter: ALLE .OL-aksjer
  const seen = new Set();
  earn.forEach((e) => {
    if (!e || !e.symbol || !e.symbol.endsWith('.OL') || !e.date || e.date < from) return;
    const k = e.symbol + '|' + e.date;
    if (seen.has(k)) return; seen.add(k);
    events.push({ date: e.date, ticker: strip(e.symbol), name: nameOf(e.symbol), type: 'rapport', estimated: true });
  });

  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // 3) Lagre i Supabase
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const generatedAt = new Date().toISOString();
  const { error } = await sb.from('market_cache').upsert(
    { key: 'events', data: { events, generatedAt }, updated_at: generatedAt },
    { onConflict: 'key' }
  );
  if (error) return res.status(500).json({ error: 'Supabase upsert feilet', detail: error.message });

  return res.status(200).json({
    ok: true,
    osloStocksKnown: Object.keys(nameMap).length,
    dividendsRaw: div.length,
    earningsRaw: earn.length,
    events: events.length,
    generatedAt,
  });
}
