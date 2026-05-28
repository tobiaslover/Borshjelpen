export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Ticker mangler' });

  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'TWELVE_DATA_API_KEY mangler i Vercel Environment Variables.' });

  // Legg til .OL automatisk for Oslo Børs hvis ikke allerede spesifisert
  const upper = ticker.toUpperCase();
  const symbol = upper.includes('.') ? upper : upper + '.OL';

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
      // Prøv uten .OL hvis Oslo Børs feiler
      const retryRes = await fetch(`https://api.twelvedata.com/quote?symbol=${upper}&apikey=${apiKey}`);
      const retryData = await retryRes.json();
      if (retryData.status === 'error') {
        return res.status(404).json({ error: `Aksje "${upper}" ikke funnet. Prøv f.eks. EQNR, DNB, TEL.` });
      }
    }

    const price = parseFloat(quote.close || quote.price || 0);
    const prevClose = parseFloat(quote.previous_close || price);
    const change = price - prevClose;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;

    // Sett valuta til NOK for Oslo Børs
    const currency = symbol.endsWith('.OL') ? 'NOK' : (quote.currency || 'USD');

    const s = stats?.statistics || {};
    const v = s?.valuations_metrics || {};
    const fin = s?.financials || {};
    const stock = s?.stock_statistics || {};

    res.status(200).json({
      ticker: symbol,
      name: quote.name || profile.name || symbol.replace('.OL', ''),
      price: price.toFixed(2),
      currency,
      change: change.toFixed(2),
      changePct: changePct.toFixed(2),
      up: change >= 0,
      exchange: symbol.endsWith('.OL') ? 'Oslo Børs' : (quote.exchange || 'N/A'),
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
      country: profile.country || 'Norge',
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
