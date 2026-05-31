export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Kun POST støttes' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY mangler' });

  const { stockSummary, date } = req.body;

  const today = date || new Date().toLocaleDateString('nb-NO', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Oslo'
  });

  const prompt = `Du er redaktør for Børsbrygg — en daglig børsoppsummering for norske nybegynnere.

Dato: ${today}
Kursdata fra Oslo Børs i dag: ${stockSummary}

Lag en grundig og informativ daglig børsoppsummering. Svar KUN med gyldig JSON:

{
  "hva_skjedde": "3-4 setninger om hva som faktisk skjedde på Oslo Børs i dag. Nevn konkrete selskaper, kursendringer og de viktigste markedsbevegelsene. Forklar sammenhenger mellom global økonomi (olje, renter, valuta, USA-marked) og norske aksjer. Skriv som en erfaren journalist.",
  "nyheter": [
    {"tittel": "Konkret nyhetstittel", "tekst": "2-3 setninger som forklarer nyheten og hvorfor den er viktig for norske investorer.", "aksje": "EQNR eller annen ticker om relevant"},
    {"tittel": "Andre nyhetstittel", "tekst": "2-3 setninger.", "aksje": null},
    {"tittel": "Tredje nyhetstittel", "tekst": "2-3 setninger.", "aksje": null}
  ],
  "aksje_påvirkning": [
    {"ticker": "EQNR", "navn": "Equinor", "forklaring": "Kort forklaring på hvorfor aksjen beveget seg slik den gjorde i dag og hva som kan påvirke den fremover."},
    {"ticker": "DNB", "navn": "DNB", "forklaring": "..."},
    {"ticker": "TEL", "navn": "Telenor", "forklaring": "..."}
  ],
  "globale_faktorer": "2-3 setninger om globale faktorer (oljepris, Fed, dollarkurs, europeiske markeder) som påvirket Oslo Børs i dag.",
  "risiko": "2-3 konkrete risikoer eller muligheter å følge med på i dagene fremover.",
  "nybegynner_tips": "Ett konkret og nyttig tips til nybegynnere basert på dagens marked."
}

Regler: Skriv på norsk bokmål. Ingen kjøpsanbefalinger. Alltid vis begge sider. Forklar faguttrykk.`;

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
        temperature: 0.5,
        messages: [
          { role: 'system', content: 'Du er en erfaren norsk finansjournalist. Svar alltid med gyldig JSON og ingenting annet.' },
          { role: 'user', content: prompt }
        ]
      })
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.json();
      return res.status(500).json({ error: 'Groq API feil', detail: err });
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
