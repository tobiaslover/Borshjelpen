export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Kun POST støttes' });

  const apiKey = process.env.GROQ_API_KEY;
  const newsApiKey = process.env.NEWS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY mangler' });

  const s = req.body;
  if (!s.ticker) return res.status(400).json({ error: 'Ticker mangler' });

  // Hent nyheter for denne aksjen
  let newsText = '';
  try {
    if (newsApiKey && s.name) {
      const companyName = s.name.split(' ')[0];
      const query = encodeURIComponent(companyName + ' OR ' + s.ticker + ' aksjer OR bors');
      const newsRes = await fetch(
        'https://newsapi.org/v2/everything?q=' + query + '&language=no&sortBy=publishedAt&pageSize=8',
        { headers: { 'X-Api-Key': newsApiKey } }
      );
      if (newsRes.ok) {
        const newsData = await newsRes.json();
        const articles = (newsData.articles || [])
          .filter(function(a) { return a.title && a.description; })
          .slice(0, 6)
          .map(function(a) { return '* [' + (a.source && a.source.name || '') + '] ' + a.title + ': ' + a.description; });
        if (articles.length) newsText = 'Relevante nyheter om ' + s.name + ':\n' + articles.join('\n');
      }
    }
  } catch(e) {}

  const dataLines = [
    'Navn: ' + s.name,
    'Ticker: ' + s.ticker,
    'Bors: ' + s.exchange,
    'Pris: ' + s.price + ' ' + s.currency,
    'Endring i dag: ' + (s.up ? '+' : '') + s.changePct + '%',
    'Sektor: ' + (s.sector || 'ukjent'),
    'Bransje: ' + (s.industry || 'ukjent'),
    'P/E: ' + (s.pe || 'ikke tilgjengelig'),
    'Utbytte: ' + (s.dividendYield || 'ikke tilgjengelig'),
    'Beta: ' + (s.beta || 'ikke tilgjengelig'),
    'Markedsverdi: ' + (s.marketCap || 'ikke tilgjengelig'),
    '52-ukers hoy/lav: ' + (s.fiftyTwoWeekHigh || '?') + ' / ' + (s.fiftyTwoWeekLow || '?'),
    'Profittmargin: ' + (s.profitMargin || 'ikke tilgjengelig'),
    'Beskrivelse: ' + (s.description || 'Ikke tilgjengelig'),
  ].join('\n');

  const newsSection = newsText ? '\n' + newsText + '\nBruk nyhetene aktivt. IKKE finn opp nyheter.' : '';

  const jsonSchema = [
    '{',
    '  "hva": "2-3 setninger om hva selskapet gjor pa norsk.",',
    '  "aktuelt": "2-3 setninger om hva som skjer akkurat na basert pa nyheter og kursendring.",',
    '  "bull": ["Argument for 1", "Argument for 2", "Argument for 3"],',
    '  "bear": ["Argument mot 1", "Argument mot 2", "Argument mot 3"],',
    '  "risiko": "1-2 setninger om viktigste risikoer na.",',
    '  "historisk": "2-3 setninger om hvordan aksjen historisk har oppfort seg og hva som har drevet kursen.",',
    '  "nybegynner_tips": "1 konkret tips til nybegynnere.",',
    '  "scenarios": [',
    '    {"label": "Optimistisk scenario", "prob": 30, "return": "+15-25%", "color": "#2C7A5C", "barColor": "#1A5C3A"},',
    '    {"label": "Noeytralt scenario", "prob": 45, "return": "-5% til +10%", "color": "#8B6E3A", "barColor": "#C8A96E"},',
    '    {"label": "Pessimistisk scenario", "prob": 25, "return": "-20% eller mer", "color": "#A32D2D", "barColor": "#5C1B1B"}',
    '  ]',
    '}'
  ].join('\n');

  const prompt = 'Du er en noytral finansanalytiker som skriver enkle aksjesammendrag pa norsk for nybegynnere.\n\nData om aksjen:\n' + dataLines + newsSection + '\n\nSvar KUN med gyldig JSON:\n' + jsonSchema + '\n\nRegler: ingen kjopsanbefalinger, alltid vis risiko, begge sider, norsk bokmal.';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(function() { controller.abort(); }, 25000);

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1200,
        temperature: 0.3,
        messages: [
          { role: 'system', content: 'Du er en finansanalytiker. Svar alltid med gyldig JSON. Finn aldri opp fakta.' },
          { role: 'user', content: prompt }
        ]
      })
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.json();
      const msg = (err.error && err.error.message) || JSON.stringify(err);
      return res.status(500).json({ error: msg });
    }

    const data = await response.json();
    const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    res.status(200).json(parsed);

  } catch(err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Timeout' });
    res.status(500).json({ error: 'Serverfeil', detail: err.message });
  }
}
