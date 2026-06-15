// api/events.js
// Henter kommende ex-utbyttedatoer og kvartalsrapport-datoer for OBX-aksjer
// live fra Financial Modeling Prep (FMP). Erstatter den tidligere hardkodede lista.
//
// Frontend-kontrakt (oversikt.html → loadEvents) er uendret:
//   { events: [ { date:'YYYY-MM-DD', ticker:'EQNR', name:'Equinor',
//                 type:'utbytte'|'rapport', amount?:'3.61', estimated?:bool } ], cached:bool }

// FMP-nøkkel ligger server-side i Vercel. Bruker samme env-var som dine andre
// FMP-ruter (stock.js / movers.js). VERIFISER at navnet stemmer — endre her hvis
// nøkkelen din heter noe annet.
const FMP_KEY = process.env.FMP_API_KEY || process.env.FMP_KEY;

// ── OBX-tickere: FMP-symbol (.OL) → visningsnavn ────────────────────────────
// Hold denne i sync med lista i movers.js. (Bedre på sikt: flytt til én delt
// fil, f.eks. lib/obx.js, og importer den begge steder så de aldri spriker.)
// OBX-indeksen revideres halvårlig — sjekk sammensetningen ved behov.
const OBX = {
  'EQNR.OL': 'Equinor',
  'DNB.OL': 'DNB',
  'TEL.OL': 'Telenor',
  'AKRBP.OL': 'Aker BP',
  'NHY.OL': 'Norsk Hydro',
  'YAR.OL': 'Yara',
  'MOWI.OL': 'Mowi',
  'ORK.OL': 'Orkla',
  'KOG.OL': 'Kongsberg Gruppen',
  'SUBC.OL': 'Subsea 7',
  'SALM.OL': 'SalMar',
  'GJF.OL': 'Gjensidige',
  'STB.OL': 'Storebrand',
  'TOM.OL': 'Tomra',
  'NOD.OL': 'Nordic Semiconductor',
  'AKSO.OL': 'Aker Solutions',
  'FRO.OL': 'Frontline',
  'BWLPG.OL': 'BW LPG',
  'SCATC.OL': 'Scatec',
  'ELK.OL': 'Elkem',
  'AUTO.OL': 'AutoStore',
  'LSG.OL': 'Lerøy Seafood',
  'VAR.OL': 'Vår Energi',
  'AKER.OL': 'Aker',
  'GOGL.OL': 'Golden Ocean',
};

const TZ_HORIZON_DAYS = 90; // FMP-kalenderne tillater maks ~3 mnd vindu

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('FMP svarte ' + r.status);
  return r.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  // CDN-cache i 1 time, server gamle data mens nye hentes
  res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400');
  if (req.method !== 'GET') return res.status(405).end();

  if (!FMP_KEY) {
    // Mangler nøkkel → tom liste, så siden ikke krasjer
    return res.status(200).json({ events: [], cached: false, error: 'FMP-nøkkel mangler' });
  }

  const today = new Date();
  const from = ymd(today);
  const horizon = new Date(today.getTime() + TZ_HORIZON_DAYS * 86400000);
  const to = ymd(horizon);
  const symbolSet = new Set(Object.keys(OBX));
  const display = (sym) => OBX[sym] || sym.replace('.OL', '');
  const strip = (sym) => sym.replace('.OL', '');

  const divUrl = `https://financialmodelingprep.com/api/v3/stock_dividend_calendar?from=${from}&to=${to}&apikey=${FMP_KEY}`;
  const earnUrl = `https://financialmodelingprep.com/api/v3/earning_calendar?from=${from}&to=${to}&apikey=${FMP_KEY}`;

  let events = [];
  let hadError = false;

  // ── Utbytte (ex-datoer) ───────────────────────────────────────────────────
  try {
    const div = await fetchJson(divUrl);
    if (Array.isArray(div)) {
      div.forEach((d) => {
        if (!d || !d.symbol || !symbolSet.has(d.symbol)) return;
        if (!d.date || d.date < from) return; // d.date = ex-dato
        const amt = d.dividend != null ? Number(d.dividend) : (d.adjDividend != null ? Number(d.adjDividend) : null);
        events.push({
          date: d.date,
          ticker: strip(d.symbol),
          name: display(d.symbol),
          type: 'utbytte',
          amount: amt != null && !isNaN(amt) ? amt.toFixed(2) : undefined,
        });
      });
    }
  } catch (e) {
    hadError = true;
  }

  // ── Kvartalsrapporter (earnings-datoer) ───────────────────────────────────
  try {
    const earn = await fetchJson(earnUrl);
    if (Array.isArray(earn)) {
      const seen = new Set();
      earn.forEach((e) => {
        if (!e || !e.symbol || !symbolSet.has(e.symbol)) return;
        if (!e.date || e.date < from) return;
        const key = e.symbol + '|' + e.date;
        if (seen.has(key)) return; // dedup
        seen.add(key);
        events.push({
          date: e.date,
          ticker: strip(e.symbol),
          name: display(e.symbol),
          type: 'rapport',
          // FMP gir ikke alltid bekreftet vs. estimert eksplisitt; framtidige
          // datoer er som regel estimerte. Frontend kan velge å vise dette.
          estimated: true,
        });
      });
    }
  } catch (e) {
    hadError = true;
  }

  // Sorter kronologisk, nærmeste først
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return res.status(200).json({ events, cached: false, partial: hadError });
}
