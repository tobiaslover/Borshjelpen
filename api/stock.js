export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'public, max-age=60');

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Ticker mangler' });

  const upper = ticker.toUpperCase().replace('.OL', '').replace(':OSE', '');
  const olSymbol = upper + '.OL';
  const apiKey = process.env.FMP_API_KEY;

  try {
    // Kurs OG nøkkeltall hentes nå fra FMP (lisensiert kilde). Oslo Børs-aksjer
    // med .OL-suffiks prises nativt i NOK — ingen valutakonvertering nødvendig.
    const [quoteRes, profileRes, metricsRes, ratiosRes, incomeRes] = await Promise.all([
      fetch(`https://financialmodelingprep.com/stable/quote?symbol=${olSymbol}&apikey=${apiKey}`),
      fetch(`https://financialmodelingprep.com/stable/profile?symbol=${olSymbol}&apikey=${apiKey}`),
      fetch(`https://financialmodelingprep.com/stable/key-metrics-ttm?symbol=${olSymbol}&apikey=${apiKey}`),
      fetch(`https://financialmodelingprep.com/stable/ratios-ttm?symbol=${olSymbol}&apikey=${apiKey}`),
      fetch(`https://financialmodelingprep.com/stable/income-statement?symbol=${olSymbol}&limit=1&apikey=${apiKey}`),
    ]);

    let quote = null, profile = null, metrics = null, ratios = null, income = null;
    if (quoteRes.ok) { try { const d = await quoteRes.json(); quote = Array.isArray(d) ? d[0] : d; } catch(e) {} }
    if (profileRes.ok) { try { const d = await profileRes.json(); profile = Array.isArray(d) ? d[0] : d; } catch(e) {} }
    if (metricsRes.ok) { try { const d = await metricsRes.json(); metrics = Array.isArray(d) ? d[0] : d; } catch(e) {} }
    if (ratiosRes.ok) { try { const d = await ratiosRes.json(); ratios = Array.isArray(d) ? d[0] : d; } catch(e) {} }
    if (incomeRes.ok) { try { const d = await incomeRes.json(); income = Array.isArray(d) ? d[0] : d; } catch(e) {} }

    if (!quote || quote.price == null) {
      return res.status(404).json({ error: `Aksje "${upper}" ikke funnet. Prøv f.eks. EQNR, DNB, TEL, AKRBP, MOWI.` });
    }

    const price = Number(quote.price) || 0;
    const change = quote.change != null ? +Number(quote.change).toFixed(2) : 0;
    const changePct = quote.changePercentage != null ? +Number(quote.changePercentage).toFixed(2) : 0;
    const name = quote.name || profile?.companyName || upper;

    // Kursvaluta = handelsvaluta for noteringen (NOK for .OL).
    const priceCurrency = profile?.currency || 'NOK';
    // Regnskapsvaluta kan avvike (enkelte shipping/energi-selskaper rapporterer i USD).
    const reportCurrency = income?.reportedCurrency || priceCurrency;

    function fmtMoney(val, currency) {
      if (val == null || isNaN(val)) return null;
      const abs = Math.abs(val);
      const sign = val < 0 ? '-' : '';
      if (abs >= 1e12) return sign + (abs/1e12).toFixed(1) + ' tn ' + currency;
      if (abs >= 1e9) return sign + (abs/1e9).toFixed(1) + ' mrd ' + currency;
      if (abs >= 1e6) return sign + (abs/1e6).toFixed(0) + ' mill ' + currency;
      return sign + Number(val).toLocaleString('nb-NO') + ' ' + currency;
    }

    // P/E
    let pe = null;
    if (ratios?.peRatioTTM) pe = parseFloat(ratios.peRatioTTM).toFixed(1);
    else if (metrics?.earningsYieldTTM && metrics.earningsYieldTTM > 0) pe = (1 / metrics.earningsYieldTTM).toFixed(1);

    // Utbytteyield (prosent — valutauavhengig)
    let dividendYield = null;
    if (ratios?.dividendYieldTTM) dividendYield = (parseFloat(ratios.dividendYieldTTM) * 100).toFixed(2) + '%';
    else if (profile?.lastDiv && price) dividendYield = ((profile.lastDiv / price) * 100).toFixed(2) + '%';

    // Markedsverdi (prisbasert → kursvaluta)
    let marketCap = null;
    const mc = quote?.marketCap || metrics?.marketCap || profile?.marketCap;
    if (mc) marketCap = fmtMoney(mc, priceCurrency);

    // P/B
    let pb = null;
    if (ratios?.priceToBookRatioTTM) pb = parseFloat(ratios.priceToBookRatioTTM).toFixed(1);

    // EPS (regnskapsvaluta)
    let eps = null;
    if (income?.eps != null) eps = parseFloat(income.eps).toFixed(2) + ' ' + reportCurrency;

    // Omsetning (regnskapsvaluta)
    let revenue = null;
    if (income?.revenue) revenue = fmtMoney(income.revenue, reportCurrency);

    // EBIT (regnskapsvaluta)
    let ebit = null;
    if (income?.operatingIncome) ebit = fmtMoney(income.operatingIncome, reportCurrency);

    // Utbytte per aksje (utbetales i kursvaluta)
    let dividendPerShare = null;
    if (profile?.lastDiv) dividendPerShare = parseFloat(profile.lastDiv).toFixed(2) + ' ' + priceCurrency;

    res.status(200).json({
      ticker: upper,
      name,
      price: price.toFixed(2),
      currency: priceCurrency,
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
      fiftyTwoWeekHigh: quote?.yearHigh != null ? Number(quote.yearHigh).toFixed(2) : null,
      fiftyTwoWeekLow: quote?.yearLow != null ? Number(quote.yearLow).toFixed(2) : null,
      volume: quote?.volume != null ? Number(quote.volume).toLocaleString('nb-NO') : null,
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
