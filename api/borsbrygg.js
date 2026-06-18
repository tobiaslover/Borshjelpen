import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

// Seriøse, redaksjonelle finanskilder vi tillater i nyhetsdigesten. Alt annet
// (YouTube, blogger, forum, innholdsfarmer, ukjente domener) kastes FØR det når
// AI-en. Hviteliste er tryggere enn svarteliste: ukjente kilder avvises som
// standard. Matches mot n.site / n.url (domene) og n.publisher, case-insensitivt.
const TRUSTED_NEWS_SOURCES = [
  'reuters.com', 'bloomberg.com', 'ft.com', 'wsj.com', 'cnbc.com',
  'marketwatch.com', 'forbes.com', 'businessinsider.com', 'apnews.com',
  'theguardian.com', 'economist.com', 'barrons.com', 'fortune.com',
  'investing.com', 'seekingalpha.com', 'morningstar.com', 'nasdaq.com',
  'finance.yahoo.com', 'yahoo.com', 'spglobal.com', 'kitco.com',
  'oilprice.com', 'tradingeconomics.com', 'zacks.com', 'benzinga.com',
  // Norske/nordiske redaksjonelle finanskilder (dersom de dukker opp i feeden)
  'e24.no', 'dn.no', 'finansavisen.no', 'nrk.no', 'hegnar.no',
  'kapital.no', 'borsen.dk', 'di.se', 'bloomberg.net'
];

// Domener vi ALDRI tillater, selv om noe skulle matche løst over. Eksplisitt
// blokk av video-/sosiale/UGC-plattformer som ikke er redaksjonelle nyhetskilder.
const BLOCKED_NEWS_SOURCES = [
  'youtube.com', 'youtu.be', 'reddit.com', 'twitter.com', 'x.com',
  'facebook.com', 'instagram.com', 'tiktok.com', 'medium.com',
  'substack.com', 'blogspot.', 'wordpress.', 'stocktwits.com',
  'discord', 'telegram'
];

// Avgjør om en nyhet kommer fra en betrodd kilde. Sjekker både oppgitt
// publisher/site og selve lenken (domenet), siden FMP varierer hvilket felt
// som er satt. Blokkliste vinner alltid over hviteliste.
function isTrustedSource(n) {
  const hay = [
    (n && n.site) || '',
    (n && n.publisher) || '',
    (n && n.url) || '',
    (n && n.link) || ''
  ].join(' ').toLowerCase();

  if (!hay.trim()) return false; // ingen kilde oppgitt -> ikke til å stole på
  if (BLOCKED_NEWS_SOURCES.some(b => hay.includes(b))) return false;
  return TRUSTED_NEWS_SOURCES.some(t => hay.includes(t));
}

/**
 * Henter ekte MAKRO-/markedsnyheter server-side og bygger en kompakt digest.
 * (FMP dekker ikke norske selskapsnyheter, så vi bruker kun den generelle feeden.)
 * Digesten sendes KUN til AI-en som kontekst — den returneres aldri til klienten.
 * Feiler kilden, returneres tom streng, og prompten ber AI-en hoppe over nyheter
 * i stedet for å dikte. KUN nyheter fra betrodde kilder slipper gjennom.
 */
