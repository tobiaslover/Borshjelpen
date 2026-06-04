export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'public, max-age=60');

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Ticker mangler' });

  const upper = ticker.toUpperCase().replace('.OL','').replace(':OSE','');
  const apiKey = process.env.FMP_API_KEY;

  try {
    // Hent kurs, profil og nøkkeltall parallelt
    const [quoteRes, profileRes, ratiosRes] = await Promise.all([
      fetch(`https://financialmodelingprep.com/api/v3/quote/${upper}?apikey=${apiKey}`),
      fetch(`https://financialmodelingprep.com/api/v3/profile/${upper}?apikey=${apiKey}`),
      fetch(`https://financialmodelingprep.com/api/v3/ratios-ttm/${upper}?apikey=${apiKey}`),
    ]);

    const [quoteData, profileData, ratiosData] = await Promise.all([
      quoteRes.json(),
      profileRes.json(),
      ratiosRes.json(),
    ]);

    const quote = Array.isArray(quoteData) ? quoteData[0] : quoteData;
    const profile = Array.isArray(profileData) ? profileData[0] : profileData;
    const ratios = Array.isArray(ratiosData) ? ratiosData[0] : ratiosData;

    if (!quote || quote['Error Message'] || !quote.price) {
      return res.status(404).json({ error: `Aksje "${upper}" ikke funnet. Prøv f.eks. EQNR, DNB, TEL, AKRBP, MOWI.` });
    }

    const price = quote.price || 0;
    const change = quote.change || 0;
    const changePct = quote.changesPercentage || 0;

    // Markedsverdi formatert
    let marketCap = null;
    if (quote.marketCap) {
      const mc = quote.marketCap;
      marketCap = mc >= 1e12 ? (mc/1e12).toFixed(1) + ' tn' :
                  mc >= 1e9  ? (mc/1e9).toFixed(1) + ' mrd' :
                  mc >= 1e6  ? (mc/1e6).toFixed(0) + ' mill' : mc.toString();
    }

    // Utbytte
    let dividendYield = null;
    if (profile?.lastDiv && price) {
      dividendYield = ((profile.lastDiv / price) * 100).toFixed(2) + '%';
    }

    res.status(200).json({
      ticker: upper,
      name: quote.name || profile?.companyName || upper,
      price: price.toFixed(2),
      currency: quote.currency || 'NOK',
      change: change.toFixed(2),
      changePct: Math.abs(changePct).toFixed(2),
      up: change >= 0,
      exchange: profile?.exchangeShortName || 'Oslo Børs',
      marketCap,
      pe: quote.pe ? quote.pe.toFixed(1) : null,
      dividendYield,
      beta: profile?.beta ? profile.beta.toFixed(2) : null,
      fiftyTwoWeekHigh: quote.yearHigh ? quote.yearHigh.toFixed(2) : null,
      fiftyTwoWeekLow: quote.yearLow ? quote.yearLow.toFixed(2) : null,
      volume: quote.volume ? quote.volume.toLocaleString('nb-NO') : null,
      sector: profile?.sector || null,
      industry: profile?.industry || null,
      profitMargin: ratios?.netProfitMarginTTM ? (ratios.netProfitMarginTTM * 100).toFixed(1) + '%' : null,
      returnOnEquity: ratios?.returnOnEquityTTM ? (ratios.returnOnEquityTTM * 100).toFixed(1) + '%' : null,
      description: profile?.description || null,
    });
  } catch (err) {
    console.error('stock error:', err.message);
    res.status(500).json({ error: 'Serverfeil', detail: err.message });
  }
}
