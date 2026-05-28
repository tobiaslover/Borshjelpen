export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Ticker mangler' });

  const upper = ticker.toUpperCase().replace('.OL','').replace(':OSE','');
  
  // Alltid bruk .OL for Oslo Børs — dette gir NOK-kurs
  const symbol = upper + '.OL';

  try {
    // Bruk quoteSummary direkte — gir mer pålitelig data enn chart
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=assetProfile,summaryDetail,defaultKeyStatistics,financialData,price`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
      }
    });

    if (!response.ok) {
      return res.status(404).json({ error: `Aksje "${upper}" ikke funnet på Oslo Børs. Prøv f.eks. EQNR, DNB, TEL, AKRBP, MOWI.` });
    }

    const data = await response.json();
    const r = data?.quoteSummary?.result?.[0];

    if (!r || !r.price) {
      return res.status(404).json({ error: `Aksje "${upper}" ikke funnet. Prøv f.eks. EQNR, DNB, TEL, AKRBP, MOWI.` });
    }

    const p = r.price;
    const detail = r.summaryDetail || {};
    const stats = r.defaultKeyStatistics || {};
    const fin = r.financialData || {};
    const profile = r.assetProfile || {};

    const price = p.regularMarketPrice?.raw || 0;
    const prevClose = p.regularMarketPreviousClose?.raw || price;
    const change = p.regularMarketChange?.raw || (price - prevClose);
    // Yahoo returnerer desimalformat: -0.0709 betyr -7.09% — multipliser med 100
    const changePct = p.regularMarketChangePercent?.raw != null
      ? p.regularMarketChangePercent.raw * 100
      : (prevClose ? (change / prevClose) * 100 : 0);

    // Valuta fra Yahoo — skal være NOK for .OL
    const currency = p.currency || 'NOK';

    res.status(200).json({
      ticker: upper,
      name: p.longName || p.shortName || upper,
      price: price.toFixed(2),
      currency,
      change: change.toFixed(2),
      changePct: changePct.toFixed(2),
      up: change >= 0,
      exchange: 'Oslo Børs',
      marketCap: p.marketCap?.raw
        ? (p.marketCap.raw / 1e9).toFixed(1) + ' mrd'
        : null,
      pe: detail.trailingPE?.raw?.toFixed(1) || null,
      forwardPE: detail.forwardPE?.raw?.toFixed(1) || null,
      dividendYield: detail.dividendYield?.raw
        ? (detail.dividendYield.raw * 100).toFixed(2) + '%'
        : null,
      beta: detail.beta?.raw?.toFixed(2) || null,
      fiftyTwoWeekHigh: detail.fiftyTwoWeekHigh?.raw?.toFixed(2) || null,
      fiftyTwoWeekLow: detail.fiftyTwoWeekLow?.raw?.toFixed(2) || null,
      volume: p.regularMarketVolume?.raw
        ? p.regularMarketVolume.raw.toLocaleString('nb-NO')
        : null,
      sector: profile.sector || null,
      industry: profile.industry || null,
      description: profile.longBusinessSummary || null,
      website: profile.website || null,
      employees: profile.fullTimeEmployees || null,
      country: 'Norge',
      profitMargin: fin.profitMargins?.raw
        ? (fin.profitMargins.raw * 100).toFixed(1) + '%'
        : null,
      returnOnEquity: fin.returnOnEquity?.raw
        ? (fin.returnOnEquity.raw * 100).toFixed(1) + '%'
        : null,
      revenueGrowth: fin.revenueGrowth?.raw
        ? (fin.revenueGrowth.raw * 100).toFixed(1) + '%'
        : null,
    });

  } catch (err) {
    res.status(500).json({ error: 'Serverfeil', detail: err.message });
  }
}
