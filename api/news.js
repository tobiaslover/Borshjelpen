export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'FMP_API_KEY mangler' });

  const { ticker } = req.query;

  try {
    const url = ticker
      ? `https://financialmodelingprep.com/api/v3/stock_news?tickers=${ticker.toUpperCase()}.OL&limit=10&apikey=${apiKey}`
      : `https://financialmodelingprep.com/api/v3/stock_news?limit=20&apikey=${apiKey}`;

    const newsRes = await fetch(url);
    const newsData = await newsRes.json();

    if (!Array.isArray(newsData)) return res.status(200).json({ articles: [] });

    const articles = newsData.map(function(a) {
      return {
        title: a.title,
        summary: a.text ? a.text.slice(0, 200) + '...' : '',
        source: a.site || '',
        url: a.url || '',
        publishedAt: a.publishedDate || '',
        ticker: a.symbol || ''
      };
    });

    res.status(200).json({ articles });
  } catch(err) {
    res.status(500).json({ error: 'Serverfeil', detail: err.message });
  }
}
