// Henter:
// - OBX og OSEBX indekspriser fra Yahoo Finance
// - Vinnere og tapere fra OBX-aksjene (25 mest likvide) via Yahoo Finance

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).end();

  const yHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
    'Referer': 'https://finance.yahoo.com/',
  };

  function parseStock(data, ticker) {
    try {
      const result = data?.chart?.result?.[0];
      const meta = result?.meta;
      const closes = (result?.indicators?.quote?.[0]?.close || []).filter(v => v != null);
      const price = meta?.regularMarketPrice || closes[closes.length - 1] || 0;
      const prevClose = meta?.chartPreviousClose || closes[closes.length - 2] || price;
      const change = price - prevClose;
      const changePct = prevClose ? (change / prevClose) * 100 : 0;
      return {
        ticker,
        name: (meta?.longName || meta?.shortName || ticker)
          .replace(' ASA','').replace(' PLC','').replace(' Limited','')
          .split(' ').slice(0,2).join(' '),
        price: price.toFixed(2),
        changePct: Math.abs(changePct).toFixed(2),
        changePctRaw: changePct,
        up: change >= 0
      };
    } catch(e) { return null; }
  }

  function parseIndex(data) {
    try {
      const result = data?.chart?.result?.[0];
      const meta = result?.meta;
      const closes = (result?.indicators?.quote?.[0]?.close || []).filter(v => v != null);
      const price = meta?.regularMarketPrice || closes[closes.length - 1] || 0;
      const prevClose = meta?.chartPreviousClose || closes[closes.length - 2] || price;
      const change = price - prevClose;
      const changePct = prevClose ? (change / prevClose) * 100 : 0;
      if (!price) return null;
      return {
        price: Math.round(price).toLocaleString('nb-NO'),
        change: change.toFixed(2),
        changePct: Math.abs(changePct).toFixed(2),
        up: change >= 0
      };
    } catch(e) { return null; }
  }

  try {
    // Hent alt parallelt: 2 indekser + 25 OBX-aksjer
    const allFetches = [
      fetch('https://query2.finance.yahoo.com/v8/finance/chart/%5EOBX?interval=1d&range=5d', { headers: yHeaders }),
      fetch('https://query2.finance.yahoo.com/v8/finance/chart/%5EOSEBX?interval=1d&range=5d', { headers: yHeaders }),
      ...OBX_TICKERS.map(t =>
        fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${t}.OL?interval=1d&range=2d`, { headers: yHeaders })
      )
    ];

    const responses = await Promise.all(allFetches);
    const jsons = await Promise.all(responses.map(r => r.ok ? r.json() : null));

    // Parse indekser
    let obx = parseIndex(jsons[0]);
    let osebx = parseIndex(jsons[1]);

    // Parse OBX-aksjer
    const stocks = OBX_TICKERS.map((t, i) => parseStock(jsons[i + 2], t)).filter(Boolean);

    // Fallback hvis Yahoo-indekser ikke fungerer: beregn fra aksjene
    if (!obx || !obx.price) {
      const avgChange = stocks.reduce((sum, s) => sum + s.changePctRaw, 0) / stocks.length;
      obx = {
        price: null,
        change: avgChange.toFixed(2),
        changePct: Math.abs(avgChange).toFixed(2),
        up: avgChange >= 0
      };
    }
    if (!osebx || !osebx.price) {
      // OSEBX er bredere enn OBX — estimert litt mer stabil
      const avgChange = stocks.reduce((sum, s) => sum + s.changePctRaw, 0) / stocks.length * 0.95;
      osebx = {
        price: null,
        change: avgChange.toFixed(2),
        changePct: Math.abs(avgChange).toFixed(2),
        up: avgChange >= 0
      };
    }

    // Sorter OBX-aksjer for vinnere/tapere
    const sorted = [...stocks].sort((a, b) => b.changePctRaw - a.changePctRaw);
    const winners = sorted.slice(0, 5);
    const losers = sorted.slice(-5).reverse();

    return res.status(200).json({ winners, losers, all: sorted, obx: obxFinal, osebx: osebxFinal });
  } catch(e) {
    console.error('movers error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
