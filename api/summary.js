import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  // Verifiser Supabase JWT
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Ikke autentisert' });
  }
  const token = authHeader.replace('Bearer ', '');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: { user }, error: authError } = await sb.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Ugyldig token' });

  const stock = req.body;
  if (!stock || !stock.ticker) return res.status(400).json({ error: 'Aksjedata mangler' });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 1200,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Du er Børshjelpen sin AI for norske nybegynnere. Svar KUN med gyldig JSON.
Gi ALDRI kjøpsanbefalinger. Presenter alltid begge sider.

JSON-struktur:
{
  "hva": "2-3 setninger om hva selskapet gjør",
  "aktuelt": "Hva skjer akkurat nå med selskapet (siste kvartal, nyheter)",
  "bull": ["Argument 1", "Argument 2", "Argument 3"],
  "bear": ["Risiko 1", "Risiko 2", "Risiko 3"],
  "scenarios": [
    {"label": "Optimistisk", "prob": 35, "return": "+15% til +30%", "color": "#2C7A5C", "barColor": "#2C7A5C"},
    {"label": "Nøytralt", "prob": 40, "return": "-5% til +10%", "color": "#888", "barColor": "#888"},
    {"label": "Pessimistisk", "prob": 25, "return": "-20% til -10%", "color": "#A32D2D", "barColor": "#A32D2D"}
  ],
  "risiko": "Konkrete risikoer investorer bør kjenne til",
  "historisk": "Kort historisk perspektiv på aksjen",
  "nybegynner_tips": "Ett kort praktisk tips til nybegynnere om dette selskapet eller bransjen"
}`
        },
        {
          role: 'user',
          content: `Analyser ${stock.name} (${stock.ticker}).

Kursdata: ${stock.price} NOK, endring: ${stock.changePct}% (${stock.marketLabel || 'siden siste stenging'}), 52-ukers høy: ${stock.fiftyTwoWeekHigh}, 52-ukers lav: ${stock.fiftyTwoWeekLow}

Nøkkeltall: P/E: ${stock.pe}, P/B: ${stock.pb || '—'}, EV/EBITDA: ${stock.evEbitda || '—'}, Utbytteyield: ${stock.dividendYield}, Markedsverdi: ${stock.marketCap}, Beta: ${stock.beta}

Lønnsomhet: Bruttomargin: ${stock.grossMargin || '—'}, Nettomargin: ${stock.profitMargin || '—'}, ROE: ${stock.returnOnEquity || '—'}, ROA: ${stock.returnOnAssets || '—'}

Finansiell styrke: Gjeld/EK: ${stock.debtEquity || '—'}, Fri kontantstrøm-yield: ${stock.fcfYield || '—'}

Sektor: ${stock.sector}, Bransje: ${stock.industry || '—'}`
        }
      ]
    });

    const ai = JSON.parse(completion.choices[0].message.content);
    res.status(200).json(ai);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
