export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Kun POST støttes' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY mangler i Vercel Environment Variables.' });

  const { ticker, name, price, currency, changePct, up, exchange, pe, forwardPE,
    dividendYield, beta, marketCap, fiftyTwoWeekHigh, fiftyTwoWeekLow,
    sector, industry, description, profitMargin, returnOnEquity, revenueGrowth } = req.body;

  if (!ticker) return res.status(400).json({ error: 'Ticker mangler' });

  const prompt = `Du er en nøytral finansanalytiker som skriver enkle, forståelige aksjesammendrag på norsk for nybegynnere.

Her er data om aksjen:
- Navn: ${name}
- Ticker: ${ticker}
- Børs: ${exchange}
- Pris: ${price} ${currency}
- Endring i dag: ${up ? '+' : ''}${changePct}%
- Sektor: ${sector || 'ukjent'}
- Bransje: ${industry || 'ukjent'}
- P/E: ${pe || 'ikke tilgjengelig'}
- Fremtidig P/E: ${forwardPE || 'ikke tilgjengelig'}
- Utbytte: ${dividendYield || 'ikke tilgjengelig'}
- Beta: ${beta || 'ikke tilgjengelig'}
- Markedsverdi: ${marketCap || 'ikke tilgjengelig'}
- 52-ukers høy/lav: ${fiftyTwoWeekHigh || '?'} / ${fiftyTwoWeekLow || '?'}
- Profittmargin: ${profitMargin || 'ikke tilgjengelig'}
- Egenkapitalavkastning: ${returnOnEquity || 'ikke tilgjengelig'}
- Inntjeningsvekst: ${revenueGrowth || 'ikke tilgjengelig'}
- Selskapsbeskrivelse: ${description || 'Ikke tilgjengelig'}

Svar KUN med gyldig JSON, ingen markdown, ingen forklaring:

{
  "hva": "2-3 setninger som forklarer hva selskapet gjør på enkelt norsk.",
  "bull": ["Argument for 1", "Argument for 2", "Argument for 3"],
  "bear": ["Argument mot 1", "Argument mot 2", "Argument mot 3"],
  "risiko": "1-2 setninger om viktigste risikoer.",
  "nybegynner_tips": "1 konkret tips til nybegynnere.",
  "scenarios": [
    {"label": "Optimistisk scenario", "prob": 30, "return": "+15–25%", "color": "#2C7A5C", "barColor": "#1A5C3A"},
    {"label": "Nøytralt scenario", "prob": 45, "return": "-5% til +10%", "color": "#8B6E3A", "barColor": "#C8A96E"},
    {"label": "Pessimistisk scenario", "prob": 25, "return": "-20% eller mer", "color": "#A32D2D", "barColor": "#5C1B1B"}
  ]
}

Regler: ingen kjøpsanbefalinger, alltid vis risiko, presenter begge sider, skriv norsk bokmål.`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1000,
        temperature: 0.4,
        messages: [
          { role: 'system', content: 'Du er en finansanalytiker. Svar alltid med gyldig JSON og ingenting annet.' },
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(500).json({ error: 'Groq API feil', detail: err });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';

    try {
      const clean = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      res.status(200).json(parsed);
    } catch {
      res.status(500).json({ error: 'Kunne ikke tolke AI-svar', raw: text });
    }

  } catch (err) {
    res.status(500).json({ error: 'Serverfeil', detail: err.message });
  }
}
