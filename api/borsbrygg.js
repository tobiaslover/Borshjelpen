export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Kun POST støttes' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY mangler' });

  const { stockSummary } = req.body;

  const today = new Date().toLocaleDateString('nb-NO', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Oslo'
  });

  // Hent ekte nyheter fra E24 RSS
  let newsText = '';
  try {
    const rssRes = await fetch('https://e24.no/rss/feed', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (rssRes.ok) {
      const rssText = await rssRes.text();
      const items = [...rssText.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/g)]
        .map(m => (m[1] || m[2] || '').trim())
        .filter(t => t && t !== 'E24' && t.length > 10)
        .slice(0, 12);
      if (items.length) newsText = 'Dagens nyheter fra E24: ' + items.join(' | ');
    }
  } catch(e) {}

  // Fallback: prøv DN
  if (!newsText) {
    try {
      const rssRes = await fetch('https://www.dn.no/rss', {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (rssRes.ok) {
        const rssText = await rssRes.text();
        const items = [...rssText.matchAll(/<title>(.*?)<\/title>/g)]
          .map(m => m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim())
          .filter(t => t && t !== 'DN' && t.length > 10)
          .slice(0, 12);
        if (items.length) newsText = 'Dagens nyheter fra DN: ' + items.join(' | ');
      }
    } catch(e) {}
  }

  const prompt = `Du er redaktør for Børsbrygg — en daglig børsoppsummering for norske nybegynnere.

Dato: ${today}
Kursdata fra Oslo Børs i dag: ${stockSummary}
${newsText ? '\n' + newsText + '\n' : '\nIngen nyhetsdata tilgjengelig — bruk kun kursdata.\n'}

Lag en daglig børsoppsummering BASERT KUN PÅ INFORMASJONEN OVER. Finn ikke opp nyheter. Hvis du ikke har nok nyhetsdata, si det ærlig og fokuser på kursbevegelsene.

Svar KUN med gyldig JSON:
{
  "hva_skjedde": "3-4 setninger om hva som faktisk skjedde på Oslo Børs i dag basert på kursdata og nyheter over. Nevn konkrete selskaper og endringer. IKKE finn opp nyheter.",
  "nyheter": [
    {"tittel": "Tittel basert på faktisk nyhet over", "tekst": "2-3 setninger om nyheten og betydningen.", "aksje": "ticker eller null"},
    {"tittel": "...", "tekst": "...", "aksje": null},
    {"tittel": "...", "tekst": "...", "aksje": null}
  ],
  "aksje_påvirkning": [
    {"ticker": "EQNR", "navn": "Equinor", "forklaring": "Kort forklaring basert på faktisk kursdata."},
    {"ticker": "DNB", "navn": "DNB", "forklaring": "..."},
    {"ticker": "TEL", "navn": "Telenor", "forklaring": "..."}
  ],
  "globale_faktorer": "2-3 setninger om globale faktorer basert på det vi vet fra kursdata og nyheter.",
  "risiko": "2-3 konkrete risikoer å følge med på fremover.",
  "nybegynner_tips": "Ett konkret tips til nybegynnere basert på dagens marked."
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
