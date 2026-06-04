export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'no-store');

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Ticker mangler' });

  const upper = ticker.toUpperCase().replace('.OL','').replace(':OSE','');
  const symbol = upper + '.OL';
  const apiKey = process.env.FMP_API_KEY;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
    'Referer': 'https://finance.yahoo.com/',
  };

  try {
    const [yahooRes, fmpProfileRes, fmpMetricsRes, fmpQuoteRes] = await Promise.all([
      fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`, { headers }),
      fetch(`https://financialmodelingprep.com/api/v3/profile/${upper}?apikey=${apiKey}`),
      fetch(`https://financialmodelingprep.com/stable/key-metrics-ttm?symbol=${upper}&apikey=${apiKey}`),
      fetch(`https://financialmodelingprep.com/api/v3/quote/${upper}?apikey=${apiKey}`),
    ]);

    if (!yahooRes.ok) {
      return res.status(404).json({ error: `Aksje "${upper}" ikke funnet.` });
    }

    const yahooData = await yahooRes.json();
    const result = yahooData?.chart?.result?.[0];
    const meta = result?.meta;
    const closes = (result?.indicators?.quote?.[0]?.close || []).filter(v => v != null);
    const price = meta?.regularMarketPrice || closes[closes.length - 1] || 0;
    const prevClose = closes[closes.length - 2] || price;
    const change = +(price - prevClose).toFixed(2);
    const changePct = prevClose ? +((change / prevClose) * 100).toFixed(2) : 0;
    const name = meta?.longName || meta?.shortName || upper;

    // Parse FMP
    const profileText = await fmpProfileRes.text();
    const metricsText = await fmpMetricsRes.text();
    const quoteText = await fmpQuoteRes.text();

    console.log('FMP profile:', fmpProfileRes.status, profileText.slice(0, 150));
    console.log('FMP metrics:', fmpMetricsRes.status, metricsText.slice(0, 150));
    console.log('FMP quote:', fmpQuoteRes.status, quoteText.slice(0, 150));

    let profile = null, metrics = null, quote = null;
    try { const p = JSON.parse(profileText); profile = Array.isArray(p) ? p[0] : p; } catch(e) {}
    try { const m = JSON.parse(metricsText); metrics = Array.isArray(m) ? m[0] : m; } catch(e) {}
    try { const q = JSON.parse(quoteText); quote = Array.isArray(q) ? q[0] : q; } catch(e) {}

    const pe = quote?.pe ? parseFloat(quote.pe).toFixed(1) :
               metrics?.peRatioTTM ? parseFloat(metrics.peRatioTTM).toFixed(1) : null;

    const dividendYield = metrics?.dividendYieldTTM ? (parseFloat(metrics.dividendYieldTTM) * 100).toFixed(2) + '%' :
                          (profile?.lastDiv && profile?.price) ? ((profile.lastDiv / profile.price) * 100).toFixed(2) + '%' : null;

    let marketCap = null;
    const mc = quote?.marketCap || profile?.mktCap;
    if (mc) {
      marketCap = mc >= 1e12 ? (mc/1e12).toFixed(1) + ' tn' :
                  mc >= 1e9  ? (mc/1e9).toFixed(1) + ' mrd' :
                  mc >= 1e6  ? (mc/1e6).toFixed(0) + ' mill' : String(mc);
    }

    res.status(200).json({
      ticker: upper,
      name,
      price: price.toFixed(2),
      currency: 'NOK',
      change: change.toFixed(2),
      changePct: Math.abs(changePct).toFixed(2),
      up: change >= 0,
      exchange: 'Oslo Børs',
      marketCap,
      pe,
      dividendYield,
      beta: profile?.beta ? parseFloat(profile.beta).toFixed(2) : null,
      fiftyTwoWeekHigh: meta?.fiftyTwoWeekHigh?.toFixed(2) || null,
      fiftyTwoWeekLow: meta?.fiftyTwoWeekLow?.toFixed(2) || null,
      volume: meta?.regularMarketVolume?.toLocaleString('nb-NO') || null,
      sector: profile?.sector || null,
      industry: profile?.industry || null,
      profitMargin: metrics?.netProfitMarginTTM ? (parseFloat(metrics.netProfitMarginTTM) * 100).toFixed(1) + '%' : null,
      returnOnEquity: metrics?.roeTTM ? (parseFloat(metrics.roeTTM) * 100).toFixed(1) + '%' : null,
      description: profile?.description || null,
    });
  } catch (err) {
    console.error('stock error:', err.message);
    res.status(500).json({ error: 'Serverfeil', detail: err.message });
  }
}
