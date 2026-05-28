export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Ticker mangler' });

  const upper = ticker.toUpperCase().replace('.OL','').replace(':OSE','');
  const symbol = upper + '.OL';

  try {
    // Steg 1: Hent crumb og cookies fra Yahoo Finance
    const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/csrfToken', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Referer': 'https://finance.yahoo.com/',
      }
    });

    const cookies = crumbRes.headers.get('set-cookie') || '';
    const crumbData = await crumbRes.text();
    const crumb = crumbData?.trim() || '';

    // Steg 2: Hent aksjedata med crumb
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=assetProfile,summaryDetail,defaultKeyStatistics,financialData,price&crumb=${encodeURIComponent(crumb)}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://finance.yahoo.com/',
        'Cookie': cookies,
      }
    });

    if (!response.ok) {
      // Fallback: prøv chart API
      const chartUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`;
      const chartRes = await fetch(chartUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://finance.yahoo.com/',
          'Cookie': cookies,
        }
      });

      if (!chartRes.ok) {
        return res.status(404).json({ 
          error: `Aksje "${upper}" ikke funnet. Prøv f.eks. EQNR, DNB, TEL, AKRBP, MOWI.`,
          debug: { status: response.status, chartStatus: chartRes.status }
        });
      }

      const chartData = await chartRes.json();
      const meta = chartData?.chart?.result?.[0]?.meta;

      if (!meta?.regularMarketPrice) {
        return res.status(404).json({ error: `Ingen kursdata funnet for "${upper}".` });
      }

      const price = meta.regularMarketPrice;
      const prevClose = meta.regularMarketPreviousClose || meta.chartPreviousClose || price;
      const change = price - prevClose;
      const changePct = prevClose ? (change / prevClose) * 100 : 0;

      return res.status(200).json({
        ticker: upper,
        name: meta.longName || meta.shortName || upper,
        price: price.toFixed(2),
        currency: 'NOK',
        change: change.toFixed(2),
        changePct: changePct.toFixed(2),
        up: change >= 0,
        exchange: 'Oslo Børs',
        marketCap: null, pe: null, forwardPE: null,
        dividendYield: null, beta: null,
        fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh?.toFixed(2) || null,
        fiftyTwoWeekLow: meta.fiftyTwoWeekLow?.toFixed(2) || null,
        volume: meta.regularMarketVolume?.toLocaleString('nb-NO') || null,
        sector: null, industry: null, description: null,
        website: null, employees: null, country: 'Norge',
        profitMargin: null, returnOnEquity: null, revenueGrowth: null,
      });
    }

    const data = await response.json();
    const r = data?.quoteSummary?.result?.[0];

    if (!r || !r.price) {
      return res.status(404).json({ 
        error: `Aksje "${upper}" ikke funnet. Prøv f.eks. EQNR, DNB, TEL, AKRBP, MOWI.`
      });
    }

    const p = r.price;
    const detail = r.summaryDetail || {};
    const fin = r.financialData || {};
    const profile = r.assetProfile || {};

    const price = p.regularMarketPrice?.raw || 0;
    const prevClose = p.regularMarketPreviousClose?.raw || price;
    const change = p.regularMarketChange?.raw || (price - prevClose);
    // Yahoo returnerer f.eks. 0.0009 for 0.09% — ikke gang med 100
    const changePct = p.regularMarketChangePercent?.raw != null
      ? p.regularMarketChangePercent.raw
      : (prevClose ? (change / prevClose) * 100 : 0);

    res.status(200).json({
      ticker: upper,
      name: p.longName || p.shortName || upper,
      price: price.toFixed(2),
      currency: 'NOK',
      change: change.toFixed(2),
      changePct: changePct.toFixed(2),
      up: change >= 0,
      exchange: 'Oslo Børs',
      marketCap: p.marketCap?.raw ? (p.marketCap.raw / 1e9).toFixed(1) + ' mrd' : null,
      pe: detail.trailingPE?.raw?.toFixed(1) || null,
      forwardPE: detail.forwardPE?.raw?.toFixed(1) || null,
      dividendYield: detail.dividendYield?.raw ? (detail.dividendYield.raw * 100).toFixed(2) + '%' : null,
      beta: detail.beta?.raw?.toFixed(2) || null,
      fiftyTwoWeekHigh: detail.fiftyTwoWeekHigh?.raw?.toFixed(2) || null,
      fiftyTwoWeekLow: detail.fiftyTwoWeekLow?.raw?.toFixed(2) || null,
      volume: p.regularMarketVolume?.raw?.toLocaleString('nb-NO') || null,
      sector: profile.sector || null,
      industry: profile.industry || null,
      description: profile.longBusinessSummary || null,
      website: profile.website || null,
      employees: profile.fullTimeEmployees || null,
      country: 'Norge',
      profitMargin: fin.profitMargins?.raw ? (fin.profitMargins.raw * 100).toFixed(1) + '%' : null,
      returnOnEquity: fin.returnOnEquity?.raw ? (fin.returnOnEquity.raw * 100).toFixed(1) + '%' : null,
      revenueGrowth: fin.revenueGrowth?.raw ? (fin.revenueGrowth.raw * 100).toFixed(1) + '%' : null,
    });

  } catch (err) {
    res.status(500).json({ error: 'Serverfeil', detail: err.message });
  }
}
