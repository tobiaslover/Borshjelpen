// Henter fra Financial Modeling Prep (FMP):
// - OBX og OSEBX indeksnivåer (med fallback: beregnet fra aksjene hvis FMP ikke har indeksen)
// - Vinnere og tapere fra OBX-aksjene (25 mest likvide), priset i NOK via .OL

// OBX-komponenter (oppdatert juni 2026)
const OBX_TICKERS = [
  'EQNR',   // Equinor
  'VAR',    // Vår Energi
  'DNB',    // DNB
  'NHY',    // Norsk Hydro
  'FRO',    // Frontline
  'AKRBP',  // Aker BP
  'NAS',    // Norwegian Air Shuttle
  'KOG',    // Kongsberg Gruppen
  'MOWI',   // Mowi
  'ORK',    // Orkla
  'YAR',    // Yara
  'TEL',    // Telenor
  'VEND',   // Vend (Adevinta)
  'PROT',   // Protector Forsikring
  'SUBC',   // Subsea 7
  'SALM',   // SalMar
  'KMAR',   // Kongsberg Maritime
  'STB',    // Storebrand
  'NOD',    // Nordic Semiconductor
  'DOFG',   // DOF Group
  'GJF',    // Gjensidige
  'TOM',    // Tomra
  'WAWI',   // Wallenius Wilhelmsen
  'BWLPG',  // BW LPG
  'HAUTO',  // Höegh Autoliners
  'BAKKA',  // Bakkafrost
];

// Mulige FMP-symboler for indeksene (prøves i rekkefølge, første som gir pris vinner)
const OBX_INDEX_SYMBOLS = ['^OBX', 'OBX.OL'];
const OSEBX_INDEX_SYMBOLS = ['^OSEBX', 'OSEBX.OL'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'public, max-age=60');
  if (req.method !== 'GET') return res.status(405).end();

  const apiKey = process.env.FMP_API_KEY;

  function pickOne(d) { return Array.isArray(d) ? d[0] : d; }

  function fmpQuote(symbol) {
    return fetch(`https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`)
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null);
  }

  function parseStock(q, ticker) {
    if (!q || q.price == null) return null;
    const changePct = Number(q.changePercentage) || 0;
    return {
      ticker,
      name: (q.name || ticker)
        .replace(' ASA', '').replace(' PLC', '').replace(' Limited', '')
        .split(' ').slice(0, 2).join(' '),
      price: Number(q.price).toFixed(2),
      changePct: Math.abs(changePct).toFixed(2),
      changePctRaw: changePct,
      up: (Number(q.change) || 0) >= 0
    };
  }

  function parseIndex(q) {
    if (!q || q.price == null) return null;
    const price = Number(q.price);
    if (!price) return null;
    const change = Number(q.change) || 0;
    const changePct = Number(q.changePercentage) || 0;
    return {
      price: Math.round(price).toLocaleString('nb-NO'),
      change: change.toFixed(2),
      changePct: Math.abs(changePct).toFixed(2),
      up: change >= 0
    };
  }

  try {
    // Hent alt parallelt: indekskandidater + 25 OBX-aksjer
    const indexSymbols = [...OBX_INDEX_SYMBOLS, ...OSEBX_INDEX_SYMBOLS];
    const [indexRaws, stockRaws] = await Promise.all([
      Promise.all(indexSymbols.map(fmpQuote)),
      Promise.all(OBX_TICKERS.map(t => fmpQuote(t + '.OL')))
    ]);

    // Map symbol -> parset indeks
    const indexParsed = {};
    indexSymbols.forEach((sym, i) => { indexParsed[sym] = parseIndex(pickOne(indexRaws[i])); });
    function firstIndex(syms) { for (const s of syms) { if (indexParsed[s]) return indexParsed[s]; } return null; }

    let obx = firstIndex(OBX_INDEX_SYMBOLS);
    let osebx = firstIndex(OSEBX_INDEX_SYMBOLS);

    // Parse OBX-aksjer
    const stocks = OBX_TICKERS.map((t, i) => parseStock(pickOne(stockRaws[i]), t)).filter(Boolean);

    // Fallback hvis FMP ikke har indeksen: beregn snitt-endring fra aksjene (pris = null)
    if ((!obx || !obx.price) && stocks.length) {
      const avgChange = stocks.reduce((sum, s) => sum + s.changePctRaw, 0) / stocks.length;
      obx = { price: null, change: avgChange.toFixed(2), changePct: Math.abs(avgChange).toFixed(2), up: avgChange >= 0 };
    }
    if ((!osebx || !osebx.price) && stocks.length) {
      // OSEBX er bredere enn OBX — estimert litt mer stabil
      const avgChange = (stocks.reduce((sum, s) => sum + s.changePctRaw, 0) / stocks.length) * 0.95;
      osebx = { price: null, change: avgChange.toFixed(2), changePct: Math.abs(avgChange).toFixed(2), up: avgChange >= 0 };
    }

    // Sorter OBX-aksjer for vinnere/tapere
    const sorted = [...stocks].sort((a, b) => b.changePctRaw - a.changePctRaw);
    const winners = sorted.slice(0, 5);
    const losers = sorted.slice(-5).reverse();

    return res.status(200).json({ winners, losers, all: sorted, obx, osebx });
  } catch (e) {
    console.error('movers error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
