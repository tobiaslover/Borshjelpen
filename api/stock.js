export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Ticker mangler' });

  const upper = ticker.toUpperCase().replace('.OL','').replace(':OSE','');
  const symbol = upper + '.OL';

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
      }
    });

    if (!response.ok) {
      return res.status(404).json({ error: `Aksje "${upper}" ikke funnet på Oslo Børs.` });
    }

    const data = await response.json();
    const result = data?.chart?.result?.[0];
    const meta = result?.meta;

    if (!meta || !meta.regularMarketPrice) {
      return res.status(404).json({ error: `Aksje "${upper}" ikke funnet. Prøv f.eks. EQNR, DNB, TEL, AKRBP, MOWI.` });
    }

    const price = meta.regularMarketPrice;
    
    // Bruk regularMarketPreviousClose som er gårsdagens sluttkurs — mest pålitelig
    const prevClose = meta.regularMarketPreviousClose 
      || meta.previousClose 
      || meta.chartPreviousClose 
      || price;
    
    const change = price - prevClose;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;

    // Hent ekstra info
    const quoteUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=assetProfile,summaryDetail,defaultKeyStatistics,financialData,price`;
    let profile = {};
    try {
      const qRes = await fetch(quoteUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (qRes.ok) {
        const qData = await qRes.json();
        const r = qData?.quoteSummary?.result?.[0];
        if (r) {
          profile = {
            name: r.price?.longName || r.price?.shortName || upper,
            sector: r.assetProfile?.sector || null,
            industry: r.assetProfile?.industry || null,
            description: r.assetProfile?.longBusinessSummary || null,
            employees: r.assetProfile?.fullTimeEmployees || null,
            website: r.assetProfile?.website || null,
            pe: r.summaryDetail?.trailingPE?.raw?.toFixed(1) || null,
            forwardPE: r.summaryDetail?.forwardPE?.raw?.toFixed(1) || null,
            dividendYield: r.summaryDetail?.dividendYield?.raw
              ? (r.summaryDetail.dividendYield.raw * 100).toFixed(2) + '%'
              : null,
            beta: r.summaryDetail?.beta?.raw?.toFixed(2) || null,
            marketCap: r.price?.marketCap?.raw
              ? (r.price.marketCap.raw / 1e9).toFixed(1) + ' mrd'
              : null,
            fiftyTwoWeekHigh: r.summaryDetail?.fiftyTwoWeekHigh?.raw?.toFixed(2) || null,
            fiftyTwoWeekLow: r.summaryDetail?.fiftyTwoWeekLow?.raw?.toFixed(2) || null,
            profitMargin: r.financialData?.profitMargins?.raw
              ? (r.financialData.profitMargins.raw * 100).toFixed(1) + '%'
              : null,
            returnOnEquity: r.financialData?.returnOnEquity?.raw
              ? (r.financialData.returnOnEquity.raw * 100).toFixed(1) + '%'
              : null,
            revenueGrowth: r.financialData?.revenueGrowth?.raw
              ? (r.financialData.revenueGrowth.raw * 100).toFixed(1) + '%'
              : null,
          };
        }
      }
    } catch(e) {}

    res.status(200).json({
      ticker: upper,
      name: profile.name || upper,
      price: price.toFixed(2),
      currency: 'NOK',
      change: change.toFixed(2),
      changePct: changePct.toFixed(2),
      up: change >= 0,
      exchange: 'Oslo Børs',
      marketCap: profile.marketCap || null,
      pe: profile.pe || null,
      forwardPE: profile.forwardPE || null,
      dividendYield: profile.dividendYield || null,
      beta: profile.beta || null,
      fiftyTwoWeekHigh: profile.fiftyTwoWeekHigh || null,
      fiftyTwoWeekLow: profile.fiftyTwoWeekLow || null,
      volume: meta.regularMarketVolume
        ? meta.regularMarketVolume.toLocaleString('nb-NO')
        : null,
      sector: profile.sector || null,
      industry: profile.industry || null,
      description: profile.description || null,
      website: profile.website || null,
      employees: profile.employees || null,
      country: 'Norge',
      profitMargin: profile.profitMargin || null,
      returnOnEquity: profile.returnOnEquity || null,
      revenueGrowth: profile.revenueGrowth || null,
    });

  } catch (err) {
    res.status(500).json({ error: 'Serverfeil', detail: err.message });
  }
}
