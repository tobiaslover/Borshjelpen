// api/events.js
// Leser ferdigbygd events-liste fra Supabase (fylt av api/cron-events.js ukentlig).
// Gjor INGEN FMP-kall ved vanlige besok. Filtrerer bort passerte datoer ved lesing,
// sa lista holder seg fersk daglig selv om dataene oppdateres ukentlig.
//
// Frontend-kontrakt (oversikt.html -> loadEvents) uendret:
//   { events: [ { date, ticker, name, type:'utbytte'|'rapport', amount?, estimated? } ], cached }
//
// Cold-start fallback: hvis cachen er tom (for forste cron-kjoring), hentes
// kalenderne direkte fra FMP denne ene gangen sa siden aldri star tom.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FMP_KEY = process.env.FMP_API_KEY || process.env.FMP_KEY;

const HORIZON_DAYS = 90;
const ymd = (d) => d.toISOString().slice(0, 10);

async function fmpGet(url) {
  try {
    const r = await fetch(url);
    let b = null; try { b = await r.json(); } catch (e) {}
    return Array.isArray(b) ? b : [];
  } catch (e) { return []; }
}
async function getCalendar(stableUrl, v3Url) {
  const s = await fmpGet(stableUrl);
  if (s.length) return s;
  return fmpGet(v3Url);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  if (req.method !== 'GET') return res.status(405).end();

  const today = ymd(new Date());
  let events = [];
  let generatedAt = null;
  let source = 'cache';

  // 1) Les fra Supabase-cache
  try {
    if (SUPABASE_URL && SERVICE_ROLE) {
      const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
      const { data } = await sb.from('market_cache').select('data, updated_at').eq('key', 'events').maybeSingle();
      if (data && data.data && Array.isArray(data.data.events)) {
        events = data.data.events;
        generatedAt = data.data.generatedAt || data.updated_at;
      }
    }
  } catch (e) {}

  // 2) Cold-start fallback: hent direkte hvis cachen er tom
  if (!events.length && FMP_KEY) {
    source = 'live-fallback';
    const from = today;
    const to = ymd(new Date(Date.now() + HORIZON_DAYS * 86400000));
    const div = await getCalendar(
      'https://financialmodelingprep.com/stable/dividends-calendar?from=' + from + '&to=' + to + '&apikey=' + FMP_KEY,
      'https://financialmodelingprep.com/api/v3/stock_dividend_calendar?from=' + from + '&to=' + to + '&apikey=' + FMP_KEY
    );
    const earn = await getCalendar(
      'https://financialmodelingprep.com/stable/earnings-calendar?from=' + from + '&to=' + to + '&apikey=' + FMP_KEY,
      'https://financialmodelingprep.com/api/v3/earning_calendar?from=' + from + '&to=' + to + '&apikey=' + FMP_KEY
    );
    const strip = (s) => s.replace('.OL', '');
    div.forEach((d) => {
      if (!d || !d.symbol || !d.symbol.endsWith('.OL') || !d.date) return;
      const amt = d.dividend != null ? Number(d.dividend) : (d.adjDividend != null ? Number(d.adjDividend) : null);
      events.push({ date: d.date, ticker: strip(d.symbol), name: strip(d.symbol), type: 'utbytte', amount: amt != null && !isNaN(amt) ? amt.toFixed(2) : undefined });
    });
    const seen = new Set();
    earn.forEach((e) => {
      if (!e || !e.symbol || !e.symbol.endsWith('.OL') || !e.date) return;
      const k = e.symbol + '|' + e.date; if (seen.has(k)) return; seen.add(k);
      events.push({ date: e.date, ticker: strip(e.symbol), name: strip(e.symbol), type: 'rapport', estimated: true });
    });
  }

  // 3) Filtrer bort passerte, sorter kronologisk
  events = events
    .filter((e) => e && e.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).json({ events, cached: true, source, generatedAt });
}
