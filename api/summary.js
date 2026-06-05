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

  // Rate limit: gratis 2/dag, investor/proff 200/dag
  const LIMITS = { free: 2, investor: 200, proff: 200 };
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });
  const { data: planData } = await sb.from('user_plans').select('plan').eq('user_id', user.id).maybeSingle();
  const plan = planData?.plan || 'free';
  const limit = LIMITS[plan] ?? 2;
  // NB: kolonnen heter "type" (samme som resten av appen), ikke "activity".
  const { count } = await sb.from('user_activity').select('*', { count: 'exact', head: true })
    .eq('user_id', user.id).eq('type', 'ai_analyse').gte('created_at', today + 'T00:00:00+02:00');
  if ((count || 0) >= limit) {
    return res.status(429).json({ error: `Du har nådd dagens grense på ${limit} AI-analyser.`, limit, plan });
  }
  await sb.from('user_activity').insert({ user_id: user.id, type: 'ai_analyse', ticker: stock.ticker, name: stock.name || null, xp: 2 });

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

VIKTIG OM FAKTA — IKKE DIKT:
Du får oppgitt faktiske nøkkeltall, men IKKE en nyhetsfeed.
- "aktuelt" skal være forsiktig og generell: bygg på sektor, makrobilde og de oppgitte nøkkeltallene. Påstå ALDRI konkrete ferske hendelser (oppkjøp, kvartalsresultater, kontrakter, datoer) som du ikke har dekning for.
- Finn ALDRI opp nyheter, tall, sitater eller hendelser.
- "pris_vurdering", "bull", "bear", "scenarios" osv. skal baseres på de oppgitte nøkkeltallene, ikke oppdiktede tall.

JSON-struktur:
{
  "om_selskapet": "Oversett selskapsbeskrivelsen (gitt nederst i brukermeldingen) til naturlig, flytende norsk bokmål. Ta med HELE innholdet — ikke forkort eller utelat noe. Behold fakta presist. Får du ingen beskrivelse oppgitt, returner tom streng.",
  "hva": "2-3 setninger som forklarer hva selskapet faktisk gjør og hvordan de tjener penger — som om du forklarer det til en venn over kaffe. Ikke start med selskapets navn.",
  "hvorfor_eier_folk": "1-2 setninger om hvorfor investorer typisk eier denne aksjen — utbytte, vekst, stabilitet, eksponering mot en trend?",
  "aktuelt": "Hva skjer med selskapet akkurat nå? Hva bryr markedet seg om denne måneden — kvartalstall, makro, oljepris, renter, konkurranse? Vær spesifikk.",
  "pris_vurdering": "Bruk de faktiske P/E, P/B, EV/EBITDA og utbyttetall som er oppgitt. Sammenlign med typiske verdier for sektoren og selskapets historikk. Si konkret om dette er høyt eller lavt — og HVORFOR det er slik akkurat nå. Forklar hva tallene betyr i praksis for en nybegynner. Vær spesifikk — ikke generell.",
  "paavirkere": "Hva er de 2-3 viktigste tingene som påvirker kursen på denne aksjen? Oljepris? Renter? Makroøkonomi? Selskapsspesifikt?",
  "bull": ["Konkret positivt argument 1", "Konkret positivt argument 2", "Konkret positivt argument 3"],
  "bear": ["Konkret risiko 1", "Konkret risiko 2", "Konkret risiko 3"],
  "scenarios": [
    {
      "label": "Skriv et konkret optimistisk scenarionavn basert på selskapets faktiske situasjon (f.eks. 'Høy oljepris + sterk etterspørsel')",
      "prob": "Realistisk sannsynlighet basert på makro, historikk og selskapsdata — typisk 25-40%",
      "return": "Realistisk kursutvikling basert på verdsettelse og historisk volatilitet",
      "drivers": "1-2 setninger om hva som må til for at dette skjer",
      "color": "#2C7A5C",
      "barColor": "#2C7A5C"
    },
    {
      "label": "Konkret basisscenario-navn (f.eks. 'Stabil oljepris, moderat vekst')",
      "prob": "Typisk 35-45%",
      "return": "Realistisk for basisscenario",
      "drivers": "Hva som karakteriserer dette scenariet",
      "color": "#888",
      "barColor": "#888"
    },
    {
      "label": "Konkret pessimistisk scenarionavn (f.eks. 'Oljepriskollaps + rentepress')",
      "prob": "Typisk 20-35%",
      "return": "Realistisk nedside basert på historiske krasj og risikoer",
      "drivers": "Hva som trigger dette scenariet",
      "color": "#A32D2D",
      "barColor": "#A32D2D"
    }
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

Sektor: ${stock.sector}, Bransje: ${stock.industry || '—'}` +
            (stock.description
              ? `\n\nSelskapsbeskrivelse å oversette til norsk (gjengi HELE i feltet "om_selskapet"):\n${stock.description}`
              : `\n\nIngen selskapsbeskrivelse oppgitt — sett "om_selskapet" til tom streng.`)
        }
      ]
    });

    const ai = JSON.parse(completion.choices[0].message.content);
    res.status(200).json(ai);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
