export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Ticker mangler' });

  const upper = ticker.toUpperCase().replace('.OL','').replace(':OSE','');
  const symbol = upper + '.OL';

  try {
    const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/csrfToken', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://finance.yahoo.com/',
      }
    });
    const cookies = crumbRes.headers.get('set-cookie') || '';
    const crumb = (await crumbRes.text()).trim();

    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=price&crumb=${encodeURIComponent(crumb)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://finance.yahoo.com/',
        'Cookie': cookies,
      }
    });

    const data = await response.json();
    const p = data?.quoteSummary?.result?.[0]?.price;

    // Vis alle relevante felter for debugging
    return res.status(200).json({
      regularMarketPrice: p?.regularMarketPrice?.raw,
      regularMarketOpen: p?.regularMarketOpen?.raw,
      regularMarketPreviousClose: p?.regularMarketPreviousClose?.raw,
      regularMarketChange: p?.regularMarketChange?.raw,
      regularMarketChangePercent: p?.regularMarketChangePercent?.raw,
      calculatedFromOpen: p?.regularMarketPrice?.raw && p?.regularMarketOpen?.raw
        ? (p.regularMarketPrice.raw - p.regularMarketOpen.raw).toFixed(2)
        : 'mangler open',
      calculatedPctFromOpen: p?.regularMarketPrice?.raw && p?.regularMarketOpen?.raw
        ? ((p.regularMarketPrice.raw - p.regularMarketOpen.raw) / p.regularMarketOpen.raw * 100).toFixed(2)
        : 'mangler open',
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
