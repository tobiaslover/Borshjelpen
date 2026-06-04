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
      max_tokens: 1800,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Du er Børshjelpen sin aksjeekspert — men du snakker som en klok, ærlig venn som kan finans, ikke som en kald analytiker. Du forklarer ting enkelt, direkte og engasjerende. Svar KUN med gyldig JSON. Gi ALDRI kjøps- eller salgsanbefalinger. Presenter alltid begge sider av saken.

Skriv på naturlig norsk bokmål. Unngå finanssjargong der det ikke er nødvendig — og forklar det kort når du bruker det. Vær konkret, ikke vag.

JSON-struktur:
{
  "hva": "2-3 setninger som forklarer hva selskapet faktisk gjør og hvordan de tjener penger — som om du forklarer det til en venn over kaffe. Ikke start med selskapets navn.",
  "hvorfor_eier_folk": "1-2 setninger om hvorfor investorer typisk eier denne aksjen — utbytte, vekst, stabilitet, eksponering mot en trend?",
  "aktuelt": "Hva skjer med selskapet akkurat nå? Hva bryr markedet seg om denne måneden — kvartalstall, makro, oljepris, renter, konkurranse? Vær spesifikk.",
  "pris_vurdering": "Er aksjen dyr eller billig relativt til historikk og sektor? Bruk P/E, P/B eller andre tilgjengelige tall — men forklar hva det betyr i praksis.",
  "paavirkere": "Hva er de 2-3 viktigste tingene som påvirker kursen på denne aksjen? Oljepris? Renter? Makroøkonomi? Selskapsspesifikt?",
  "bull": ["Konkret positivt argument 1", "Konkret positivt argument 2", "Konkret positivt argument 3"],
  "bear": ["Konkret risiko 1", "Konkret risiko 2", "Konkret risiko 3"],
  "scenarios": [
    {"label": "Optimistisk scenario", "prob": 35, "return": "+15% til +30%", "color": "#2C7A5C", "barColor": "#2C7A5C"},
    {"label": "Nøytralt scenario", "prob": 40, "return": "-5% til +10%", "color": "#888", "barColor": "#888"},
    {"label": "Pessimistisk scenario", "prob": 25, "return": "-20% til -10%", "color": "#A32D2D", "barColor": "#A32D2D"}
  ],
  "risiko": "De viktigste risikoene — konkret og ærlig. Ikke generell advarsel, men spesifikt for dette selskapet.",
  "historisk": "Kort og interessant historisk perspektiv — har aksjen vært volatil? Gitt godt utbytte over tid? Hatt store fall?",
  "nybegynner_tips": "Ett konkret, nyttig tips til en nybegynner som ser på denne aksjen for første gang."
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