async function fetchNewsDigest() {
  const key = process.env.FMP_API_KEY;
  const items = [];

  function asArray(d) {
    if (Array.isArray(d)) return d;
    if (d && Array.isArray(d.content)) return d.content;
    if (d && Array.isArray(d.news)) return d.news;
    if (d && Array.isArray(d.data)) return d.data;
    return [];
  }

  const endpoints = [
    `https://financialmodelingprep.com/stable/news/general-latest?limit=50&apikey=${key}`,
    `https://financialmodelingprep.com/stable/news/stock-latest?limit=50&apikey=${key}`
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url);
      const body = res.ok ? await res.json() : null;
      const arr = asArray(body);
      console.log('BORSBRYGG_NEWS', url.split('/').pop().split('?')[0], 'status', res.status, 'count', arr.length);
      if (arr.length) { items.push(...arr); break; }
    } catch (e) {
      console.error('FMP news feil:', e.message);
    }
  }

  if (!items.length) return '';

  // KILDEFILTER: kast alt som ikke kommer fra en betrodd, redaksjonell kilde.
  const trusted = items.filter(isTrustedSource);
  console.log('BORSBRYGG_NEWS_FILTER', 'rå', items.length, 'betrodde', trusted.length);
  if (!trusted.length) return ''; // ingen seriøse kilder -> hopp over nyheter helt

  // Dedupliser på tittel, sorter nyeste først, kutt til ~20 og trim teksten.
  const seen = new Set();
  const digest = trusted
    .filter(n => n && n.title && !seen.has(n.title) && seen.add(n.title))
    .sort((a, b) => new Date(b.publishedDate || b.date || 0) - new Date(a.publishedDate || a.date || 0))
    .slice(0, 20)
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

// Bygger et FAST øyeblikksbilde av vinnere/tapere som lagres SAMMEN med utgaven.
async function buildMoversSnapshot(fromBody) {
  const pick = s => ({ ticker: s.ticker, name: s.name, changePct: s.changePct, up: s.up });
  if (fromBody && Array.isArray(fromBody.winners) && Array.isArray(fromBody.losers)
      && (fromBody.winners.length || fromBody.losers.length)) {
    return {
      winners: fromBody.winners.slice(0, 3).map(pick),
      losers: fromBody.losers.slice(0, 3).map(pick),
      _frozen_at: new Date().toISOString()
    };
  }
  try {
    const data = await fetch('https://borshjelpen.no/api/movers?scope=all').then(r => r.json());
    const all = Array.isArray(data && data.all) ? data.all : [];
    const gainers = all.filter(s => s.changePctRaw > 0);
    const fallers = all.filter(s => s.changePctRaw < 0);
    return {
      winners: gainers.slice(0, 3).map(pick),
      losers: fallers.slice().reverse().slice(0, 3).map(pick),
      _frozen_at: new Date().toISOString()
    };
  } catch (e) {
    return { winners: [], losers: [], _frozen_at: new Date().toISOString() };
  }
}

