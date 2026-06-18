// Henter fra Financial Modeling Prep (FMP):
// - OBX og OSEBX indeksnivåer (KUN faktiske indeksverdier fra FMP)
// - Vinnere og tapere fra Oslo Børs-aksjer, priset i NOK via .OL
//
// To moduser:
//   Standard (ingen query)  -> 25 mest likvide OBX-aksjer. RASKT. Brukes live av
//                              oversikt.html sitt vinnere/tapere-kort på hver sidelast.
//   ?scope=all              -> hele Oslo-universet (~330+ .OL-aksjer). TYNGRE.
//                              Brukes av den daglige Børsbrygg-cronen (én gang/døgn),
//                              for bredere og mer representativt bredde-/utvalgsgrunnlag.
//
// VIKTIG: vi fabrikkerer ALDRI et indekstall fra et snitt av aksjene. Et uvektet
// snitt av et utvalg er ikke den (markedsvekt-justerte) indeksen og kan peke FEIL
// vei. obx/osebx settes KUN fra ekte FMP-indeksdata, ellers null.

// OBX-komponenter (oppdatert juni 2026) — standard hurtigutvalg.
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
const OBX_INDEX_SYMBOLS = ['^OBX', 'OBX.OL', 'OBX'];
const OSEBX_INDEX_SYMBOLS = ['^OSEBX', 'OSEBX.OL', 'OSEBX'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  // scope=all caches lenger (daglig cron), standard kort (live-kort).
  const scopeAll = req.query && (req.query.scope === 'all');
  res.setHeader('Cache-Control', scopeAll ? 'public, max-age=300' : 'public, max-age=60');
  if (req.method !== 'GET') return res.status(405).end();

  const apiKey = process.env.FMP_API_KEY;

  function pickOne(d) { return Array.isArray(d) ? d[0] : d; }

  function fmpQuote(symbol) {
    return fetch(`https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`)
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null);
  }

  // Henter en liste over ALLE .OL-symboler på Oslo Børs (for scope=all).
  // Samme kildestrategi som events-cronen: prøv flere endepunkter, bruk første
  // som faktisk gir .OL-treff. Returnerer { 'EQNR.OL': 'Equinor', ... }.
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
  async function getAllOsloSymbols() {
    const k = '&apikey=' + apiKey;
    const sources = [
      'https://financialmodelingprep.com/stable/available-exchange-symbols?exchange=OSL' + k,
      'https://financialmodelingprep.com/stable/company-screener?exchange=OSL&limit=3000' + k,
      'https://financialmodelingprep.com/api/v3/symbol/OSL?apikey=' + apiKey,
    ];
    for (const url of sources) {
      try {
        const r = await fetch(url);
        if (!r.ok) continue;
        const body = await r.json();
        const map = extractOL(body);
        if (Object.keys(map).length > 0) return map;
      } catch (e) { /* prøv neste */ }
    }
    return {};
  }

  // Henter quotes for mange symboler i bolker (unngår å sprenge ett gigantisk kall).
  async function fmpQuoteBatch(symbols, batchSize) {
    const out = [];
    for (let i = 0; i < symbols.length; i += batchSize) {
      const chunk = symbols.slice(i, i + batchSize);
      const results = await Promise.all(chunk.map(fmpQuote));
      out.push(...results);
    }
    return out;
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
      // up bindes til SAMME signerte tall som prosenten (changePercentage), ikke til
      // det separate change-feltet. Da kan pilen aldri si "opp" mens prosenten er negativ.
      up: changePct >= 0
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
      up: changePct >= 0
    };
  }

  try {
    // --- Indekser hentes likt i begge moduser (få kall, billig) ---
    const indexSymbols = [...OBX_INDEX_SYMBOLS, ...OSEBX_INDEX_SYMBOLS];
    const indexRaws = await Promise.all(indexSymbols.map(fmpQuote));
    const indexParsed = {};
    indexSymbols.forEach((sym, i) => { indexParsed[sym] = parseIndex(pickOne(indexRaws[i])); });
    function firstIndex(syms) { for (const s of syms) { if (indexParsed[s]) return indexParsed[s]; } return null; }

    const indexDebug = {};
    indexSymbols.forEach((sym, i) => {
      const q = pickOne(indexRaws[i]);
      indexDebug[sym] = (q && q.price != null) ? Number(q.price) : null;
    });
    console.log('MOVERS_INDEX_DEBUG', indexDebug);

    // KUN ekte indeksverdier fra FMP. Finnes de ikke: null (frontend viser "—").
    const obx = firstIndex(OBX_INDEX_SYMBOLS);
    const osebx = firstIndex(OSEBX_INDEX_SYMBOLS);

    // --- Aksjeutvalg: bredt (scope=all) eller hurtig (standard 25 OBX) ---
    let stocks;
    let universeSize;
    // OBX-delmengde (kun ved scope=all): brukes til vinnere/tapere slik at de er
    // IDENTISKE med oversikt-siden (kjente, store selskaper), mens den brede lista
    // brukes til selve oppsummeringsteksten. Bygges fra nøyaktig samme 25 OBX-
    // tickere som standard-movers, så de to alltid stemmer overens.
    let obxStocks = null;
    if (scopeAll) {
      // Hent OBX-aksjene separat (samme kilde/parsing som standard-movers).
      const obxRaws = await Promise.all(OBX_TICKERS.map(t => fmpQuote(t + '.OL')));
      obxStocks = OBX_TICKERS.map((t, i) => parseStock(pickOne(obxRaws[i]), t)).filter(Boolean);

      const nameMap = await getAllOsloSymbols();
      const symbols = Object.keys(nameMap);
      if (!symbols.length) {
        // Klarte ikke hente hele universet: fall tilbake til 25 OBX, så cronen
        // fortsatt får data (om enn smalere) i stedet for å feile helt.
        stocks = obxStocks.slice();
        universeSize = stocks.length;
      } else {
        const raws = await fmpQuoteBatch(symbols, 25);
        stocks = symbols.map((sym, i) => {
          const q = pickOne(raws[i]);
          const ticker = sym.replace('.OL', '');
          const parsed = parseStock(q, ticker);
          // bruk navn fra symbol-listen hvis quote mangler navn
          if (parsed && (!parsed.name || parsed.name === ticker) && nameMap[sym]) {
            parsed.name = String(nameMap[sym]).replace(' ASA', '').replace(' PLC', '').split(' ').slice(0, 2).join(' ');
          }
          return parsed;
        }).filter(Boolean);

        // DATAKVALITET (kun scope=all): luk ut støy så vinnere/tapere og bredde
        // beskriver EKTE handel, ikke datafeil og illikvide papirer.
        // 1) changePctRaw === 0  -> på Oslo Børs betyr dette nesten alltid at
        //    aksjen IKKE ble handlet (illikvid), ikke at den "sto stille".
        //    Tar vi dem med, blåses bredde-tallet opp og mange feilmerkes som "opp".
        // 2) |endring| >= 25 %   -> urealistisk for en vanlig børsdag for et reelt
        //    selskap. FMP gir av og til søppel (notering, spleis, stale kurs) som
        //    RAKP +1787 % — det ville gitt Børsbrygg en feil og pinlig overskrift.
        // 3) pris < 0,10 kr     -> ekstreme penny-/øreaksjer der ett øre gir
        //    enorme prosentutslag (AKH 0,01 kr "−16 %"). Statistisk støy, ikke en
        //    nyhet. Grensen er bevisst LAV (0,10) så aktive lavpris-aksjer som
        //    NORSE, NBX m.fl. beholdes — kun de helt ekstreme øreaksjene fjernes.
        // 4) ETF/indeksprodukter -> f.eks. OBXD ("DNB OBX") er et børshandlet fond
        //    som FØLGER OBX-indeksen, ikke en enkeltaksje. Hvis Børsbrygg plukker
        //    den, kan "DNB OBX falt 1,6 %" feiltolkes som at INDEKSEN falt — nettopp
        //    aggregat-retningen guardrailen skal hindre. Fjern slike produkter.
        const MAX_REALISTIC_PCT = 25;
        const MIN_PRICE = 0.1;
        // Tickere som er fond/ETF/indeksprodukter (ikke enkeltselskaper).
        // Eksplisitt ticker-liste er tryggest; utvid ved behov.
        const EXCLUDE_TICKERS = new Set(['OBXD']);
        // Navnemønster som røper et bull/bear-/ETF-produkt. Bevisst SMALT for å
        // unngå falske treff (f.eks. "Index Pharmaceuticals" er et ekte selskap —
        // ordet "index/indeks" alene diskvalifiserer derfor IKKE).
        const isIndexProduct = s =>
          EXCLUDE_TICKERS.has(s.ticker) ||
          /\b(bull|bear)\b/i.test(s.name || '') ||
          /\bETF\b/.test(s.name || '') ||
          /\bOBX\b/.test(s.name || '');
        stocks = stocks.filter(s =>
          s.changePctRaw !== 0 &&
          Math.abs(s.changePctRaw) < MAX_REALISTIC_PCT &&
          Number(s.price) >= MIN_PRICE &&
          !isIndexProduct(s)
        );

        universeSize = stocks.length;
      }
    } else {
      const stockRaws = await Promise.all(OBX_TICKERS.map(t => fmpQuote(t + '.OL')));
      stocks = OBX_TICKERS.map((t, i) => parseStock(pickOne(stockRaws[i]), t)).filter(Boolean);
      universeSize = stocks.length;
    }

    // Sorter HELE utvalget for tekst/bredde (størst opp -> størst ned)
    const sorted = [...stocks].sort((a, b) => b.changePctRaw - a.changePctRaw);

    // VINNERE/TAPERE: ved scope=all bygges de fra OBX-delmengden (kjente, store
    // selskaper) slik at de er identiske med oversikt-siden. Uten scope er stocks
    // allerede OBX, så da brukes den direkte.
    const moversBase = (scopeAll && obxStocks && obxStocks.length)
      ? [...obxStocks].sort((a, b) => b.changePctRaw - a.changePctRaw)
      : sorted;
    const winners = moversBase.slice(0, 5);
    const losers = moversBase.slice(-5).reverse();

    return res.status(200).json({
      winners,
      losers,
      all: sorted,
      obx,
      osebx,
      scope: scopeAll ? 'all' : 'obx25',
      universeSize
    });
  } catch (e) {
    console.error('movers error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
