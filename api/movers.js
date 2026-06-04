export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'public, max-age=300');

  if (req.method !== 'GET') return res.status(405).end();

  const apiKey = process.env.FMP_API_KEY;
  const yHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
    'Referer': 'https://finance.yahoo.com/',
  };

  const OSLO_TICKERS = new Set([
    '2020','ABG','ABL','AKRBP','AKSO','AKER','AKVA','ATEA','AUSS','AUTO',
    'BELCO','BEWI','BOR','BORR','BOUVET','BRG','BWO','BWLPG','DNB','DNO',
    'EQNR','ENTRA','FRO','GJF','GOGL','GRIEG','GSF','HAFNI','HAVI','IDEX',
    'KAHOT','KID','KOG','KCC','LSG','MOWI','MPCC','MAS','NAS','NEL',
    'NHY','ORK','OKEA','PEXIP','PGS','RECSI','SALM','SCATC','SDRL','SRBANK',
    'STB','SUBC','TEL','TGS','TOMRA','YAR','FLNG','HAUTO','HUNT','INIFY'
  ]);

  try {
    // Hent indekser fra Yahoo + vinnere/tapere fra FMP parallelt
    const [obxRes, osebxRes, gainersRes, losersRes] = await Promise.all([
      fetch('https://query2.finance.yahoo.com/v8/finance/chart/%5EOBX?interval=1d&range=2d', { headers: yHeaders }),
      fetch('https://query2.finance.yahoo.com/v8/finance/chart/%5EOSEBX?interval=1d&range=2d', { headers: yHeaders }),
      fetch(`https://financialmodelingprep.com/stable/biggest-gainers?apikey=${apiKey}`),
      fetch(`https://financialmodelingprep.com/stable/biggest-losers?apikey=${apiKey}`),
    ]);

    // Parse indekser
    function parseIndex(data) {
      const result = data?.chart?.result?.[0];
      const meta = result?.meta;
      const closes = (result?.indicators?.quote?.[0]?.close || []).filter(v => v != null);
      const price = meta?.regularMarketPrice || closes[closes.length - 1] || 0;
      const prevClose = closes[closes.length - 2] || meta?.chartPreviousClose || price;
      const change = +(price - prevClose).toFixed(2);
      const changePct = prevClose ? +((change / prevClose) * 100).toFixed(2) : 0;
      return { price: price.toFixed(0), change: change.toFixed(2), changePct: Math.abs(changePct).toFixed(2), up: change >= 0 };
    }

    let obx = null, osebx = null;
    if (obxRes.ok) { try { obx = parseIndex(await obxRes.json()); } catch(e) {} }
    if (osebxRes.ok) { try { osebx = parseIndex(await osebxRes.json()); } catch(e) {} }

    // Parse vinnere/tapere
    let gainers = [], losers = [];
    if (gainersRes.ok) { try { gainers = await gainersRes.json(); } catch(e) {} }
    if (losersRes.ok) { try { losers = await losersRes.json(); } catch(e) {} }

    function isOslo(item) {
      const sym = (item.symbol || '').replace('.OL', '');
      return (item.symbol || '').endsWith('.OL') || OSLO_TICKERS.has(sym);
    }

    function fmt(item) {
      const sym = (item.symbol || '').replace('.OL', '');
      return {
        ticker: sym,
        name: (item.name || item.companyName || sym).split(' ').slice(0, 2).join(' '),
        price: parseFloat(item.price || 0).toFixed(2),
        changePct: Math.abs(parseFloat(item.changesPercentage || 0)).toFixed(2),
        up: parseFloat(item.changesPercentage || 0) >= 0
      };
    }

    const osloGainers = gainers.filter(isOslo).slice(0, 5).map(fmt);
    const osloLosers = losers.filter(isOslo).slice(0, 5).map(fmt);

    const winners = osloGainers.length >= 3 ? osloGainers : gainers.slice(0, 5).map(fmt);
    const losersList = osloLosers.length >= 3 ? osloLosers : losers.slice(0, 5).map(fmt);

    return res.status(200).json({ winners, losers: losersList, obx, osebx });
  } catch(e) {
    console.error('movers error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
