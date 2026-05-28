export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Ticker mangler' });

  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'TWELVE_DATA_API_KEY mangler.' });

  const upper = ticker.toUpperCase().replace('.OL','').replace(':OSE','');

  // Prøv først med exchange=OSE, deretter uten (for internasjonale)
  const trySymbols = [
    `https://api.twelvedata.com/quote?symbol=${upper}&exchange=OSE&apikey=${apiKey}`,
    `https://api.twelvedata.com/quote?symbol=${upper}&exchange=XOSL&apikey=${apiKey}`,
    `https://api.twelvedata.com/quote?symbol=${upper}&apikey=${apiKey}`
  ];

  let quote = null;
  let isOsloBors = false;

  for (let i = 0; i < trySymbols.length; i++) {
    const r = await fetch(trySymbols[i]);
    const d = await r.json();
    if (d.status !== 'error' && d.close && parseFloat(d.close) > 0) {
      quote = d;
      isOsloBors = i < 2;
      break;
    }
  }

  if (!quote) {
    return res.status(404).json({
      error: `Aksje "${upper}" ikke funnet. Prøv f.eks. EQNR, DNB, TEL, AKRBP, MOWI.`
    });
  }

  // Hent profil
  const exchangeParam = isOsloBors ? '&exchange=OSE' : '';
  const profileRes = await fetch(
    `https://api.twelvedata.com/profile?symbol=${upper}${exchangeParam}&apikey=${apiKey}`
  );
  const profile = profileRes.ok ? await profileRes.json() : {};

  const price = parseFloat(quote.close || 0);
  const prevClose = parseFloat(quote.previous_close || price);
  const change = price - prevClose;
  const changePct = prevClose ? (change / prevClose) * 100 : 0;

  res.status(200).json({
    ticker: upper,
    name: quote.name || profile.name || upper,
    price: price.toFixed(2),
    currency: isOsloBors ? 'NOK' : (quote.currency || 'USD'),
    change: change.toFixed(2),
    changePct: changePct.toFixed(2),
    up: change >= 0,
    exchange: isOsloBors ? 'Oslo Børs' : (quote.exchange || upper),
    marketCap: null,
    pe: null,
    forwardPE: null,
    dividendYield: null,
    beta: null,
    fiftyTwoWeekHigh: quote['52_week']?.high || null,
    fiftyTwoWeekLow: quote['52_week']?.low || null,
    volume: quote.volume ? parseInt(quote.volume).toLocaleString('nb-NO') : null,
    sector: profile.sector || null,
    industry: profile.industry || null,
    description: profile.description || null,
    website: profile.website || null,
    employees: profile.employees || null,
    country: isOsloBors ? 'Norge' : (profile.country || null),
    profitMargin: null,
    returnOnEquity: null,
    revenueGrowth: null,
  });
}

  } catch (err) {
    res.status(500).json({ error: 'Serverfeil', detail: err.message });
  }
}
