export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Ticker mangler' });

  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'TWELVE_DATA_API_KEY mangler.' });

  const upper = ticker.toUpperCase().replace('.OL', '').replace(':OSE', '');

  // Twelve Data bruker symbol:OSE for Oslo Børs
  const symbol = `${upper}:OSE`;

  try {
    const [quoteRes, profileRes] = await Promise.all([
      fetch(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`),
      fetch(`https://api.twelvedata.com/profile?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`)
    ]);

    const quote = await quoteRes.json();
    const profile = profileRes.ok ? await profileRes.json() : {};

    if (quote.status === 'error' || quote.code === 400 || !quote.close) {
      return res.status(404).json({ 
        error: `Aksje "${upper}" ikke funnet på Oslo Børs. Prøv f.eks. EQNR, DNB, TEL, AKRBP, MOWI.` 
      });
    }

    const price = parseFloat(quote.close || 0);
    const prevClose = parseFloat(quote.previous_close || price);
    const change = price - prevClose;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;

    res.status(200).json({
      ticker: upper,
      name: quote.name || profile.name || upper,
      price: price.toFixed(2),
      currency: 'NOK',
      change: change.toFixed(2),
      changePct: changePct.toFixed(2),
      up: change >= 0,
      exchange: 'Oslo Børs',
      marketCap: null,
      pe: quote.pe || null,
      forwardPE: null,
      dividendYield: null,
      beta: null,
      fiftyTwoWeekHigh: quote['52_week']['high'] || null,
      fiftyTwoWeekLow: quote['52_week']['low'] || null,
      volume: quote.volume ? parseInt(quote.volume).toLocaleString('nb-NO') : null,
      sector: profile.sector || null,
      industry: profile.industry || null,
      description: profile.description || null,
      website: profile.website || null,
      employees: profile.employees || null,
      country: 'Norge',
      profitMargin: null,
      returnOnEquity: null,
      revenueGrowth: null,
    });

  } catch (err) {
    res.status(500).json({ error: 'Serverfeil', detail: err.message });
  }
}
