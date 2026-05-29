export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Kun POST støttes' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY mangler i Vercel Environment Variables.' });

  const { messages, context } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages mangler' });

  const systemPrompt = `Du er Børshjelpen AI — en vennlig og nøytral finansassistent som hjelper nybegynnere forstå aksjer og børsen.

${context ? `Brukeren ser på: ${context.name} (${context.ticker}), pris ${context.price} ${context.currency}, endring ${context.up ? '+' : ''}${context.changePct}%, sektor: ${context.sector || 'ukjent'}, P/E: ${context.pe || 'ukjent'}, beta: ${context.beta || 'ukjent'}.` : 'Ingen spesifikk aksje valgt.'}

REGLER:
1. Gi ALDRI kjøpsanbefalinger eller råd om å kjøpe/selge/holde
2. Anbefal alltid å snakke med en finansrådgiver for personlige råd
3. Forklar alltid risiko ved siden av potensielle gevinster
4. Presenter alltid begge sider
5. Svar på norsk bokmål
6. Enkelt språk — forklar faguttrykk
7. Maks 3-4 avsnitt per svar
8. Du er en lærer, ikke en rådgiver`;

  try {
    const chatController = new AbortController();
    const chatTimeout = setTimeout(() => chatController.abort(), 8000);
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      signal: chatController.signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 600,
        temperature: 0.5,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ]
      })
    });

    clearTimeout(chatTimeout);
    if (!response.ok) {
      const err = await response.json();
      return res.status(500).json({ error: 'Groq API feil', detail: err });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || '';
    res.status(200).json({ reply });

  } catch (err) {
    res.status(500).json({ error: 'Serverfeil', detail: err.message });
  }
}