// Bygger markedskonteksten SERVER-SIDE fra movers, slik at fortegnet ALLTID er
// korrekt (via changePctRaw) uansett hvem som trigger genereringen.
async function buildMarketContext() {
  try {
    const movers = await fetch('https://borshjelpen.no/api/movers?scope=all').then(r => r.json());
    const all = movers && Array.isArray(movers.all) ? movers.all : [];
    if (!all.length) return { ok: false };

    const fmt = s => `${s.name} (${s.ticker}): ${s.price} NOK, ${s.changePctRaw >= 0 ? '+' : '-'}${s.changePct}%`;
    const gainers = all.filter(s => s.changePctRaw > 0);
    const fallers = all.filter(s => s.changePctRaw < 0);
    const flat    = all.filter(s => s.changePctRaw === 0);
    const topGainers = gainers.slice(0, 5);
    const topFallers = fallers.slice().reverse().slice(0, 5);

    const idx = movers.osebx || movers.obx || null;
    const idxName = movers.osebx ? 'OSEBX' : (movers.obx ? 'OBX' : null);
    const hasIndexData = !!idx;
    const indexLine = hasIndexData
      ? `INDEKS (FAKTISK indeksdata fra FMP): ${idxName} ${idx.price}, ${idx.up ? '+' : '-'}${idx.changePct}%. Dette er ekte indeksdata — du KAN oppgi denne samlede børsretningen.`
      : `INDEKS: Ingen offisiell OSEBX/OBX-indeksdata er tilgjengelig i dag. Du skal derfor IKKE oppgi en samlet børsretning eller noe indekstall ("Oslo Børs steg/falt X%"). Beskriv i stedet konkret hvilke av de største aksjene som steg og hvilke som falt.`;
    const breadthLine = `Bredde blant ${all.length} aksjer på Oslo Børs: ${gainers.length} steg, ${fallers.length} falt${flat.length ? `, ${flat.length} uendret` : ''}. (Dette beskriver bredden i utvalget — det er IKKE det samme som hele den markedsvekt-justerte hovedindeksens retning.)`;

    // OBX-vinnere/tapere (kjente, store selskaper) — movers.winners/losers er nå
    // OBX-baserte ved scope=all. Disse løftes eksplisitt frem så AI-en ALLTID har
    // gjenkjennelige selskaper å skrive om, ikke bare ukjente mikroaksjer.
    const obxWin = Array.isArray(movers.winners) ? movers.winners : [];
    const obxLos = Array.isArray(movers.losers) ? movers.losers : [];
    const fmtSimple = s => `${s.name} (${s.ticker}): ${s.up ? '+' : '-'}${s.changePct}%`;
    const obxLine = (obxWin.length || obxLos.length)
      ? `STORE, KJENTE OBX-AKSJER i går — disse SKAL nevnes i oppsummeringen (minst 2 av dem): `
        + `Opp: ${obxWin.slice(0,5).map(fmtSimple).join('; ')}. `
        + `Ned: ${obxLos.slice(0,5).map(fmtSimple).join('; ')}.`
      : null;

    const parts = [
      indexLine,
      breadthLine,
      obxLine,
      topGainers.length ? `Størst oppgang i går (hele børsen): ${topGainers.map(fmt).join('; ')}.` : null,
      topFallers.length ? `Størst nedgang i går (hele børsen): ${topFallers.map(fmt).join('; ')}.` : null,
      `De største bevegelsene på Oslo Børs (sortert størst opp -> størst ned, topp 40): ${all.slice(0, 40).map(fmt).join('; ')}.`
    ].filter(Boolean);

    const pick = s => ({ ticker: s.ticker, name: s.name, changePct: s.changePct, up: s.up });
    return {
      ok: true,
      stockSummary: parts.join('\n\n'),
      hasIndexData,
      moversSnapshot: {
        winners: topGainers.slice(0, 3).map(pick),
        losers: topFallers.slice(0, 3).map(pick)
      }
    };
  } catch (e) {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// SPRÅKKORREKTUR
// ---------------------------------------------------------------------------
// 1) Harde regler: spesifikke kjente feil rettes deterministisk, uansett hva
//    AI-en gjør. Disse er garantert fanget. Utvid lista når du ser nye feil.
const HARD_FIXES = [
  [/\bp(å|aa)\s+den\s+annen\s+side\b/gi, 'på den andre siden'],
  [/\bp(å|aa)\s+den\s+ene\s+side\b/gi, 'på den ene siden'],
];

function applyHardFixes(str) {
  if (typeof str !== 'string') return str;
  let out = str;
  for (const [re, rep] of HARD_FIXES) out = out.replace(re, rep);
  return out;
}

// Går rekursivt gjennom alle strenger i utgaven og bruker de harde reglene.
function hardFixDeep(obj) {
  if (obj == null) return obj;
  if (typeof obj === 'string') return applyHardFixes(obj);
  if (Array.isArray(obj)) return obj.map(hardFixDeep);
  if (typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj)) out[k] = hardFixDeep(obj[k]);
    return out;
  }
  return obj;
}

