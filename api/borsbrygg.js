export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Kun POST støttes' });

  const apiKey = process.env.GROQ_API_KEY;
  const newsApiKey = process.env.NEWS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY mangler' });

  const { stockSummary } = req.body;

  const today = new Date().toLocaleDateString('nb-NO', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Oslo'
  });

  // Hent nyheter fra NewsAPI
  let newsText = '';
  try {
    if (newsApiKey) {
      const newsRes = await fetch(
        'https://newsapi.org/v2/everything?q=Oslo+Børs+OR+aksjer+OR+Equinor+OR+DNB&language=no&sortBy=publishedAt&pageSize=10',
        { headers: { 'X-Api-Key': newsApiKey } }
      );
      if (newsRes.ok) {
        const newsData = await newsRes.json();
        const articles = (newsData.articles || [])
          .filter(a => a.title && a.description)
          .slice(0, 8)
          .map(a => '• ' + a.title + ': ' + a.description);
        if (articles.length) {
          newsText = 'Relevante nyheter (kan være inntil 24t gamle):\n' + articles.join('\n');
        }
      }
    }
  } catch(e) {}

  const prompt = `Du er redaktør for Børsbrygg — en daglig børsoppsummering for norske nybegynnere.

Dato: ${today}
Kursdata fra Oslo Børs: ${stockSummary}
${newsText ? '\n' + newsText + '\n' : '\nIngen nyhetsdata tilgjengelig — bruk kun kursdata.\n'}

Lag en daglig børsoppsummering BASERT KUN PÅ INFORMASJONEN OVER. Finn aldri opp nyheter eller hendelser som ikke er nevnt over.

Svar KUN med gyldig JSON:
{
  "hva_skjedde": "3-4 setninger om hva som faktisk skjedde basert på kursdata og nyheter over. Nevn konkrete selskaper og tall. IKKE finn opp nyheter.",
  "nyheter": [
    {"tittel": "Tittel basert på faktisk nyhet over", "tekst": "2-3 setninger om nyheten og hva den betyr for norske investorer.", "aksje": "ticker eller null"},
    {"tittel": "...", "tekst": "...", "aksje": null},
    {"tittel": "...", "tekst": "...", "aksje": null}
  ],
  "aksje_påvirkning": [
    {"ticker": "EQNR", "navn": "Equinor", "forklaring": "Kort forklaring basert på faktisk kursdata og nyheter."},
    {"ticker": "DNB", "navn": "DNB", "forklaring": "..."},
    {"ticker": "TEL", "navn": "Telenor", "forklaring": "..."}
  ],
  "globale_faktorer": "2-3 setninger om globale faktorer basert på tilgjengelig informasjon.",
  "risiko": "2-3 konkrete risikoer å følge med på fremover.",
  "nybegynner_tips": "Ett konkret og nyttig tips til nybegynnere basert på dagens marked."
}

Regler: Norsk bokmål. Ingen kjøpsanbefalinger. Alltid begge sider. Forklar faguttrykk. IKKE finn opp hendelser.`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 2000,
        temperature: 0.3,
        messages: [
          { role: 'system', content: 'Du er en erfaren norsk finansjournalist. Svar alltid med gyldig JSON. Finn aldri opp fakta.' },
          { role: 'user', content: prompt }
        ]
      })
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.json();
      return res.status(500).json({ error: 'Groq feil', detail: err });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    res.status(200).json(parsed);

  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Timeout' });
    res.status(500).json({ error: 'Serverfeil', detail: err.message });
  }
}
