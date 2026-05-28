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

  try {
    // Prøv query2 først, deretter query1
    let response = await fetch(
      `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${r}`,
      { headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://finance.yahoo.com/',
      }}
    );

    if (!response.ok) {
      response = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${r}`,
        { headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://finance.yahoo.com/',
        }}
      );
    }

    if (!response.ok) {
      return res.status(response.status).json({ 
        error: 'Yahoo Finance blokkerte kallet',
        status: response.status
      });
    }

    const data = await response.json();
    const result = data?.chart?.result?.[0];
    const timestamps = result?.timestamp || [];
    const closes = result?.indicators?.quote?.[0]?.close || [];
    const meta = result?.meta;

    const points = timestamps
      .map((t, i) => ({ t: t * 1000, p: closes[i] }))
      .filter(d => d.p !== null && d.p !== undefined && !isNaN(d.p));

    if (!points.length) {
      return res.status(404).json({ 
        error: 'Ingen datapunkter funnet',
        totalTimestamps: timestamps.length,
        totalCloses: closes.length
      });
    }

    res.status(200).json({
      ticker: upper,
      currency: 'NOK',
      currentPrice: meta?.regularMarketPrice,
      previousClose: points[0]?.p,
      points,
    });

  } catch (err) {
    res.status(500).json({ error: 'Serverfeil', detail: err.message });
  }
}
