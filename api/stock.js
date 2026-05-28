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
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': `https://finance.yahoo.com/quote/${symbol}`,
    'Origin': 'https://finance.yahoo.com',
  };

  try {
    // ETT kall med alle moduler inkludert chart
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=assetProfile,summaryDetail,financialData,price,defaultKeyStatistics`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
      return res.status(404).json({ error: `Aksje "${upper}" ikke funnet.`, httpStatus: response.status });
    }

    const data = await response.json();
    const r = data?.quoteSummary?.result?.[0];

    if (!r) {
      return res.status(404).json({ error: `Ingen data for "${upper}".` });
    }

    const p = r.price || {};
    const d = r.summaryDetail || {};
    const f = r.financialData || {};
    const a = r.assetProfile || {};
    const k = r.defaultKeyStatistics || {};

    const price = p.regularMarketPrice?.raw || 0;
    const prevClose = p.regularMarketPreviousClose?.raw || price;

    // Hent historiske sluttkurser for riktig endring
    const chartUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`;
    const chartRes = await fetch(chartUrl, { headers });
    const chartData = await chartRes.json();
    const closes = (chartData?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []).filter(v => v != null);
    const todayClose = closes[closes.length - 1] || price;
    const yesterdayClose = closes[closes.length - 2] || prevClose;
    const change = +(todayClose - yesterdayClose).toFixed(2);
    const changePct = yesterdayClose ? +((change / yesterdayClose) * 100).toFixed(2) : 0;

    res.status(200).json({
      ticker: upper,
      name: p.longName || p.shortName || upper,
      price: (p.regularMarketPrice?.raw || todayClose).toFixed(2),
      currency: 'NOK',
      change: change.toFixed(2),
      changePct: changePct.toFixed(2),
      up: change >= 0,
      exchange: 'Oslo Børs',
      marketCap: p.marketCap?.raw ? (p.marketCap.raw / 1e9).toFixed(1) + ' mrd' : null,
      pe: d.trailingPE?.raw?.toFixed(1) || k.trailingPE?.raw?.toFixed(1) || null,
      forwardPE: d.forwardPE?.raw?.toFixed(1) || k.forwardPE?.raw?.toFixed(1) || null,
      dividendYield: d.dividendYield?.raw ? (d.dividendYield.raw * 100).toFixed(2) + '%' : null,
      beta: d.beta?.raw?.toFixed(2) || k.beta?.raw?.toFixed(2) || null,
      fiftyTwoWeekHigh: d.fiftyTwoWeekHigh?.raw?.toFixed(2) || null,
      fiftyTwoWeekLow: d.fiftyTwoWeekLow?.raw?.toFixed(2) || null,
      volume: p.regularMarketVolume?.raw?.toLocaleString('nb-NO') || null,
      sector: a.sector || null,
      industry: a.industry || null,
      description: a.longBusinessSummary || null,
      website: a.website || null,
      employees: a.fullTimeEmployees || null,
      country: 'Norge',
      profitMargin: f.profitMargins?.raw ? (f.profitMargins.raw * 100).toFixed(1) + '%' : null,
      returnOnEquity: f.returnOnEquity?.raw ? (f.returnOnEquity.raw * 100).toFixed(1) + '%' : null,
      revenueGrowth: f.revenueGrowth?.raw ? (f.revenueGrowth.raw * 100).toFixed(1) + '%' : null,
    });

  } catch (err) {
    res.status(500).json({ error: 'Serverfeil', detail: err.message });
  }
}
