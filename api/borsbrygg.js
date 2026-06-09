import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

/**
 * Henter ekte MAKRO-/markedsnyheter server-side og bygger en kompakt digest.
 * (FMP dekker ikke norske selskapsnyheter, så vi bruker kun den generelle feeden.)
 * Digesten sendes KUN til AI-en som kontekst — den returneres aldri til klienten.
 * Feiler kilden, returneres tom streng, og prompten ber AI-en hoppe over nyheter
 * i stedet for å dikte.
 */
async function fetchNewsDigest() {
  const key = process.env.FMP_API_KEY;
  const items = [];

  // Makro/generelle markedsnyheter fra FMP (lisensiert — du betaler for denne).
  // NB: FMP har IKKE selskapsnyheter for norske aksjer, så vi henter kun den
  // generelle feeden (olje, renter, jobbtall, globalt risikohumør — det som
  // faktisk driver Oslo Børs). Norske selskapsnyheter krever lisens fra
  // Oslo Børs/Euronext eller en betalt norsk leverandør (se notater).
  try {
    const res = await fetch(`https://financialmodelingprep.com/stable/news/general-latest?limit=15&apikey=${key}`);
    if (res.ok) {
      const gen = await res.json();
      if (Array.isArray(gen)) items.push(...gen);
    }
  } catch (e) {
    console.error('FMP news feil:', e.message);
  }

  if (!items.length) return '';

  // Dedupliser på tittel, sorter nyeste først, kutt til ~25 og trim teksten.
  const seen = new Set();
  const digest = items
    .filter(n => n && n.title && !seen.has(n.title) && seen.add(n.title))
    .sort((a, b) => new Date(b.publishedDate || b.date || 0) - new Date(a.publishedDate || a.date || 0))
    .slice(0, 25)
    .map(n => {
      const sym = n.symbol || 'marked';
      const src = n.site || n.publisher || 'ukjent kilde';
      const date = (n.publishedDate || n.date || '').slice(0, 16);
      const snippet = (n.text || n.snippet || '').replace(/\s+/g, ' ').slice(0, 200);
      return `- [${sym}] ${n.title} (${src}, ${date}): ${snippet}`;
    })
    .join('\n');

  return digest;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // GET — hent arkivutgave
  if (req.method === 'GET') {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'date mangler' });
    try {
      const { data, error } = await sb
        .from('borsbrygg_editions')
        .select('*')
        .eq('date', date)
        .maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!data) return res.status(404).json({ error: 'Ikke funnet' });
      return res.status(200).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).end();

  // Auth-sjekk på POST
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Ikke autentisert' });
  }
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await sb.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Ugyldig token' });

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });

  // Ukedag i Oslo-tid: 0=søndag, 1=mandag ... 6=lørdag
  const osloDow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Oslo' })).getDay();
  // Børsbrygg oppsummerer FORRIGE handelsdag, publisert morgenen etter.
  // Ny utgave lages kun når gårsdagen var en handelsdag (man–fre):
  //   tirsdag(2)–lørdag(6) = ja  |  søndag(0) og mandag(1) = nei
  const isGenerationDay = (osloDow >= 2 && osloDow <= 6);

  // Returnér siste eksisterende utgave (når det ikke skal lages ny, f.eks. søn/man)
  async function returnLatest() {
    try {
      const { data: latest } = await sb
        .from('borsbrygg_editions')
        .select('date, content')
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest && latest.content) {
        return res.status(200).json(Object.assign({}, latest.content, { _edition_date: latest.date, _is_today: false }));
      }
    } catch (e) {}
    return res.status(200).json({ error: 'Ingen utgave tilgjengelig ennå.' });
  }

  // Sjekk cache (dagens utgave finnes allerede)
  try {
    const { data: existing } = await sb
      .from('borsbrygg_editions')
      .select('content')
      .eq('date', today)
      .maybeSingle();
    if (existing && existing.content) {
      return res.status(200).json(existing.content);
    }
  } catch (e) {}

  // Ingen utgave for i dag ennå.
  if (!isGenerationDay) {
    // Søndag/mandag: ikke generer — vis siste eksisterende utgave (fredagens, via lørdag).
    return await returnLatest();
  }

  const { stockSummary } = req.body || {};
  if (!stockSummary) {
    // Mangler kursdata — fall tilbake til siste utgave i stedet for å feile.
    return await returnLatest();
  }

  // Hent ekte nyheter som kontekst (kun til AI — vises aldri offentlig)
  const newsDigest = await fetchNewsDigest();

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const messages = [
        {
          role: 'system',
          content: `Du er Børshjelpen sin daglige børskommentator — du skriver som en engasjert, ærlig venn som kan finans godt. Tonen er varm, direkte og forklarende — som en god morgenavis skrevet av noen som faktisk bryr seg om at leseren forstår. Ikke kald, ikke robotaktig. Bruk konkrete tall og eksempler. Forklar "hvorfor" bak tallene, ikke bare hva som skjedde.

VIKTIG OM FAKTA — IKKE DIKT:
Nederst i brukermeldingen får du (1) faktisk kursdata og ofte (2) en liste med FAKTISKE NYHETER fra siste døgn.
- Feltene "nyheter", "globale_faktorer" og ALLE "kilde"-felt skal UTELUKKENDE bygge på de oppgitte nyhetene og kursdataen.
- Sett "kilde" til den faktiske kilden som står oppgitt for nyheten. Finn ALDRI opp en kilde.
- Finn ALDRI opp nyheter, hendelser, tall, sitater eller selskapshendelser som ikke står i dataene.
- Får du INGEN nyheter oppgitt: returner tom "nyheter"-liste, og hold "globale_faktorer" generell og forsiktig uten å påstå spesifikke hendelser du ikke har dekning for.

Svar KUN med gyldig JSON. Bruk BARE ASCII-kompatible nøkkelnavn (ingen æøå i JSON-nøkler).

INGEN INVESTERINGSRÅD — VIKTIG:
- Gi ALDRI kjøps- eller salgsanbefalinger, kursmål eller spådommer om fremtidig kursutvikling.
- Skriv BESKRIVENDE (hva som skjedde og hvorfor), ikke NORMATIVT (hva leseren bør gjøre).
- Unngå formuleringer som kan leses som råd: "bør kjøpe/selge", "en god mulighet", "billig nå", "tiden for å gå inn", "anbefales", "vinneraksje" osv.
- I "risiko" og "aksje_paavirkning": beskriv risikoer og faktiske hendelser nøytralt — ikke fortell leseren hva de skal gjøre med informasjonen.
- Målet er å gi leseren forståelse til å ta egne, informerte valg — ikke å påvirke beslutningen.

JSON-struktur (bruk eksakt disse nøklene):
{
  "tittel": "Engasjerende tittel på maks 10 ord — som en avisoverskrift, ikke en rapport",
  "hva_skjedde": "3-4 setninger om hva som skjedde på Oslo Børs I GÅR. Vær konkret — bruk faktiske tall fra kursdataen. Forklar HVORFOR børsen gikk opp eller ned, ikke bare at den gjorde det.",
  "globale_faktorer": "2-3 setninger om globale faktorer som påvirket børsen I GÅR, basert på de oppgitte nyhetene. Hva skjedde i USA, Kina, med oljeprisen, rentene eller valutamarkedet som spilte inn?",
  "nyheter": [
    {
      "tittel": "Konkret og interessant overskrift basert på en oppgitt nyhet",
      "tekst": "2-3 setninger som forklarer nyheten og hva den betyr for investorer — skriv som til en venn, ikke som en pressemelding",
      "aksje": "TICKER eller null",
      "kilde": "Den faktiske kilden fra dataene"
    }
  ],
  "aksje_paavirkning": [
    {
      "ticker": "EQNR",
      "navn": "Equinor",
      "forklaring": "Konkret forklaring på hva som skjedde med aksjen og HVORFOR — bruk faktiske tall der de er tilgjengelige"
    }
  ],
  "risiko": "2-3 setninger om hva investorer bør holde øye med fremover. Vær spesifikk — hva er de faktiske risikoene akkurat nå, ikke generelle advarsler.",
  "nybegynner_tips": {
    "overskrift": "Velg ett konkret begrep fra DAGENS nyheter og forklar det (f.eks. 'Hva er oljeprisrisiko?' hvis Equinor er omtalt, 'Hva betyr renter for aksjer?' hvis renter nevnes)",
    "intro": "Forklar begrepet enkelt og konkret med utgangspunkt i noe som faktisk skjedde på Oslo Børs i går. Skriv som om du forklarer det til en venn over kaffen.",
    "punkter": [
      "Konkret punkt knyttet til noe fra dagens nyheter — med et praktisk eksempel",
      "Enkelt forklarende punkt som fjerner en vanlig misforståelse",
      "Praktisk tips nybegynnere kan bruke når de ser dette i fremtiden",
      "Punkt som knytter begrepet direkte til en aksje fra dagens utgave"
    ],
    "konklusjon": "Avslutt med å knytte tipset direkte tilbake til noe konkret fra dagens børsdag — gi leseren noe å tenke på"
  }
}`
        },
        {
          role: 'user',
          content:
            'Kursdata fra gårsdagens børsdag på Oslo Børs: ' + stockSummary +
            (newsDigest
              ? '\n\nFAKTISKE NYHETER fra siste døgn (bruk KUN disse — ikke dikt opp annet, og bruk de oppgitte kildene i "kilde"-feltene):\n' + newsDigest
              : '\n\nIngen nyheter er tilgjengelige akkurat nå. Returner tom "nyheter"-liste og hold "globale_faktorer" generell uten å påstå konkrete hendelser.')
        }
      ];

    // Genererer én utgave og parser JSON. Returnerer objekt eller null ved feil.
    async function generate(extraMessages) {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 2000,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: extraMessages ? messages.concat(extraMessages) : messages
      });
      try {
        return JSON.parse(completion.choices[0].message.content);
      } catch (e) {
        return null;
      }
    }

    // DETERMINISTISK GUARDRAIL-FILTER:
    // Skanner all generert tekst for formuleringer som kan leses som
    // investeringsråd. Slår filteret ut, blir IKKE utgaven publisert som den er.
    // (Backup til prompt-instruksen — prompten alene garanterer ikke at modellen
    // aldri formulerer noe råd-aktig.)
    const ADVICE_PATTERNS = [
      // --- Direkte kjøps-/salgssignaler ---
      /\bbør\s+(du\s+)?(kjøpe|selge|vurdere\s+å\s+kjøpe|vurdere\s+å\s+selge)/i,
      /\b(kjøp|selg)\s+(nå|denne|aksjen)/i,
      /\b(anbefal|anbefaler|anbefales|anbefaling)/i,
      /\bkursmål\b/i,
      /\b(gå\s+(inn|ut)\s+(i|av))\b/i,
      /\b(en\s+)?(god|gylden|opplagt)\s+(kjøps?mulighet|mulighet\s+til\s+å\s+kjøpe)/i,
      /\b(billig|dyr)\s+(akkurat\s+)?nå/i,
      /\b(vinneraksje|tapsaksje)\b/i,
      /\b(tiden\s+for\s+å\s+(kjøpe|selge|gå\s+inn))/i,
      /\b(verdt\s+å\s+kjøpe|verdt\s+et\s+kjøp)\b/i,
      /\blast\s+opp\b.*\baksj/i,

      // --- Direkte oppfordringer ---
      /\b(du|man)\s+bør\b/i,
      /\bdet\s+lønner\s+seg\b/i,
      /\b(smart|lurt)\s+å\s/i,
      /\bverdt\s+å\s+vurdere\b/i,
      /\bvurder(e)?\s+(å\s+)?(kjøpe|selge)/i,
      /\bikke\s+gå\s+glipp\b/i,
      /\bbenytt\s+sjansen\b/i,
      /\bgrip\s+(muligheten|sjansen)\b/i,
      /\bposisjoner\s+deg\b/i,
      /\bsikre\s+deg\b/i,
      /\bfå\s+med\s+deg\b/i,
      /\bta\s+rygg\b/i,

      // --- Verdivurderinger som antyder handling ---
      /\b(underpriset|overpriset|undervurdert|overvurdert)\b/i,
      /\battraktiv(t)?\s+(prising|nivå|priset|inngang)/i,
      /\bgunstig\s+(inngang|nivå|kjøp|priset)/i,
      /\b(godt|bra)\s+inngangspunkt\b/i,
      /\bbillig\s+på\s+disse\s+nivå/i,
      /\b(en\s+)?god\s+deal\b/i,
      /\bhandles\s+med\s+rabatt\b/i,
      /\b(oppside|nedside)\b/i,
      /\bpotensial(e|et)?\s+til\s+å\s+(stige|øke|doble)/i,
      /\bligger\s+an\s+til\s+å\s+(stige|øke|falle|synke)/i,

      // --- Spådommer om fremtidig kurs ---
      /\bvil\s+(stige|falle|øke|synke)\b/i,
      /\bkommer\s+til\s+å\s+(stige|falle|øke|synke)/i,
      /\bventes\s+å\s+nå/i,
      /\bkan\s+doble\s+seg\b/i,
      /\bpå\s+vei\s+(opp|ned)\b/i,
      /\bser\s+lyst\s+ut\s+fremover\b/i,
      /\b(bunnen|toppen)\s+er\s+nådd/i,
      /\bklar\s+for\s+(oppgang|nedgang)\b/i,

      // --- Myke føringer ---
      /\baksje\s+å\s+følge\s+med\s+på/i,
      /\b(en\s+av\s+)?favoritt/i,
      /\bspennende\s+case\b/i,
      /\baksje\s+for\s+langsiktige\b/i,
      /\bpasser\s+for\s+deg\s+som\b/i,
      /\bnoe\s+for\s+den\s+tålmodige\b/i,
      /\btåler\s+en\s+støyt\b/i,
      /\btrygg\s+havn\b/i,
      /\bdefensivt\s+valg\b/i
    ];
    function flattenText(obj) {
      let out = [];
      (function walk(v) {
        if (v == null) return;
        if (typeof v === 'string') { out.push(v); return; }
        if (Array.isArray(v)) { v.forEach(walk); return; }
        if (typeof v === 'object') { Object.values(v).forEach(walk); return; }
      })(obj);
      return out.join(' \n ');
    }
    function containsAdvice(aiObj) {
      if (!aiObj) return false;
      const text = flattenText(aiObj);
      return ADVICE_PATTERNS.some(re => re.test(text));
    }

    let ai = await generate(null);
    if (!ai) {
      return res.status(500).json({ error: 'Ugyldig JSON fra AI' });
    }

    // Slår filteret ut: prøv ÉN gang til med en strengere instruks.
    if (containsAdvice(ai)) {
      console.warn('BORSBRYGG_GUARDRAIL: råd-aktig formulering oppdaget — prøver på nytt.');
      const retry = await generate([{
        role: 'system',
        content: 'FORRIGE FORSØK INNEHOLDT FORMULERINGER SOM KAN LESES SOM INVESTERINGSRÅD. Skriv om HELE utgaven rent beskrivende. Ingen kjøps-/salgsord, ingen "bør", ingen "anbefal", ingen kursmål, ingen "mulighet"/"billig nå"/"vinneraksje". Beskriv kun hva som skjedde og hvorfor. Svar KUN med gyldig JSON i samme struktur.'
      }]);
      if (retry && !containsAdvice(retry)) {
        ai = retry;
      } else {
        // Fortsatt råd-aktig (eller feil): IKKE publiser. Vis forrige rene utgave.
        console.warn('BORSBRYGG_GUARDRAIL: fortsatt råd-aktig etter nytt forsøk — viser siste utgave i stedet.');
        return await returnLatest();
      }
    }

    // Lagre i Supabase. UNIQUE(date) garanterer maks ÉN utgave per dag.
    const { error: insErr } = await sb.from('borsbrygg_editions').insert({
      date: today,
      title: ai.tittel || ('Børsbrygg ' + today),
      content: ai
    });

    if (insErr) {
      // En annen forespørsel rakk å lage dagens utgave først (unik-konflikt på date).
      // Hent den LAGREDE utgaven og returner DEN, så alle får nøyaktig samme innhold.
      const { data: canonical } = await sb
        .from('borsbrygg_editions')
        .select('content')
        .eq('date', today)
        .maybeSingle();
      if (canonical && canonical.content) {
        return res.status(200).json(canonical.content);
      }
    }

    return res.status(200).json(ai);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
