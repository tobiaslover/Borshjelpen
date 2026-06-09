// Henter fra Financial Modeling Prep (FMP):
// - OBX og OSEBX indeksnivåer (KUN faktiske indeksverdier fra FMP)
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

// Mulige FMP-symboler for indeksene (prøves i rekkefølge, første som gir pris vinner).
// MERK: oppdater disse til det symbolet som faktisk returnerer pris fra din FMP-plan.
// Test i nettleser: https://financialmodelingprep.com/stable/quote?symbol=^OSEBX&apikey=DIN_KEY
const OBX_INDEX_SYMBOLS = ['^OBX', 'OBX.OL', 'OBX'];
const OSEBX_INDEX_SYMBOLS = ['^OSEBX', 'OSEBX.OL', 'OSEBX'];

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

    // Diagnostikk i Vercel Logs: hvilke(t) indeks-symbol returnerte faktisk en pris?
    // Bruk dette til å finne riktig FMP-symbol, og oppdater listene øverst.
    const indexDebug = {};
    indexSymbols.forEach((sym, i) => {
      const q = pickOne(indexRaws[i]);
      indexDebug[sym] = (q && q.price != null) ? Number(q.price) : null;
    });
    console.log('MOVERS_INDEX_DEBUG', indexDebug);

    // KUN ekte indeksverdier fra FMP. Finnes de ikke, er obx/osebx = null,
    // og frontend viser "—" / utilgjengelig.
    //
    // VIKTIG: vi fabrikkerer IKKE lenger et indekstall fra gjennomsnittet av
    // OBX-aksjene. Et uvektet snitt av et utvalg aksjer er ikke den faktiske
    // (markedsvekt-justerte) indeksen og kan vise FEIL retning — det er verre
    // enn å vise ingenting på en finanstjeneste.
    const obx = firstIndex(OBX_INDEX_SYMBOLS);
    const osebx = firstIndex(OSEBX_INDEX_SYMBOLS);

    // Parse OBX-aksjer (brukes til vinnere/tapere — ekte per-aksje-kurser)
    const stocks = OBX_TICKERS.map((t, i) => parseStock(pickOne(stockRaws[i]), t)).filter(Boolean);

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
