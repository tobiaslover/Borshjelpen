export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Ticker mangler' });

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'FMP_API_KEY mangler' });

  const upper = ticker.toUpperCase().replace('.OL','').replace(':OSE','');
  const symbol = upper + '.OL';

  try {
    // Hent kurs, profil og nøkkeltall parallelt
    const [quoteRes, profileRes, metricsRes] = await Promise.all([
      fetch(`https://financialmodelingprep.com/api/v3/quote/${symbol}?apikey=${apiKey}`),
      fetch(`https://financialmodelingprep.com/api/v3/profile/${symbol}?apikey=${apiKey}`),
      fetch(`https://financialmodelingprep.com/api/v3/key-metrics-ttm/${symbol}?apikey=${apiKey}`)
    ]);

    const [quoteData, profileData, metricsData] = await Promise.all([
      quoteRes.json(),
      profileRes.json(),
      metricsRes.json()
    ]);

    const q = Array.isArray(quoteData) ? quoteData[0] : null;
    const p = Array.isArray(profileData) ? profileData[0] : null;
    const m = Array.isArray(metricsData) ? metricsData[0] : null;

    if (!q) {
      return res.status(404).json({ error: `Aksje "${upper}" ikke funnet. Prøv f.eks. EQNR, DNB, TEL, AKRBP, MOWI.` });
    }

    const price = q.price || 0;
    const change = q.change || 0;
    const changePct = q.changesPercentage || 0;

    // Formater markedsverdi
    function formatMktCap(val) {
      if (!val) return null;
      if (val >= 1e12) return (val / 1e12).toFixed(1) + ' billion NOK';
      if (val >= 1e9) return (val / 1e9).toFixed(1) + ' mrd NOK';
      if (val >= 1e6) return (val / 1e6).toFixed(0) + ' mill NOK';
      return val.toLocaleString('nb-NO') + ' NOK';
    }

    // Formater prosent
    function fmtPct(val) {
      if (val == null) return null;
      return (val * 100).toFixed(1) + '%';
    }

    res.status(200).json({
      ticker: upper,
      name: q.name || p?.companyName || upper,
      price: price.toFixed(2),
      currency: 'NOK',
      change: change.toFixed(2),
      changePct: Math.abs(changePct).toFixed(2),
      up: change >= 0,
      exchange: 'Oslo Børs',
      marketCap: formatMktCap(q.marketCap),
      pe: q.pe ? q.pe.toFixed(1) : null,
      forwardPE: null,
      dividendYield: p?.lastDiv ? (p.lastDiv / price * 100).toFixed(1) + '%' : null,
      beta: p?.beta ? p.beta.toFixed(2) : null,
      fiftyTwoWeekHigh: q.yearHigh ? q.yearHigh.toFixed(2) : null,
      fiftyTwoWeekLow: q.yearLow ? q.yearLow.toFixed(2) : null,
      volume: q.volume ? q.volume.toLocaleString('nb-NO') : null,
      sector: p?.sector || null,
      industry: p?.industry || null,
      description: p?.description || null,
      website: p?.website || null,
      employees: p?.fullTimeEmployees || null,
      country: p?.country || 'Norge',
      profitMargin: m?.netProfitMarginTTM ? fmtPct(m.netProfitMarginTTM) : null,
      returnOnEquity: m?.roeTTM ? fmtPct(m.roeTTM) : null,
      revenueGrowth: null,
      eps: q.eps ? q.eps.toFixed(2) : null,
      avgVolume: q.avgVolume ? q.avgVolume.toLocaleString('nb-NO') : null,
      open: q.open ? q.open.toFixed(2) : null,
      previousClose: q.previousClose ? q.previousClose.toFixed(2) : null,
    });

  } catch (err) {
    res.status(500).json({ error: 'Serverfeil', detail: err.message });
  }
}
