// api/events.js
// Kommende ex-utbyttedatoer + kvartalsrapport-datoer for OBX-aksjer, live fra FMP.
//
// Frontend-kontrakt (oversikt.html → loadEvents) uendret:
//   { events: [ { date, ticker, name, type:'utbytte'|'rapport', amount?, estimated? } ], cached }
//
// FMP har lagt om API-et: de gamle v3-kalenderrutene er "legacy", de nye heter
// /stable/dividends-calendar og /stable/earnings-calendar. Denne ruta prøver
// stable først og faller tilbake til v3.
//
// FEILSØKING: åpne /api/events?debug=1 i nettleseren. Da ser du HTTP-status fra
// FMP, om svaret var en liste, hvor mange treff totalt, og hvor mange .OL-treff.
// Det forteller umiddelbart om problemet er (a) nøkkel, (b) plan, eller
// (c) at FMP-kalenderen ikke dekker Oslo Børs.

const FMP_KEY = process.env.FMP_API_KEY || process.env.FMP_KEY;
const KEY_SOURCE = process.env.FMP_API_KEY ? 'FMP_API_KEY' : (process.env.FMP_KEY ? 'FMP_KEY' : 'INGEN');

// OBX-tickere: FMP-symbol (.OL) -> visningsnavn. Hold i sync med movers.js.
const OBX = {
  'EQNR.OL': 'Equinor', 'DNB.OL': 'DNB', 'TEL.OL': 'Telenor', 'AKRBP.OL': 'Aker BP',
  'NHY.OL': 'Norsk Hydro', 'YAR.OL': 'Yara', 'MOWI.OL': 'Mowi', 'ORK.OL': 'Orkla',
  'KOG.OL': 'Kongsberg Gruppen', 'SUBC.OL': 'Subsea 7', 'SALM.OL': 'SalMar',
  'GJF.OL': 'Gjensidige', 'STB.OL': 'Storebrand', 'TOM.OL': 'Tomra',
  'NOD.OL': 'Nordic Semiconductor', 'AKSO.OL': 'Aker Solutions', 'FRO.OL': 'Frontline',
  'BWLPG.OL': 'BW LPG', 'SCATC.OL': 'Scatec', 'ELK.OL': 'Elkem', 'AUTO.OL': 'AutoStore',
  'LSG.OL': 'Leroy Seafood', 'VAR.OL': 'Var Energi', 'AKER.OL': 'Aker', 'GOGL.OL': 'Golden Ocean',
};

const HORIZON_DAYS = 90; // FMP-kalenderne tillater maks ~3 mnd vindu
const ymd = (d) => d.toISOString().slice(0, 10);

async function fmpGet(url) {
  try {
    const r = await fetch(url);
    let body = null;
    try { body = await r.json(); } catch (e) {}
    return { ok: r.ok, status: r.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: null, err: String(e) };
  }
}

// Returnerer { rows:[], info:{} } - prover stable, sa v3.
async function getCalendar(stableUrl, v3Url) {
  let res = await fmpGet(stableUrl);
  let used = 'stable';
  if (!Array.isArray(res.body)) {
    const v3 = await fmpGet(v3Url);
    if (Array.isArray(v3.body)) { res = v3; used = 'v3'; }
    else {
      return { rows: [], info: { used: 'none', status: res.status, sample: res.body, v3status: v3.status, v3sample: v3.body } };
    }
  }
  return { rows: res.body, info: { used, status: res.status, total: res.body.length } };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  if (req.method !== 'GET') return res.status(405).end();

  const debug = req.query && (req.query.debug === '1' || req.query.debug === 'true');

  if (!FMP_KEY) {
    return res.status(200).json({ events: [], cached: false, error: 'FMP-nokkel mangler', keySource: KEY_SOURCE });
  }

  const today = new Date();
  const from = ymd(today);
  const to = ymd(new Date(today.getTime() + HORIZON_DAYS * 86400000));
  const symbolSet = new Set(Object.keys(OBX));
  const display = (s) => OBX[s] || s.replace('.OL', '');
  const strip = (s) => s.replace('.OL', '');

  const divStable = `https://financialmodelingprep.com/stable/dividends-calendar?from=${from}&to=${to}&apikey=${FMP_KEY}`;
  const divV3 = `https://financialmodelingprep.com/api/v3/stock_dividend_calendar?from=${from}&to=${to}&apikey=${FMP_KEY}`;
  const earnStable = `https://financialmodelingprep.com/stable/earnings-calendar?from=${from}&to=${to}&apikey=${FMP_KEY}`;
  const earnV3 = `https://financialmodelingprep.com/api/v3/earning_calendar?from=${from}&to=${to}&apikey=${FMP_KEY}`;

  const [divCal, earnCal] = await Promise.all([
    getCalendar(divStable, divV3),
    getCalendar(earnStable, earnV3),
  ]);

  const olDiv = divCal.rows.filter((d) => d && d.symbol && d.symbol.endsWith('.OL'));
  const olEarn = earnCal.rows.filter((e) => e && e.symbol && e.symbol.endsWith('.OL'));

  let events = [];

  divCal.rows.forEach((d) => {
    if (!d || !d.symbol || !symbolSet.has(d.symbol) || !d.date || d.date < from) return;
    const amt = d.dividend != null ? Number(d.dividend) : (d.adjDividend != null ? Number(d.adjDividend) : null);
    events.push({
      date: d.date, ticker: strip(d.symbol), name: display(d.symbol), type: 'utbytte',
      amount: amt != null && !isNaN(amt) ? amt.toFixed(2) : undefined,
    });
  });

  const seen = new Set();
  earnCal.rows.forEach((e) => {
    if (!e || !e.symbol || !symbolSet.has(e.symbol) || !e.date || e.date < from) return;
    const k = e.symbol + '|' + e.date;
    if (seen.has(k)) return; seen.add(k);
    events.push({ date: e.date, ticker: strip(e.symbol), name: display(e.symbol), type: 'rapport', estimated: true });
  });

  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (debug) {
    return res.status(200).json({
      keySource: KEY_SOURCE,
      window: { from, to },
      dividends: {
        endpointUsed: divCal.info.used, httpStatus: divCal.info.status,
        totalReturned: divCal.info.total != null ? divCal.info.total : 0,
        osloOLcount: olDiv.length,
        osloOLsamples: olDiv.slice(0, 5).map((d) => ({ symbol: d.symbol, date: d.date, dividend: d.dividend })),
        errorSample: divCal.info.used === 'none' ? divCal.info : undefined,
      },
      earnings: {
        endpointUsed: earnCal.info.used, httpStatus: earnCal.info.status,
        totalReturned: earnCal.info.total != null ? earnCal.info.total : 0,
        osloOLcount: olEarn.length,
        osloOLsamples: olEarn.slice(0, 5).map((e) => ({ symbol: e.symbol, date: e.date })),
        errorSample: earnCal.info.used === 'none' ? earnCal.info : undefined,
      },
      matchedEvents: events.length,
      events,
    });
  }

  res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).json({ events, cached: false });
}
