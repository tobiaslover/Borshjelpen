export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Ticker mangler' });

  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API-nøkkel mangler. Legg til TWELVE_DATA_API_KEY i Vercel Environment Variables.' });

  const symbol = ticker.toUpperCase();

  try {
    const [quoteRes, profileRes, statsRes] = await Promise.all([
      fetch(`https://api.twelvedata.com/quote?symbol=${symbol}&apikey=${apiKey}`),
      fetch(`https://api.twelvedata.com/profile?symbol=${symbol}&apikey=${apiKey}`),
      fetch(`https://api.twelvedata.com/statistics?symbol=${symbol}&apikey=${apiKey}`)
    ]);

    const quote = await quoteRes.json();
    const profile = profileRes.ok ? await profileRes.json() : {};
    const stats = statsRes.ok ? await statsRes.json() : {};

    if (quote.status === 'error' || quote.code === 400) {
      return res.status(404).json({ error: `Aksje "${symbol}" ikke funnet. Prøv f.eks. EQNR, DNB, TEL for Oslo Børs.` });
    }

    const price = parseFloat(quote.close || quote.price || 0);
    const prevClose = parseFloat(quote.previous_close || price);
    const change = price - prevClose;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;

    const s = stats?.statistics || {};
    const v = s?.valuations_metrics || {};
    const fin = s?.financials || {};
    const stock = s?.stock_statistics || {};

    res.status(200).json({
      ticker: symbol,
      name: quote.name || profile.name || symbol,
      price: price.toFixed(2),
      currency: quote.currency || 'NOK',
      change: change.toFixed(2),
      changePct: changePct.toFixed(2),
      up: change >= 0,
      exchange: quote.exchange || 'Oslo Børs',
      marketCap: stock.market_capitalization
        ? (stock.market_capitalization / 1e9).toFixed(1) + ' mrd'
        : null,
      pe: v.trailing_pe ? parseFloat(v.trailing_pe).toFixed(1) : null,
      forwardPE: v.forward_pe ? parseFloat(v.forward_pe).toFixed(1) : null,
      dividendYield: stock.five_year_average_dividend_yield
        ? parseFloat(stock.five_year_average_dividend_yield).toFixed(2) + '%'
        : null,
      beta: stock.beta ? parseFloat(stock.beta).toFixed(2) : null,
      fiftyTwoWeekHigh: stock['52_week_high']
        ? parseFloat(stock['52_week_high']).toFixed(2)
        : null,
      fiftyTwoWeekLow: stock['52_week_low']
        ? parseFloat(stock['52_week_low']).toFixed(2)
        : null,
      volume: quote.volume
        ? parseInt(quote.volume).toLocaleString('nb-NO')
        : null,
      sector: profile.sector || null,
      industry: profile.industry || null,
      description: profile.description || null,
      website: profile.website || null,
      employees: profile.employees || null,
      country: profile.country || null,
      profitMargin: fin.profit_margin
        ? (parseFloat(fin.profit_margin) * 100).toFixed(1) + '%'
        : null,
      returnOnEquity: fin.return_on_equity
        ? (parseFloat(fin.return_on_equity) * 100).toFixed(1) + '%'
        : null,
      revenueGrowth: fin.quarterly_revenue_growth
        ? (parseFloat(fin.quarterly_revenue_growth) * 100).toFixed(1) + '%'
        : null,
    });

  } catch (err) {
    res.status(500).json({ error: 'Serverfeil', detail: err.message });
  }
}
