// api/cron-events.js  (codeVersion: v3-multisource)
// UKENTLIG JOBB. Henter:
//   1) Oslo Bors-universet (.OL) med navn - prover FLERE FMP-kilder til en gir treff
//   2) Utbytte PER TICKER for alle .OL-aksjer (fanger smaaksjer som MPCC)
//   3) Kvartalsrapporter fra bulk earnings-calendar
// Lagrer ferdig events-liste i Supabase (market_cache, key='events').
//
// ENV i Vercel: FMP_API_KEY (el. FMP_KEY), SUPABASE_URL,
//               SUPABASE_SERVICE_KEY (el. ..._ROLE_KEY), CRON_SECRET

import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 60 };

const FMP_KEY = process.env.FMP_API_KEY || process.env.FMP_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

const HORIZON_DAYS = 90;
const CONCURRENCY = 12;
const ymd = (d) => d.toISOString().slice(0, 10);

async function fmpGet(url) {
  try {
    const r = await fetch(url);
    let b = null; try { b = await r.json(); } catch (e) {}
    return { status: r.status, body: b };
  } catch (e) { return { status: 0, body: null, err: String(e) }; }
}

async function mapPool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx]); } catch (e) { out[idx] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

// Plukk ut .OL-symboler + navn fra en vilkaarlig liste-respons
function extractOL(arr) {
  const map = {};
  if (!Array.isArray(arr)) return map;
  arr.forEach((it) => {
    if (!it) return;
    const sym = it.symbol || it.ticker;
    if (!sym || typeof sym !== 'string' || !sym.endsWith('.OL')) return;
    map[sym] = it.name || it.companyName || it.securityName || sym.replace('.OL', '');
  });
  return map;
}

// Prov flere kilder til en gir .OL-treff. Returnerer { nameMap, source, probe }
async function getOsloSymbols() {
  const k = '&apikey=' + FMP_KEY;
  const sources = [
    ['exchange-symbols-OSL', 'https://financialmodelingprep.com/stable/available-exchange-symbols?exchange=OSL' + k],
    ['v3-symbol-OSL', 'https://financialmodelingprep.com/api/v3/symbol/OSL?apikey=' + FMP_KEY],
    ['screener-OSL', 'https://financialmodelingprep.com/stable/company-screener?exchange=OSL&limit=3000' + k],
    ['v3-screener-OSE', 'https://financialmodelingprep.com/api/v3/stock-screener?exchange=OSE&limit=3000' + k],
    ['company-symbols-list', 'https://financialmodelingprep.com/stable/company-symbols-list?apikey=' + FMP_KEY],
    ['v3-stock-list', 'https://financialmodelingprep.com/api/v3/stock/list?apikey=' + FMP_KEY],
    ['v3-available-traded', 'https://financialmodelingprep.com/api/v3/available-traded/list?apikey=' + FMP_KEY],
  ];
  const probe = [];
  for (const [name, url] of sources) {
    const r = await fmpGet(url);
    const rawCount = Array.isArray(r.body) ? r.body.length : 0;
    const map = extractOL(r.body);
    const olCount = Object.keys(map).length;
    probe.push({ source: name, status: r.status, rawCount, olCount });
    if (olCount > 0) return { nameMap: map, source: name, probe };
  }
  return { nameMap: {}, source: 'none', probe };
}

async function dividendsForSymbol(sym) {
  const s = await fmpGet('https://financialmodelingprep.com/stable/dividends?symbol=' + sym + '&apikey=' + FMP_KEY);
  if (Array.isArray(s.body)) return s.body;
  const v = await fmpGet('https://financialmodelingprep.com/api/v3/historical-price-full/stock_dividend/' + sym + '?apikey=' + FMP_KEY);
  if (v.body && Array.isArray(v.body.historical)) return v.body.historical;
  return [];
}

export default async function handler(req, res) {
  const auth = req.headers['authorization'] || '';
  const keyParam = req.query && req.query.key;
  if (CRON_SECRET && auth !== 'Bearer ' + CRON_SECRET && keyParam !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!FMP_KEY || !SUPABASE_URL || !SERVICE_ROLE) {
    return res.status(500).json({ error: 'Mangler env-variabler', codeVersion: 'v3-multisource', have: { FMP: !!FMP_KEY, SUPABASE_URL: !!SUPABASE_URL, SERVICE_ROLE: !!SERVICE_ROLE } });
  }

  const today = new Date();
  const from = ymd(today);
  const to = ymd(new Date(today.getTime() + HORIZON_DAYS * 86400000));

  // 1) Oslo-universet (prover flere kilder)
  const { nameMap, source: symbolSource, probe } = await getOsloSymbols();
  const olSymbols = Object.keys(nameMap);
  const nameOf = (s) => nameMap[s] || s.replace('.OL', '');
  const strip = (s) => s.replace('.OL', '');
  let events = [];

  // 2) Utbytte per ticker
  // Merk: For .OL-tickere gir FMP utbyttet allerede konvertert til NOK
  // (borsens noteringsvaluta), ikke selskapets opprinnelige valuta. Beloepet
  // er derfor i NOK selv om selskapet erklaerer i f.eks. USD.
  const divResults = await mapPool(olSymbols, CONCURRENCY, async (sym) => ({ sym, rows: await dividendsForSymbol(sym) }));
  divResults.forEach((r) => {
    if (!r || !Array.isArray(r.rows)) return;
    r.rows.forEach((d) => {
      const exDate = d && d.date;
      if (!exDate || exDate < from || exDate > to) return;
      const amt = d.dividend != null ? Number(d.dividend) : (d.adjDividend != null ? Number(d.adjDividend) : null);
      events.push({ date: exDate, ticker: strip(r.sym), name: nameOf(r.sym), type: 'utbytte', amount: amt != null && !isNaN(amt) ? amt.toFixed(2) : undefined });
    });
  });
  const divSeen = new Set();
  events = events.filter((e) => { const key = e.ticker + '|' + e.date + '|u'; if (divSeen.has(key)) return false; divSeen.add(key); return true; });

  // 3) Rapporter fra bulk earnings-calendar
  let earn = await fmpGet('https://financialmodelingprep.com/stable/earnings-calendar?from=' + from + '&to=' + to + '&apikey=' + FMP_KEY);
  let earnRows = Array.isArray(earn.body) ? earn.body : null;
  if (!earnRows) {
    const v = await fmpGet('https://financialmodelingprep.com/api/v3/earning_calendar?from=' + from + '&to=' + to + '&apikey=' + FMP_KEY);
    earnRows = Array.isArray(v.body) ? v.body : [];
  }
  const earnSeen = new Set();
  earnRows.forEach((e) => {
    if (!e || !e.symbol || !e.symbol.endsWith('.OL') || !e.date || e.date < from || e.date > to) return;
    const key = e.symbol + '|' + e.date;
    if (earnSeen.has(key)) return; earnSeen.add(key);
    events.push({ date: e.date, ticker: strip(e.symbol), name: nameOf(e.symbol), type: 'rapport', estimated: true });
  });

  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // 4) Lagre i Supabase
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const generatedAt = new Date().toISOString();
  const { error } = await sb.from('market_cache').upsert(
    { key: 'events', data: { events, generatedAt }, updated_at: generatedAt },
    { onConflict: 'key' }
  );
  if (error) return res.status(500).json({ error: 'Supabase upsert feilet', detail: error.message, symbolSource, probe });

  return res.status(200).json({
    ok: true,
    codeVersion: 'v3-multisource',
    symbolSource,
    osloStocks: olSymbols.length,
    dividendEvents: events.filter((e) => e.type === 'utbytte').length,
    reportEvents: events.filter((e) => e.type === 'rapport').length,
    totalEvents: events.length,
    probe,
    generatedAt,
  });
}
