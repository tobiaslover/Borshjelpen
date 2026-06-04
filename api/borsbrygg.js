import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
    } catch(e) {
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

  // Sjekk cache
  try {
    const { data: existing } = await sb
      .from('borsbrygg_editions')
      .select('content')
      .eq('date', today)
      .maybeSingle();
    if (existing && existing.content) {
      return res.status(200).json(existing.content);
    }
  } catch(e) {}

  const { stockSummary } = req.body || {};
  if (!stockSummary) return res.status(400).json({ error: 'stockSummary mangler' });

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 2000,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Du er Børshjelpen sin daglige børskommentator — du skriver som en engasjert, ærlig venn som kan finans godt. Tonen er varm, direkte og forklarende — som en god morgenavis skrevet av noen som faktisk bryr seg om at leseren forstår. Ikke kald, ikke robotaktig. Bruk konkrete tall og eksempler. Forklar "hvorfor" bak tallene, ikke bare hva som skjedde.

Svar KUN med gyldig JSON. Bruk BARE ASCII-kompatible nøkkelnavn (ingen æøå i JSON-nøkler).

JSON-struktur (bruk eksakt disse nøklene):
{
  "tittel": "Engasjerende tittel på maks 10 ord — som en avisoverskrift, ikke en rapport",
  "hva_skjedde": "3-4 setninger om hva som skjedde på Oslo Børs I GÅR. Vær konkret — bruk faktiske tall fra kursdataen. Forklar HVORFOR børsen gikk opp eller ned, ikke bare at den gjorde det.",
  "globale_faktorer": "2-3 setninger om globale faktorer som påvirket børsen I GÅR. Hva skjedde i USA, Kina, med oljeprisen, rentene eller valutamarkedet som spilte inn?",
  "nyheter": [
    {
      "tittel": "Konkret og interessant overskrift",
      "tekst": "2-3 setninger som forklarer nyheten og hva den betyr for investorer — skriv som til en venn, ikke som en pressemelding",
      "aksje": "TICKER eller null",
      "kilde": "Kildetype"
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
          content: 'Kursdata fra gårsdagens børsdag på Oslo Børs: ' + stockSummary
        }
      ]
    });

    const raw = completion.choices[0].message.content;
    let ai;
    try {
      ai = JSON.parse(raw);
    } catch(e) {
      return res.status(500).json({ error: 'Ugyldig JSON fra AI: ' + e.message });
    }

    // Lagre i Supabase
    try {
      await sb.from('borsbrygg_editions').insert({
        date: today,
        title: ai.tittel || ('Børsbrygg ' + today),
        content: ai
      });
    } catch(e) {
      console.error('Supabase insert feil:', e.message);
    }

    return res.status(200).json(ai);
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
}
