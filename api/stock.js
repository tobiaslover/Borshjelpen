export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Ticker mangler' });

  const upper = ticker.toUpperCase().replace('.OL','').replace(':OSE','');
  const symbol = upper + '.OL';

  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://finance.yahoo.com/',
      }
    });

    const data = await response.json();
    const result = data?.chart?.result?.[0];
    const meta = result?.meta;

    // PURE DEBUG — vis alle felter
    return res.status(200).json({
      regularMarketPrice: meta?.regularMarketPrice,
      chartPreviousClose: meta?.chartPreviousClose,
      regularMarketPreviousClose: meta?.regularMarketPreviousClose,
      previousClose: meta?.previousClose,
      longName: meta?.longName,
      shortName: meta?.shortName,
      symbol: meta?.symbol,
      allMetaKeys: Object.keys(meta || {})
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
