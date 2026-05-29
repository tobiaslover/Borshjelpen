export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { ticker, range } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Ticker mangler' });

  const upper = ticker.toUpperCase().replace('.OL','').replace(':OSE','');
  const symbol = upper + '.OL';

  const ranges = {
    '1d': { interval: '1m', range: '1d' },
    '1w': { interval: '15m', range: '5d' },
    '1m': { interval: '1d', range: '1mo' },
    '1y': { interval: '1d', range: '1y' },
  };

  const { interval, range: r } = ranges[range] || ranges['1d'];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${r}`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://finance.yahoo.com/',
      }
    });
    clearTimeout(timeout);

    if (!response.ok) return res.status(404).json({ error: 'Data ikke funnet' });

    const data = await response.json();
    const result = data?.chart?.result?.[0];
    const timestamps = result?.timestamp || [];
    const closes = result?.indicators?.quote?.[0]?.close || [];

    const points = timestamps
      .map((t, i) => ({ t: t * 1000, p: closes[i] }))
      .filter(d => d.p !== null && d.p !== undefined && !isNaN(d.p));

    res.status(200).json({
      ticker: upper,
      currency: 'NOK',
      currentPrice: result?.meta?.regularMarketPrice,
      previousClose: points[0]?.p,
      points,
    });

  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Timeout — Yahoo Finance svarte ikke i tide' });
    }
    res.status(500).json({ error: 'Serverfeil', detail: err.message });
  }
}
