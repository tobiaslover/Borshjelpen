export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Ticker mangler' });

  const upper = ticker.toUpperCase().replace('.OL','').replace(':OSE','');
  const symbol = upper + '.OL';

  try {
    // Bruk chart API med 1-dags data — gir oss åpning og nåværende kurs
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://finance.yahoo.com/',
        'Origin': 'https://finance.yahoo.com',
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ 
        error: `Aksje "${upper}" ikke funnet. Prøv f.eks. EQNR, DNB, TEL, AKRBP, MOWI.`
      });
    }

    const data = await response.json();
    const result = data?.chart?.result?.[0];
    const meta = result?.meta;

    if (!meta) {
      return res.status(404).json({ error: `Ingen data funnet for "${upper}".` });
    }

    // Hent alle kursdata fra meta
    const price = meta.regularMarketPrice || 0;
    const openPrice = meta.regularMarketDayHigh && meta.regularMarketDayLow
      ? null // bruker første datapunkt i stedet
      : null;

    // Første datapunkt i serien = åpningskurs
    const closes = result?.indicators?.quote?.[0]?.close || [];
    const firstClose = closes.find(v => v !== null && v !== undefined);
    const lastClose = [...closes].reverse().find(v => v !== null && v !== undefined);

    const open = meta.chartPreviousClose
      ? firstClose || price
      : firstClose || price;

    // Bruk første gyldige kurs som åpning, siste som nåværende
    const change = lastClose && firstClose ? lastClose - firstClose : 0;
    const changePct = firstClose && firstClose !== 0 ? (change / firstClose) * 100 : 0;

    // Hent selskapsnavn og mer info
    const profileUrl = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=assetProfile,summaryDetail,financialData,price`;
    let profile = {};
    try {
      const pRes = await fetch(profileUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://finance.yahoo.com/',
        }
      });
      if (pRes.ok) {
        const pData = await pRes.json();
        const r = pData?.quoteSummary?.result?.[0];
        if (r) {
          profile = {
            name: r.price?.longName || r.price?.shortName || upper,
            sector: r.assetProfile?.sector || null,
            industry: r.assetProfile?.industry || null,
            description: r.assetProfile?.longBusinessSummary || null,
            employees: r.assetProfile?.fullTimeEmployees || null,
            website: r.assetProfile?.website || null,
            pe: r.summaryDetail?.trailingPE?.raw?.toFixed(1) || null,
            forwardPE: r.summaryDetail?.forwardPE?.raw?.toFixed(1) || null,
            dividendYield: r.summaryDetail?.dividendYield?.raw
              ? (r.summaryDetail.dividendYield.raw * 100).toFixed(2) + '%' : null,
            beta: r.summaryDetail?.beta?.raw?.toFixed(2) || null,
            marketCap: r.price?.marketCap?.raw
              ? (r.price.marketCap.raw / 1e9).toFixed(1) + ' mrd' : null,
            fiftyTwoWeekHigh: r.summaryDetail?.fiftyTwoWeekHigh?.raw?.toFixed(2) || null,
            fiftyTwoWeekLow: r.summaryDetail?.fiftyTwoWeekLow?.raw?.toFixed(2) || null,
            profitMargin: r.financialData?.profitMargins?.raw
              ? (r.financialData.profitMargins.raw * 100).toFixed(1) + '%' : null,
            returnOnEquity: r.financialData?.returnOnEquity?.raw
              ? (r.financialData.returnOnEquity.raw * 100).toFixed(1) + '%' : null,
            revenueGrowth: r.financialData?.revenueGrowth?.raw
              ? (r.financialData.revenueGrowth.raw * 100).toFixed(1) + '%' : null,
          };
        }
      }
    } catch(e) {}

    res.status(200).json({
      ticker: upper,
      name: profile.name || meta.instrumentType || upper,
      price: price.toFixed(2),
      currency: 'NOK',
      change: change.toFixed(2),
      changePct: changePct.toFixed(2),
      up: change >= 0,
      exchange: 'Oslo Børs',
      marketCap: profile.marketCap || null,
      pe: profile.pe || null,
      forwardPE: profile.forwardPE || null,
      dividendYield: profile.dividendYield || null,
      beta: profile.beta || null,
      fiftyTwoWeekHigh: profile.fiftyTwoWeekHigh || null,
      fiftyTwoWeekLow: profile.fiftyTwoWeekLow || null,
      volume: meta.regularMarketVolume?.toLocaleString('nb-NO') || null,
      sector: profile.sector || null,
      industry: profile.industry || null,
      description: profile.description || null,
      website: profile.website || null,
      employees: profile.employees || null,
      country: 'Norge',
      profitMargin: profile.profitMargin || null,
      returnOnEquity: profile.returnOnEquity || null,
      revenueGrowth: profile.revenueGrowth || null,
    });

  } catch (err) {
    res.status(500).json({ error: 'Serverfeil', detail: err.message });
  }
}
