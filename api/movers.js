// Henter OBX-indeks og vinnere/tapere fra Yahoo Finance
// Bruker de 25 OBX-aksjene + indeksene i parallelle kall

const OBX_TICKERS = [
  'AKRBP','BWLPG','DNB','EQNR','FRO','GJF','GOGL','HAFNI','HAUTO',
  'KOG','MOWI','MPCC','NHY','ORK','RECSI','SALM','SCATC','STB',
  'SUBC','TEL','TGS','YAR','AKER','AUSS','LSG'
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

  function parseChart(data, ticker) {
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
        name: (meta?.longName || meta?.shortName || ticker).replace(' ASA','').replace(' PLC','').split(' ').slice(0,2).join(' '),
        price: price.toFixed(2),
        changePct: Math.abs(changePct).toFixed(2),
        changePctRaw: changePct,
        up: change >= 0
      };
    } catch(e) { return null; }
  }

  try {
    // Hent indekser + OBX-aksjer parallelt
    const allFetches = [
      fetch('https://query2.finance.yahoo.com/v8/finance/chart/%5EOBX?interval=1d&range=2d', { headers: yHeaders }),
      fetch('https://query2.finance.yahoo.com/v8/finance/chart/%5EOSEBX?interval=1d&range=2d', { headers: yHeaders }),
      ...OBX_TICKERS.map(t =>
        fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${t}.OL?interval=1d&range=2d`, { headers: yHeaders })
      )
    ];

    const responses = await Promise.all(allFetches);
    const jsons = await Promise.all(responses.map(r => r.ok ? r.json() : null));

    // Parse indekser
    function parseIndex(data) {
      if (!data) return null;
      try {
        const result = data?.chart?.result?.[0];
        const meta = result?.meta;
        const closes = (result?.indicators?.quote?.[0]?.close || []).filter(v => v != null);
        const price = meta?.regularMarketPrice || closes[closes.length - 1] || 0;
        const prevClose = meta?.chartPreviousClose || closes[closes.length - 2] || price;
        const change = price - prevClose;
        const changePct = prevClose ? (change / prevClose) * 100 : 0;
        return {
          price: price.toFixed(0),
          change: change.toFixed(2),
          changePct: Math.abs(changePct).toFixed(2),
          up: change >= 0
        };
      } catch(e) { return null; }
    }

    const obx = parseIndex(jsons[0]);
    const osebx = parseIndex(jsons[1]);

    // Parse aksjer
    const stocks = OBX_TICKERS.map((t, i) => parseChart(jsons[i + 2], t)).filter(Boolean);

    // Sorter
    const sorted = [...stocks].sort((a, b) => b.changePctRaw - a.changePctRaw);
    const winners = sorted.slice(0, 5);
    const losers = sorted.slice(-5).reverse();

    return res.status(200).json({ winners, losers, obx, osebx });
  } catch(e) {
    console.error('movers error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
