export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Ticker mangler' });

  const upper = ticker.toUpperCase().replace('.OL','').replace(':OSE','');
  const symbol = upper + '.OL';

  try {
    // Hent crumb og cookies
    const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/csrfToken', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Referer': 'https://finance.yahoo.com/',
      }
    });
    const cookies = crumbRes.headers.get('set-cookie') || '';
    const crumb = (await crumbRes.text()).trim();

    // Hent aksjedata
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=assetProfile,summaryDetail,defaultKeyStatistics,financialData,price&crumb=${encodeURIComponent(crumb)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://finance.yahoo.com/',
        'Cookie': cookies,
      }
    });

    if (!response.ok) {
      return res.status(404).json({ error: `Aksje "${upper}" ikke funnet. Prøv f.eks. EQNR, DNB, TEL, AKRBP, MOWI.` });
    }

    const data = await response.json();
    const r = data?.quoteSummary?.result?.[0];
    if (!r?.price) {
      return res.status(404).json({ error: `Aksje "${upper}" ikke funnet.` });
    }

    const p = r.price;
    const detail = r.summaryDetail || {};
    const fin = r.financialData || {};
    const profile = r.assetProfile || {};

    const price = p.regularMarketPrice?.raw || 0;
    const openPrice = p.regularMarketOpen?.raw || price;

    // Beregn endring fra åpningskurs manuelt
    // Yahoo sine egne change-felter er upålitelige ved ex-dividende
    const change = price - openPrice;
    const changePct = openPrice ? (change / openPrice) * 100 : 0;

    res.status(200).json({
      ticker: upper,
      name: p.longName || p.shortName || upper,
      price: price.toFixed(2),
      currency: 'NOK',
      change: change.toFixed(2),
      changePct: changePct.toFixed(2),
      up: change >= 0,
      exchange: 'Oslo Børs',
      marketCap: p.marketCap?.raw ? (p.marketCap.raw / 1e9).toFixed(1) + ' mrd' : null,
      pe: detail.trailingPE?.raw?.toFixed(1) || null,
      forwardPE: detail.forwardPE?.raw?.toFixed(1) || null,
      dividendYield: detail.dividendYield?.raw
        ? (detail.dividendYield.raw * 100).toFixed(2) + '%' : null,
      beta: detail.beta?.raw?.toFixed(2) || null,
      fiftyTwoWeekHigh: detail.fiftyTwoWeekHigh?.raw?.toFixed(2) || null,
      fiftyTwoWeekLow: detail.fiftyTwoWeekLow?.raw?.toFixed(2) || null,
      volume: p.regularMarketVolume?.raw?.toLocaleString('nb-NO') || null,
      sector: profile.sector || null,
      industry: profile.industry || null,
      description: profile.longBusinessSummary || null,
      website: profile.website || null,
      employees: profile.fullTimeEmployees || null,
      country: 'Norge',
      profitMargin: fin.profitMargins?.raw
        ? (fin.profitMargins.raw * 100).toFixed(1) + '%' : null,
      returnOnEquity: fin.returnOnEquity?.raw
        ? (fin.returnOnEquity.raw * 100).toFixed(1) + '%' : null,
      revenueGrowth: fin.revenueGrowth?.raw
        ? (fin.revenueGrowth.raw * 100).toFixed(1) + '%' : null,
    });

  } catch (err) {
    res.status(500).json({ error: 'Serverfeil', detail: err.message });
  }
}
