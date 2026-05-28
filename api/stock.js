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
    // Kall 1: Chart for kurs og endring
    const chartUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`;
    const chartRes = await fetch(chartUrl, { headers });
    const chartData = await chartRes.json();
    const result = chartData?.chart?.result?.[0];
    const meta = result?.meta;
    const closes = (result?.indicators?.quote?.[0]?.close || []).filter(v => v != null);
    const price = meta?.regularMarketPrice || closes[closes.length - 1] || 0;
    const prevClose = closes[closes.length - 2] || price;
    const change = +(price - prevClose).toFixed(2);
    const changePct = prevClose ? +((change / prevClose) * 100).toFixed(2) : 0;

    // Kall 2: quoteSummary for nøkkeltall — vent 300ms mellom kallene
    await new Promise(r => setTimeout(r, 300));
    const summaryUrl = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=assetProfile%2CsummaryDetail%2CfinancialData%2Cprice`;
    const summaryRes = await fetch(summaryUrl, { headers });

    let name = meta?.longName || meta?.shortName || upper;
    let pe = null, forwardPE = null, dividendYield = null, beta = null;
    let marketCap = null, fiftyTwoWeekHigh = null, fiftyTwoWeekLow = null;
    let sector = null, industry = null, description = null;
    let employees = null, website = null;
    let profitMargin = null, returnOnEquity = null, revenueGrowth = null;

    if (summaryRes.ok) {
      const summaryData = await summaryRes.json();
      const r = summaryData?.quoteSummary?.result?.[0];
      if (r) {
        name = r.price?.longName || r.price?.shortName || name;
        pe = r.summaryDetail?.trailingPE?.raw?.toFixed(1) || null;
        forwardPE = r.summaryDetail?.forwardPE?.raw?.toFixed(1) || null;
        dividendYield = r.summaryDetail?.dividendYield?.raw
          ? (r.summaryDetail.dividendYield.raw * 100).toFixed(2) + '%' : null;
        beta = r.summaryDetail?.beta?.raw?.toFixed(2) || null;
        marketCap = r.price?.marketCap?.raw
          ? (r.price.marketCap.raw / 1e9).toFixed(1) + ' mrd' : null;
        fiftyTwoWeekHigh = r.summaryDetail?.fiftyTwoWeekHigh?.raw?.toFixed(2) || null;
        fiftyTwoWeekLow = r.summaryDetail?.fiftyTwoWeekLow?.raw?.toFixed(2) || null;
        sector = r.assetProfile?.sector || null;
        industry = r.assetProfile?.industry || null;
        description = r.assetProfile?.longBusinessSummary || null;
        employees = r.assetProfile?.fullTimeEmployees || null;
        website = r.assetProfile?.website || null;
        profitMargin = r.financialData?.profitMargins?.raw
          ? (r.financialData.profitMargins.raw * 100).toFixed(1) + '%' : null;
        returnOnEquity = r.financialData?.returnOnEquity?.raw
          ? (r.financialData.returnOnEquity.raw * 100).toFixed(1) + '%' : null;
        revenueGrowth = r.financialData?.revenueGrowth?.raw
          ? (r.financialData.revenueGrowth.raw * 100).toFixed(1) + '%' : null;
      }
    }

    res.status(200).json({
      ticker: upper,
      name,
      price: price.toFixed(2),
      currency: 'NOK',
      change: change.toFixed(2),
      changePct: changePct.toFixed(2),
      up: change >= 0,
      exchange: 'Oslo Børs',
      marketCap, pe, forwardPE, dividendYield, beta,
      fiftyTwoWeekHigh, fiftyTwoWeekLow,
      volume: meta?.regularMarketVolume?.toLocaleString('nb-NO') || null,
      sector, industry, description, website, employees,
      country: 'Norge',
      profitMargin, returnOnEquity, revenueGrowth,
    });

  } catch (err) {
    res.status(500).json({ error: 'Serverfeil', detail: err.message });
  }
}
