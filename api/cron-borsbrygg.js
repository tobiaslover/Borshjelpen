export default async function handler(req, res) {
  // Kun tillatt fra Vercel Cron
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const tickers = ['EQNR', 'DNB', 'AKRBP', 'TEL', 'MOWI', 'YAR', 'NHY', 'KAHOT'];

  try {
    // Hent kursdata for alle tickers
    const results = await Promise.all(
      tickers.map(t =>
        fetch(`https://borshjelpen.no/api/stock?ticker=${t}`)
          .then(r => r.json())
          .catch(() => null)
      )
    );

    const valid = results.filter(r => r && !r.error);
    if (!valid.length) {
      return res.status(500).json({ error: 'Ingen kursdata tilgjengelig' });
    }

    const stockSummary = valid.map(s => {
      const sign = parseFloat(s.changePct) >= 0 ? '+' : '';
      return `${s.name} (${s.ticker}): ${s.price} NOK, ${sign}${s.changePct}%`;
    }).join(', ');

    // Trigger Børsbrygg-generering
    const response = await fetch('https://borshjelpen.no/api/borsbrygg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stockSummary })
    });

    const data = await response.json();
    return res.status(200).json({ success: true, title: data.tittel });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
