import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Ikke autentisert' });
  }
  const token = authHeader.replace('Bearer ', '');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: { user }, error: authError } = await sb.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Ugyldig token' });

  const { messages, context } = req.body || {};
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages mangler' });
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const contextInfo = context ? `
Du snakker nå om ${context.name} (${context.ticker}).
Kurs: ${context.price} NOK, endring: ${context.changePct}%
${context.pe ? 'P/E: ' + context.pe : ''}
${context.dividendYield ? 'Direkteavkastning: ' + context.dividendYield : ''}
${context.marketCap ? 'Markedsverdi: ' + context.marketCap : ''}
${context.sector ? 'Sektor: ' + context.sector : ''}
Bruk disse tallene aktivt i svarene dine når det er relevant.` : '';

  const systemPrompt = `Du er Børshjelpen sin AI-assistent — du snakker som en klok, ærlig venn som kan finans godt. Tonen er varm, direkte og engasjerende. Du forklarer ting enkelt uten å være nedlatende, og du er konkret fremfor vag.

REGLER:
- Gi ALDRI kjøps- eller salgsanbefalinger — si heller "det er faktorer som taler for og imot"
- Presenter alltid begge sider når noen spør om en aksje er bra eller dårlig
- Bruk enkelt norsk — forklar faguttrykk kort når du bruker dem
- Vær konkret og spesifikk — unngå generelle fraser som "det avhenger av mange faktorer"
- Svar gjerne utfyllende når spørsmålet fortjener det, men vær konsis på enkle spørsmål
- Avslutt alltid med: "Dette er ikke finansiell rådgivning."
${contextInfo}`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 800,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.slice(-10)
      ]
    });
    res.status(200).json({ reply: completion.choices[0].message.content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