// 2) AI-korrektur: et eget, billig kall som KUN retter språk/grammatikk uten å
//    endre innhold, tall, struktur eller mening. Returnerer korrigert objekt
//    eller null ved feil (da beholdes originalen).
async function proofread(openai, aiObj) {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 2800,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Du er en norsk korrekturleser. Du får et JSON-objekt med en børsoppsummering på norsk bokmål. Din ENESTE oppgave er å rette språk: stavefeil, grammatikk, tegnsetting, ordvalg og unaturlige/gammelmodige formuleringer, slik at teksten blir korrekt, moderne og flytende norsk bokmål.

STRENGE REGLER:
- IKKE endre tall, prosenter, tickere, selskapsnavn, datoer eller kilder.
- IKKE endre meningen, strukturen eller hvilke nøkler/felter som finnes.
- IKKE legg til eller fjern informasjon. IKKE finn på noe.
- Behold nøyaktig samme JSON-struktur og de samme nøklene (ASCII-nøkler).
- Rett unaturlige uttrykk til naturlig norsk (f.eks. "på den annen side" -> "på den andre siden").
- Returner KUN det korrigerte JSON-objektet, ingenting annet.`
        },
        { role: 'user', content: JSON.stringify(aiObj) }
      ]
    });
    const parsed = JSON.parse(completion.choices[0].message.content);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    console.error('BORSBRYGG_PROOFREAD feil:', e.message);
    return null;
  }
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

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Ikke autentisert' });
  }
  const token = authHeader.replace('Bearer ', '');
  const isCron = !!process.env.CRON_SECRET && token === process.env.CRON_SECRET;
  if (!isCron) {
    const { data: { user }, error: authError } = await sb.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Ugyldig token' });
  }

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });

  const osloDow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Oslo' })).getDay();
  const isGenerationDay = (osloDow >= 2 && osloDow <= 6);

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

  if (!isGenerationDay) {
    return await returnLatest();
  }

  let { stockSummary, hasIndexData, moversSnapshot } = req.body || {};

  const ctx = await buildMarketContext();
  if (ctx.ok) {
    stockSummary = ctx.stockSummary;
    hasIndexData = ctx.hasIndexData;
    moversSnapshot = ctx.moversSnapshot;
  }

  if (!stockSummary) {
    return await returnLatest();
  }
  const indexDataPresent = hasIndexData === true;

  const newsDigest = await fetchNewsDigest();

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const messages = [
        {
          role: 'system',
          content: `Du er Børshjelpen sin daglige børskommentator — du skriver som en engasjert, ærlig venn som kan finans godt. Tonen er varm, direkte og forklarende — som en god morgenavis skrevet av noen som faktisk bryr seg om at leseren forstår. Ikke kald, ikke robotaktig. Bruk konkrete tall og eksempler. Forklar "hvorfor" bak tallene, ikke bare hva som skjedde.

SPRÅK (viktig): Skriv korrekt, moderne norsk bokmål. Unngå gammelmodige eller unaturlige formuleringer (skriv f.eks. "på den andre siden", ALDRI "på den annen side"). Riktig tegnsetting og rettskriving er et krav. Les gjennom og rett feil før du svarer.

VIKTIG OM FAKTA — IKKE DIKT:
Nederst i brukermeldingen får du (1) faktisk kursdata og ofte (2) en liste med FAKTISKE NYHETER fra siste døgn.
- Feltene "nyheter", "globale_faktorer" og ALLE "kilde"-felt skal UTELUKKENDE bygge på de oppgitte nyhetene og kursdataen.
- Sett "kilde" til den faktiske kilden som står oppgitt for nyheten. Finn ALDRI opp en kilde.
- Finn ALDRI opp nyheter, hendelser, tall, sitater eller selskapshendelser som ikke står i dataene.
- Får du INGEN nyheter oppgitt: returner tom "nyheter"-liste, og hold "globale_faktorer" generell og forsiktig uten å påstå spesifikke hendelser du ikke har dekning for.

INGEN OPPDIKTET SAMLET BØRSRETNING — SVÆRT VIKTIG:
- Øverst i kursdataen får du enten en INDEKS-linje med FAKTISK indeksverdi (OSEBX/OBX), ELLER beskjed om at ingen offisiell indeksdata finnes.
- KUN hvis du faktisk får en indeksverdi, kan du skrive at "Oslo Børs / OSEBX steg/falt X %". Bruk da tallet som er oppgitt — finn aldri på et eget.
- Får du IKKE indeksdata: påstå ALDRI en samlet børs- eller indeksretning, og finn ALDRI opp et indekstall (f.eks. "Oslo Børs steg 1,12 %"). Et utvalg enkeltaksjer er IKKE den markedsvekt-justerte hovedindeksen og kan peke FEIL vei. Dette gjelder også tittelen.
- Beskriv da i stedet konkret hvilke av de største aksjene som steg og hvilke som falt. Du kan henvise til bredde-tallet ("blant de største steg X og falt Y"), men kall det aldri "Oslo Børs steg/falt".

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
  "hva_skjedde": "5-7 setninger om hva som skjedde blant de største aksjene på Oslo Børs I GÅR. VIKTIG: Du SKAL nevne minst 2 store, kjente OBX-selskaper ved navn (de står oppgitt under 'STORE, KJENTE OBX-AKSJER' i kursdataen — f.eks. Equinor, DNB, Aker BP, Norsk Hydro, Telenor, Mowi, Yara, Kongsberg). Skriv for NYBEGYNNERE: de kjenner de store selskapene, ikke ukjente mikroaksjer. Du kan gjerne også nevne en interessant liten bevegelse, men de kjente selskapene må være med. Gi vinnere og tapere LIKE mye plass: forklar både hvem som steg mest og hvem som falt mest, med faktiske tall. Når aksjer beveget seg i hver sin retning samme dag (f.eks. en oljeaksje opp mens en forsvars- eller teknologiaksje ned), forklar HVORFOR de divergerte — ulike sektorer reagerer på ulike drivere (oljepris, renter, kvartalstall, sektorrotasjon, gevinstsikring). Ta også med en eller to mindre opplagte bevegelser blant de største. Bruk faktiske tall fra kursdataen, og forklar HVORFOR de største bevegelsene skjedde der du har grunnlag for det. IKKE påstå en samlet børs- eller indeksretning med mindre du faktisk har fått indeksdata oppgitt.",
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
      "forklaring": "Konkret forklaring på hva som skjedde med aksjen og HVORFOR — bruk faktiske tall. Lag denne listen FYLDIG: ta med både de største vinnerne OG de største taperne du har data på (sikt på 5-7 aksjer totalt, og minst like mange tapere som vinnere når begge finnes). Forklar nedgangene like grundig som oppgangene — f.eks. hvorfor falt KOG 5 % samme dag som EQNR steg? Pek på den faktiske driveren (sektor, oljepris, renter, kvartalstall, gevinstsikring) der du har grunnlag for det, og ikke bare konstater at aksjen gikk ned."
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
              : '\n\nIngen nyheter er tilgjengelige akkurat nå. Returner tom "nyheter"-liste og hold "globale_faktorer" generell uten å påstå konkrete hendelser.') +
            '\n\nVARIASJON: Skriv en helt fersk utgave forankret i DAGENS konkrete tall over. ' +
            'La faktiske selskaper, prosenter og bevegelser fra kursdataene drive teksten, og nevn dem eksplisitt. ' +
            'Ikke bruk generiske, gjenbrukbare formuleringer som kunne passet en hvilken som helst dag — ' +
            'en leser skal kunne se at teksten gjelder nettopp denne børsdagen. Unngå å resirkulere standardfraser om markedet.'
        }
      ];

    async function generate(extraMessages) {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 2800,
        temperature: 0.6,
        response_format: { type: 'json_object' },
        messages: extraMessages ? messages.concat(extraMessages) : messages
      });
      try {
        return JSON.parse(completion.choices[0].message.content);
      } catch (e) {
        return null;
      }
    }

    const ADVICE_PATTERNS = [
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
      /\bvil\s+(stige|falle|øke|synke)\b/i,
      /\bkommer\s+til\s+å\s+(stige|falle|øke|synke)/i,
      /\bventes\s+å\s+nå/i,
      /\bkan\s+doble\s+seg\b/i,
      /\bpå\s+vei\s+(opp|ned)\b/i,
      /\bser\s+lyst\s+ut\s+fremover\b/i,
      /\b(bunnen|toppen)\s+er\s+nådd/i,
      /\bklar\s+for\s+(oppgang|nedgang)\b/i,
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

    const INDEX_DIRECTION_PATTERNS = [
      /\boslo\s*børs(en)?\b[^.]{0,60}?\b(steg|falt|stiger|faller|gikk\s+(opp|ned)|endte\s+(opp|ned|i\s+(pluss|minus))|klatret|stupte|sank|løftet\s+seg|trakk\s+(opp|ned))/i,
      /\b(osebx|obx|hovedindeksen|hovedindeks|referanseindeksen)\b[^.]{0,60}?\b(steg|falt|stiger|faller|gikk\s+(opp|ned)|endte|opp|ned|i\s+(pluss|minus)|klatret|stupte|sank)/i,
      /\b(børsen|markedet)\s+(samlet\s+)?(steg|falt|stiger|faller|gikk\s+(opp|ned)|endte\s+(opp|ned|i\s+(pluss|minus)))/i,
      /\b(oslo\s*børs|osebx|obx|hovedindeksen|hovedindeks)\b[^.]{0,40}?[+\-]?\d+[.,]\d+\s*%/i
    ];
    function claimsAggregateDirection(aiObj) {
      if (!aiObj) return false;
      return INDEX_DIRECTION_PATTERNS.some(re => re.test(flattenText(aiObj)));
    }

    function failsGuardrails(aiObj) {
      if (containsAdvice(aiObj)) return 'advice';
      if (!indexDataPresent && claimsAggregateDirection(aiObj)) return 'index';
      return null;
    }
    const RETRY_INSTRUCTIONS = {
      advice: 'FORRIGE FORSØK INNEHOLDT FORMULERINGER SOM KAN LESES SOM INVESTERINGSRÅD. Skriv om HELE utgaven rent beskrivende. Ingen kjøps-/salgsord, ingen "bør", ingen "anbefal", ingen kursmål, ingen "mulighet"/"billig nå"/"vinneraksje". Beskriv kun hva som skjedde og hvorfor. Svar KUN med gyldig JSON i samme struktur.',
      index: 'FORRIGE FORSØK PÅSTOD EN SAMLET BØRS- ELLER INDEKSRETNING UTEN AT DET FINNES FAKTISK INDEKSDATA. Skriv om HELE utgaven uten å si at "Oslo Børs / OSEBX / OBX / hovedindeksen / markedet steg eller falt", og uten noe indekstall. Beskriv KUN de konkrete aksjene som steg og falt, med faktiske tall. Svar KUN med gyldig JSON i samme struktur.'
    };

    let ai = await generate(null);
    if (!ai) {
      return res.status(500).json({ error: 'Ugyldig JSON fra AI' });
    }

    const problem = failsGuardrails(ai);
    if (problem) {
      console.warn('BORSBRYGG_GUARDRAIL: ' + problem + ' oppdaget — prøver på nytt.');
      const retry = await generate([{ role: 'system', content: RETRY_INSTRUCTIONS[problem] }]);
      if (retry && !failsGuardrails(retry)) {
        ai = retry;
      } else {
        console.warn('BORSBRYGG_GUARDRAIL: fortsatt problem etter nytt forsøk — viser siste utgave i stedet.');
        return await returnLatest();
      }
    }

    // SPRÅKKORREKTUR (Nivå 2): kjør et eget korrektur-kall som retter språk uten
    // å endre innhold. Verifiser at guardrails fortsatt holder etter korrektur —
    // hvis korrekturen mot formodning skulle innføre noe råd-/indeks-aktig, eller
    // feile, beholder vi originalen. Til slutt brukes de harde reglene uansett.
    const proofed = await proofread(openai, ai);
    if (proofed && !failsGuardrails(proofed)) {
      ai = proofed;
    }
    // Harde regler kjøres ALLTID til slutt — garantert retting av kjente feil.
    ai = hardFixDeep(ai);

    ai.movers = await buildMoversSnapshot(moversSnapshot);

    const { error: insErr } = await sb.from('borsbrygg_editions').insert({
      date: today,
      title: ai.tittel || ('Børsbrygg ' + today),
      content: ai
    });

    if (insErr) {
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
