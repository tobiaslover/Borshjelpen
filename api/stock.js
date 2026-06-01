export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Ticker mangler' });

  const upper = ticker.toUpperCase().replace('.OL','').replace(':OSE','');
  const symbol = upper + '.OL';

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Referer': 'https://finance.yahoo.com/',
  };

  try {
    const chartUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d&modules=financialData,summaryDetail,assetProfile,price`;
    const chartRes = await fetch(chartUrl, { headers });

    if (!chartRes.ok) {
      return res.status(404).json({ error: `Aksje "${upper}" ikke funnet. Prøv f.eks. EQNR, DNB, TEL, AKRBP, MOWI.` });
    }

    const data = await chartRes.json();
    const result = data?.chart?.result?.[0];
    const meta = result?.meta;
    const closes = (result?.indicators?.quote?.[0]?.close || []).filter(v => v != null);

    const price = meta?.regularMarketPrice || closes[closes.length - 1] || 0;
    const prevClose = closes[closes.length - 2] || price;
    const change = +(price - prevClose).toFixed(2);
    const changePct = prevClose ? +((change / prevClose) * 100).toFixed(2) : 0;

    const name = meta?.longName || meta?.shortName || upper;
    const fiftyTwoWeekHigh = meta?.fiftyTwoWeekHigh?.toFixed(2) || null;
    const fiftyTwoWeekLow = meta?.fiftyTwoWeekLow?.toFixed(2) || null;

    res.status(200).json({
      ticker: upper,
      name,
      price: price.toFixed(2),
      currency: 'NOK',
      change: change.toFixed(2),
      changePct: Math.abs(changePct).toFixed(2),
      up: change >= 0,
      exchange: 'Oslo Børs',
      marketCap: null,
      pe: null,
      dividendYield: null,
      beta: null,
      fiftyTwoWeekHigh,
      fiftyTwoWeekLow,
      volume: meta?.regularMarketVolume?.toLocaleString('nb-NO') || null,
      sector: null,
      industry: null,
      description: null,
      profitMargin: null,
      returnOnEquity: null,
    });

  } catch (err) {
    res.status(500).json({ error: 'Serverfeil', detail: err.message });
  }
}
