export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'public, max-age=60');

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
    // Hent kurs fra Yahoo Finance (NOK) og fundamentals fra FMP parallelt
    const [yahooRes, fmpProfileRes, fmpRatiosRes] = await Promise.all([
      fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`, { headers }),
      fetch(`https://financialmodelingprep.com/api/v3/profile/${upper}?apikey=${apiKey}`),
      fetch(`https://financialmodelingprep.com/api/v3/ratios-ttm/${upper}?apikey=${apiKey}`),
    ]);

    if (!yahooRes.ok) {
      return res.status(404).json({ error: `Aksje "${upper}" ikke funnet. Prøv f.eks. EQNR, DNB, TEL, AKRBP, MOWI.` });
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

    // FMP fundamentals
    let sector = null, industry = null, beta = null, marketCap = null;
    let description = null, pe = null, dividendYield = null;
    let profitMargin = null, returnOnEquity = null;

    if (fmpProfileRes.ok) {
      try {
        const profileData = await fmpProfileRes.json();
        const profile = Array.isArray(profileData) ? profileData[0] : profileData;
        if (profile && !profile['Error Message']) {
          sector = profile.sector || null;
          industry = profile.industry || null;
          beta = profile.beta ? profile.beta.toFixed(2) : null;
          description = profile.description || null;
          pe = profile.pe ? profile.pe.toFixed(1) : null;

          // Markedsverdi i NOK (konverter fra USD via approximasjon)
          if (profile.mktCap) {
            const mc = profile.mktCap;
            marketCap = mc >= 1e12 ? (mc/1e12).toFixed(1) + ' tn USD' :
                        mc >= 1e9  ? (mc/1e9).toFixed(1) + ' mrd USD' :
                        mc >= 1e6  ? (mc/1e6).toFixed(0) + ' mill USD' : mc.toString();
          }

          if (profile.lastDiv && profile.price) {
            dividendYield = ((profile.lastDiv / profile.price) * 100).toFixed(2) + '%';
          }
        }
      } catch(e) { console.log('FMP profile error:', e.message); }
    }

    if (fmpRatiosRes.ok) {
      try {
        const ratiosData = await fmpRatiosRes.json();
        const ratios = Array.isArray(ratiosData) ? ratiosData[0] : ratiosData;
        if (ratios && !ratios['Error Message']) {
          profitMargin = ratios.netProfitMarginTTM ? (ratios.netProfitMarginTTM * 100).toFixed(1) + '%' : null;
          returnOnEquity = ratios.returnOnEquityTTM ? (ratios.returnOnEquityTTM * 100).toFixed(1) + '%' : null;
          if (!pe && ratios.peRatioTTM) pe = parseFloat(ratios.peRatioTTM).toFixed(1);
          if (!dividendYield && ratios.dividendYieldTTM) dividendYield = (ratios.dividendYieldTTM * 100).toFixed(2) + '%';
        }
      } catch(e) { console.log('FMP ratios error:', e.message); }
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
      beta,
      fiftyTwoWeekHigh: meta?.fiftyTwoWeekHigh?.toFixed(2) || null,
      fiftyTwoWeekLow: meta?.fiftyTwoWeekLow?.toFixed(2) || null,
      volume: meta?.regularMarketVolume?.toLocaleString('nb-NO') || null,
      sector,
      industry,
      profitMargin,
      returnOnEquity,
      description,
    });
  } catch (err) {
    console.error('stock error:', err.message);
    res.status(500).json({ error: 'Serverfeil', detail: err.message });
  }
}
