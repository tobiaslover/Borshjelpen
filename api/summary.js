import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

// Populære aksjer er åpne uten innlogging (smakebit + SEO-landingssider).
// AI-analyse for disse genereres også for gjester. Alle andre tickere krever konto.
const PUBLIC_TICKERS = ['EQNR', 'DNB', 'AKRBP', 'TEL', 'MOWI', 'YAR'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const stock = req.body;
  if (!stock || !stock.ticker) return res.status(400).json({ error: 'Aksjedata mangler' });
  const reqTicker = String(stock.ticker).toUpperCase().trim();
  const isPublic = PUBLIC_TICKERS.indexOf(reqTicker) !== -1;

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Forsøk å autentisere. Innlogget bruker => rate limit + XP-logging som før.
  // Uinnlogget gjest => tillatt KUN for de offentlige tickerne (ingen logging).
  const authHeader = req.headers.authorization;
  let user = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '');
    if (token) {
      const { data, error } = await sb.auth.getUser(token);
      if (!error && data && data.user) user = data.user;
    }
  }

  if (!user) {
    // Ingen gyldig bruker: kun offentlige aksjer slipper gjennom.
    if (!isPublic) return res.status(401).json({ error: 'Ikke autentisert' });
    // Gjest på offentlig aksje => fortsett uten rate limit / logging.
  } else {
    // Innlogget: rate limit (gratis 2/dag, investor/proff 200/dag) + logging.
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
  }

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

SPRÅK OG FORMAT (svært viktig):
- ALLE feltene under skal være ren tekst (vanlig tekststreng) — ALDRI et objekt, en liste eller nøstet JSON. "bull" og "bear" er lister med korte tekststrenger; alt annet er én tekststreng.
- Korrekt norsk rettskriving og tegnsetting er et krav. Mellomrom ETTER punktum, komma, kolon og semikolon — aldri før. Skriv ALDRI ".," eller ",." eller doble skilletegn. Stor forbokstav i egennavn og ved setningsstart. Les gjennom og rett feil før du svarer.

FORBUDTE ORD OG VURDERINGER (svært viktig):
Bruk ALDRI verdiladede ord som feller en dom over aksjen eller kursen. Følgende ord — og alt i samme gate — er strengt forbudt: "undervurdert", "overvurdert", "billig", "dyr", "kjøp", "selg", "kjøpskandidat", "salgskandidat", "sterk kjøp", "bør kjøpe", "bør selge", "verdt å kjøpe", "et godt kjøp", "et dårlig kjøp", "anbefaler". Konkluder ALDRI med at aksjen er rimelig, dyr, attraktiv, eller en god/dårlig investering. Beskriv i stedet nøytralt og faktabasert hva tallene er, og sammenlign dem med selskapets egen historikk og bransjen — la leseren trekke konklusjonen selv.

VIKTIG OM FAKTA — IKKE DIKT:
Du får oppgitt faktiske nøkkeltall, men IKKE en nyhetsfeed.
- "aktuelt" skal være forsiktig og generell: bygg på sektor, makrobilde og de oppgitte nøkkeltallene. Påstå ALDRI konkrete ferske hendelser (oppkjøp, kvartalsresultater, kontrakter, datoer) som du ikke har dekning for.
- Finn ALDRI opp nyheter, tall, sitater eller hendelser.
- "pris_vurdering", "bull", "bear" osv. skal baseres på de oppgitte nøkkeltallene, ikke oppdiktede tall.

JSON-struktur:
{
  "om_selskapet": "Kort, presis beskrivelse av selskapet på naturlig norsk bokmål — KUN det aller viktigste (hva selskapet gjør, hovedvirksomhet, marked). MAKS 6 linjer / ca. 60 ord. Ikke en full oversettelse av kildeteksten, men en fortettet versjon. Dobbeltsjekk rettskriving, store forbokstaver (egennavn, selskapsnavn) og tegnsetting før du svarer. Får du ingen beskrivelse oppgitt, returner tom streng.",
  "hva": "2-3 setninger som forklarer hva selskapet faktisk gjør og hvordan de tjener penger — som om du forklarer det til en venn over kaffe. Ikke start med selskapets navn.",
  "hvorfor_eier_folk": "1-2 setninger om hvorfor investorer typisk eier denne aksjen — utbytte, vekst, stabilitet, eksponering mot en trend?",
  "aktuelt": "Hva skjer med selskapet akkurat nå? Hva bryr markedet seg om denne måneden — kvartalstall, makro, oljepris, renter, konkurranse? Vær spesifikk.",
  "pris_vurdering": "Beskriv verdsettelsen NØYTRALT med de faktiske P/E, P/B, EV/EBITDA og utbyttetallene som er oppgitt. Forklar hva tallene betyr i praksis for en nybegynner, og hvordan de står seg mot selskapets egen historikk og typiske verdier i sektoren. IKKE konkluder med om aksjen er dyr eller billig, og bruk ingen verdiladede ord — bare presenter tallene og sammenligningen nøytralt, så leseren kan vurdere selv. Returner som ÉN sammenhengende tekststreng — ikke et objekt eller en liste.",
  "paavirkere": "Hva er de 2-3 viktigste tingene som påvirker kursen på denne aksjen? Oljepris? Renter? Makroøkonomi? Selskapsspesifikt?",
  "bull": ["Konkret positivt argument 1", "Konkret positivt argument 2", "Konkret positivt argument 3"],
  "bear": ["Konkret risiko 1", "Konkret risiko 2", "Konkret risiko 3"],
  "risiko": "De viktigste risikoene — konkret og ærlig. Ikke generell advarsel, men spesifikt for dette selskapet.",
  "historisk": "Kort og interessant historisk perspektiv — har aksjen vært volatil? Gitt godt utbytte over tid? Hatt store fall?",
  "nybegynner_tips": "Ett konkret, nyttig tips til en nybegynner som ser på denne aksjen for første gang. Ingen kjøps-/salgsråd."
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
              ? `\n\nSelskapsbeskrivelse (kilde, på engelsk). Lag en KORT norsk versjon i feltet "om_selskapet" — maks 6 linjer, kun det viktigste:\n${stock.description}`
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
