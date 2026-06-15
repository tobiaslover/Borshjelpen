// api/cron-events.js
// UKENTLIG JOBB. Henter:
//   1) Hele Oslo Bors-universet (.OL) med navn        -> 1 kall
//   2) Utbytte PER TICKER for alle .OL-aksjer         -> ~350 kall (fanger smaaksjer
//      som bulk-kalenderen hopper over, f.eks. MPCC)
//   3) Kvartalsrapporter fra bulk earnings-calendar   -> 1 kall (den er komplett nok)
// Bygger ferdig events-liste og lagrer i Supabase (market_cache, key='events').
// ~350 FMP-kall i uka er trivielt; daglige plangrenser er langt hoyere.
//
// ENV i Vercel: FMP_API_KEY (el. FMP_KEY), SUPABASE_URL,
//               SUPABASE_SERVICE_ROLE_KEY (kun server-side!), CRON_SECRET

import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 60 }; // Pro-plan anbefales for per-ticker-henting

const FMP_KEY = process.env.FMP_API_KEY || process.env.FMP_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

const HORIZON_DAYS = 90;
const CONCURRENCY = 12;       // antall samtidige FMP-kall
const ymd = (d) => d.toISOString().slice(0, 10);

async function fmpGet(url) {
  try {
    const r = await fetch(url);
    let b = null; try { b = await r.json(); } catch (e) {}
    return { status: r.status, body: b };
  } catch (e) { return { status: 0, body: null, err: String(e) }; }
}

// Enkel samtidighets-pool: kjorer fn over items, maks `size` om gangen.
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

// Utbytte for ett symbol (stable -> v3 fallback). Returnerer array av {date,dividend,...}
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
    return res.status(500).json({ error: 'Mangler env-variabler', have: { FMP: !!FMP_KEY, SUPABASE_URL: !!SUPABASE_URL, SERVICE_ROLE: !!SERVICE_ROLE } });
  }

  const today = new Date();
  const from = ymd(today);
  const to = ymd(new Date(today.getTime() + HORIZON_DAYS * 86400000));

  // 1) Hele aksjelista -> .OL-symboler + navnekart
  let listRaw = await fmpGet('https://financialmodelingprep.com/stable/company-symbols-list?apikey=' + FMP_KEY);
  let list = Array.isArray(listRaw.body) ? listRaw.body : null;
  if (!list) {
    const v = await fmpGet('https://financialmodelingprep.com/api/v3/stock/list?apikey=' + FMP_KEY);
    list = Array.isArray(v.body) ? v.body : [];
  }
  const nameMap = {};
  const olSymbols = [];
  list.forEach((it) => {
    if (!it || !it.symbol || !it.symbol.endsWith('.OL')) return;
    nameMap[it.symbol] = it.name || it.companyName || it.symbol.replace('.OL', '');
    olSymbols.push(it.symbol);
  });

  const nameOf = (s) => nameMap[s] || s.replace('.OL', '');
  const strip = (s) => s.replace('.OL', '');
  let events = [];

  // 2) Utbytte PER TICKER (samtidig, i pool)
  const divResults = await mapPool(olSymbols, CONCURRENCY, async (sym) => {
    const rows = await dividendsForSymbol(sym);
    return { sym, rows };
  });
  divResults.forEach((r) => {
    if (!r || !Array.isArray(r.rows)) return;
    r.rows.forEach((d) => {
      const exDate = d && d.date; // ex-dato
      if (!exDate || exDate < from || exDate > to) return;
      const amt = d.dividend != null ? Number(d.dividend) : (d.adjDividend != null ? Number(d.adjDividend) : null);
      events.push({
        date: exDate, ticker: strip(r.sym), name: nameOf(r.sym), type: 'utbytte',
        amount: amt != null && !isNaN(amt) ? amt.toFixed(2) : undefined,
      });
    });
  });
  // Dedup utbytte (samme ticker + dato)
  const divSeen = new Set();
  events = events.filter((e) => {
    const k = e.ticker + '|' + e.date + '|u';
    if (divSeen.has(k)) return false; divSeen.add(k); return true;
  });

  // 3) Kvartalsrapporter fra bulk earnings-calendar (stable -> v3)
  let earn = await fmpGet('https://financialmodelingprep.com/stable/earnings-calendar?from=' + from + '&to=' + to + '&apikey=' + FMP_KEY);
  let earnRows = Array.isArray(earn.body) ? earn.body : null;
  if (!earnRows) {
    const v = await fmpGet('https://financialmodelingprep.com/api/v3/earning_calendar?from=' + from + '&to=' + to + '&apikey=' + FMP_KEY);
    earnRows = Array.isArray(v.body) ? v.body : [];
  }
  const earnSeen = new Set();
  earnRows.forEach((e) => {
    if (!e || !e.symbol || !e.symbol.endsWith('.OL') || !e.date || e.date < from || e.date > to) return;
    const k = e.symbol + '|' + e.date;
    if (earnSeen.has(k)) return; earnSeen.add(k);
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
  if (error) return res.status(500).json({ error: 'Supabase upsert feilet', detail: error.message });

  return res.status(200).json({
    ok: true,
    osloStocks: olSymbols.length,
    dividendEvents: events.filter((e) => e.type === 'utbytte').length,
    reportEvents: events.filter((e) => e.type === 'rapport').length,
    totalEvents: events.length,
    generatedAt,
  });
}
