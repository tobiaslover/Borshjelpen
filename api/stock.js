export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Ticker mangler' });

  const upper = ticker.toUpperCase().replace('.OL','').replace(':OSE','');
  const symbol = upper + '.OL';

  try {
    // Hent 5-dagers chart med daglig intervall — gir navn og pålitelige tall
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://finance.yahoo.com/',
      }
    });

    if (!response.ok) {
      return res.status(404).json({ error: `Aksje "${upper}" ikke funnet. Prøv f.eks. EQNR, DNB, TEL, AKRBP, MOWI.` });
    }

    const data = await response.json();
    const result = data?.chart?.result?.[0];
    const meta = result?.meta;

    if (!meta?.regularMarketPrice) {
      return res.status(404).json({ error: `Ingen data funnet for "${upper}".` });
    }

    const price = meta.regularMarketPrice;
    
    // Bruk regularMarketPreviousClose for endring — dette er gårsdagens sluttkurs
    // og er det alle finanssider bruker for daglig endring
    const prevClose = meta.regularMarketPreviousClose || meta.chartPreviousClose || price;
    const change = price - prevClose;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;

    // Hent selskapsnavn fra longName i meta
    const name = meta.longName || meta.shortName || meta.symbol || upper;

    // Hent ekstra detaljer
    const profileUrl = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=assetProfile,summaryDetail,financialData,price`;
    let extra = {};
    try {
      const pRes = await fetch(profileUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://finance.yahoo.com/',
        }
      });
      if (pRes.ok) {
        const pData = await pRes.json();
        const r = pData?.quoteSummary?.result?.[0];
        if (r) {
          extra = {
            name: r.price?.longName || r.price?.shortName || name,
            sector: r.assetProfile?.sector || null,
            industry: r.assetProfile?.industry || null,
            description: r.assetProfile?.longBusinessSummary || null,
            employees: r.assetProfile?.fullTimeEmployees || null,
            website: r.assetProfile?.website || null,
            pe: r.summaryDetail?.trailingPE?.raw?.toFixed(1) || null,
            forwardPE: r.summaryDetail?.forwardPE?.raw?.toFixed(1) || null,
            dividendYield: r.summaryDetail?.dividendYield?.raw
              ? (r.summaryDetail.dividendYield.raw * 100).toFixed(2) + '%' : null,
            beta: r.summaryDetail?.beta?.raw?.toFixed(2) || null,
            marketCap: r.price?.marketCap?.raw
              ? (r.price.marketCap.raw / 1e9).toFixed(1) + ' mrd' : null,
            fiftyTwoWeekHigh: r.summaryDetail?.fiftyTwoWeekHigh?.raw?.toFixed(2) || null,
            fiftyTwoWeekLow: r.summaryDetail?.fiftyTwoWeekLow?.raw?.toFixed(2) || null,
            profitMargin: r.financialData?.profitMargins?.raw
              ? (r.financialData.profitMargins.raw * 100).toFixed(1) + '%' : null,
            returnOnEquity: r.financialData?.returnOnEquity?.raw
              ? (r.financialData.returnOnEquity.raw * 100).toFixed(1) + '%' : null,
            revenueGrowth: r.financialData?.revenueGrowth?.raw
              ? (r.financialData.revenueGrowth.raw * 100).toFixed(1) + '%' : null,
          };
        }
      }
    } catch(e) {}

    res.status(200).json({
      ticker: upper,
      name: extra.name || name,
      price: price.toFixed(2),
      currency: 'NOK',
      change: change.toFixed(2),
      changePct: changePct.toFixed(2),
      up: change >= 0,
      exchange: 'Oslo Børs',
      marketCap: extra.marketCap || null,
      pe: extra.pe || null,
      forwardPE: extra.forwardPE || null,
      dividendYield: extra.dividendYield || null,
      beta: extra.beta || null,
      fiftyTwoWeekHigh: extra.fiftyTwoWeekHigh || null,
      fiftyTwoWeekLow: extra.fiftyTwoWeekLow || null,
      volume: meta.regularMarketVolume?.toLocaleString('nb-NO') || null,
      sector: extra.sector || null,
      industry: extra.industry || null,
      description: extra.description || null,
      website: extra.website || null,
      employees: extra.employees || null,
      country: 'Norge',
      profitMargin: extra.profitMargin || null,
      returnOnEquity: extra.returnOnEquity || null,
      revenueGrowth: extra.revenueGrowth || null,
    });

  } catch (err) {
    res.status(500).json({ error: 'Serverfeil', detail: err.message });
  }
}
