export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'public, max-age=60');

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Ticker mangler' });

  const upper = ticker.toUpperCase().replace('.OL','').replace(':OSE','');
  const olSymbol = upper + '.OL';
  const apiKey = process.env.FMP_API_KEY;

  const yHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
    'Referer': 'https://finance.yahoo.com/',
  };

  try {
    const [yahooRes, profileRes, metricsRes, ratiosRes, incomeRes] = await Promise.all([
      fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${olSymbol}?interval=1d&range=5d`, { headers: yHeaders }),
      fetch(`https://financialmodelingprep.com/stable/profile?symbol=${olSymbol}&apikey=${apiKey}`),
      fetch(`https://financialmodelingprep.com/stable/key-metrics-ttm?symbol=${olSymbol}&apikey=${apiKey}`),
      fetch(`https://financialmodelingprep.com/stable/ratios-ttm?symbol=${olSymbol}&apikey=${apiKey}`),
      fetch(`https://financialmodelingprep.com/stable/income-statement?symbol=${olSymbol}&limit=1&apikey=${apiKey}`),
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

    let profile = null, metrics = null, ratios = null, income = null;
    if (profileRes.ok) { try { const d = await profileRes.json(); profile = Array.isArray(d) ? d[0] : d; } catch(e) {} }
    if (metricsRes.ok) { try { const d = await metricsRes.json(); metrics = Array.isArray(d) ? d[0] : d; } catch(e) {} }
    if (ratiosRes.ok) { try { const d = await ratiosRes.json(); ratios = Array.isArray(d) ? d[0] : d; } catch(e) {} }
    if (incomeRes.ok) { try { const d = await incomeRes.json(); income = Array.isArray(d) ? d[0] : d; } catch(e) {} }

    // Selskaper som rapporterer i USD
    const USD_SECTORS = ['Shipping', 'Energy', 'Oil', 'Gas', 'Offshore'];
    const USD_TICKERS = [
      'FRONTLINE','GOGL','BWLPG','MPCC','BELCO','FLNG','SDRL','SIEM','2020BULKERS',
      'EQNR','AKRBP','OKEA','SUBC','TGS','AKSO','VAR','BORR','PGS','TDW'
    ];
    const sector = profile?.sector || '';
    const isUSD = USD_TICKERS.includes(upper) ||
                  USD_SECTORS.some(s => sector.toLowerCase().includes(s.toLowerCase()));
    const reportCurrency = isUSD ? 'USD' : 'NOK';

    function fmtMoney(val, currency) {
      if (!val) return null;
      const abs = Math.abs(val);
      const sign = val < 0 ? '-' : '';
      if (abs >= 1e12) return sign + (abs/1e12).toFixed(1) + ' tn ' + currency;
      if (abs >= 1e9) return sign + (abs/1e9).toFixed(1) + ' mrd ' + currency;
      if (abs >= 1e6) return sign + (abs/1e6).toFixed(0) + ' mill ' + currency;
      return sign + val.toLocaleString('nb-NO') + ' ' + currency;
    }

    // Alias for bakoverkompatibilitet
    function fmtUSD(val) { return fmtMoney(val, reportCurrency); }

    // P/E
    let pe = null;
    if (ratios?.peRatioTTM) pe = parseFloat(ratios.peRatioTTM).toFixed(1);
    else if (metrics?.earningsYieldTTM && metrics.earningsYieldTTM > 0) pe = (1 / metrics.earningsYieldTTM).toFixed(1);

    // Utbytteyield
    let dividendYield = null;
    if (ratios?.dividendYieldTTM) dividendYield = (parseFloat(ratios.dividendYieldTTM) * 100).toFixed(2) + '%';
    else if (profile?.lastDiv && profile?.price) dividendYield = ((profile.lastDiv / profile.price) * 100).toFixed(2) + '%';

    // Markedsverdi
    let marketCap = null;
    const mc = metrics?.marketCap || profile?.marketCap;
    if (mc) marketCap = fmtUSD(mc);

    // P/B
    let pb = null;
    if (ratios?.priceToBookRatioTTM) pb = parseFloat(ratios.priceToBookRatioTTM).toFixed(1);

    // EPS (siste år)
    let eps = null;
    if (income?.eps) eps = parseFloat(income.eps).toFixed(2) + ' USD';

    // Omsetning
    let revenue = null;
    if (income?.revenue) revenue = fmtUSD(income.revenue);

    // EBIT
    let ebit = null;
    if (income?.operatingIncome) ebit = fmtUSD(income.operatingIncome);

    // Utbytte per aksje
    let dividendPerShare = null;
    if (profile?.lastDiv) dividendPerShare = parseFloat(profile.lastDiv).toFixed(2) + ' USD';

    res.status(200).json({
      ticker: upper,
      name,
      price: price.toFixed(2),
      currency: 'NOK',
      change: change.toFixed(2),
      changePct: Math.abs(changePct).toFixed(2),
      up: change >= 0,
      exchange: 'Oslo Børs',
      // Nøkkeltall
      marketCap,
      revenue,
      ebit,
      eps,
      dividendPerShare,
      dividendYield,
      pe,
      pb,
      beta: profile?.beta ? parseFloat(profile.beta).toFixed(2) : null,
      // 52-ukers
      fiftyTwoWeekHigh: meta?.fiftyTwoWeekHigh?.toFixed(2) || null,
      fiftyTwoWeekLow: meta?.fiftyTwoWeekLow?.toFixed(2) || null,
      volume: meta?.regularMarketVolume?.toLocaleString('nb-NO') || null,
      // Ekstra
      sector: profile?.sector || null,
      industry: profile?.industry || null,
      description: profile?.description || null,
      reportCurrency,
      profitMargin: ratios?.netProfitMarginTTM ? (parseFloat(ratios.netProfitMarginTTM) * 100).toFixed(1) + '%' : null,
      returnOnEquity: metrics?.returnOnEquityTTM ? (parseFloat(metrics.returnOnEquityTTM) * 100).toFixed(1) + '%' : null,
      evEbitda: metrics?.evToEBITDATTM ? parseFloat(metrics.evToEBITDATTM).toFixed(1) : null,
      fcfYield: metrics?.freeCashFlowYieldTTM ? (parseFloat(metrics.freeCashFlowYieldTTM) * 100).toFixed(1) + '%' : null,
      debtEquity: ratios?.debtEquityRatioTTM ? parseFloat(ratios.debtEquityRatioTTM).toFixed(2) : null,
    });
  } catch (err) {
    console.error('stock error:', err.message);
    res.status(500).json({ error: 'Serverfeil', detail: err.message });
  }
}
