import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET /api/borsbrygg?date=2026-06-02 — hent én arkivutgave
  if (req.method === 'GET') {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'date mangler' });
    const { data, error } = await sb
      .from('borsbrygg_editions')
      .select('*')
      .eq('date', date)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Ikke funnet' });
    return res.status(200).json(data);
  }

  // POST — generer dagens utgave (eller returner cached)
  if (req.method !== 'POST') return res.status(405).end();

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' }); // YYYY-MM-DD

  // Sjekk om dagens utgave allerede finnes
  const { data: existing } = await sb
    .from('borsbrygg_editions')
    .select('*')
    .eq('date', today)
    .single();

  if (existing) {
    return res.status(200).json(existing.content);
  }

  // Generer ny utgave
  const { stockSummary } = req.body;
  if (!stockSummary) return res.status(400).json({ error: 'stockSummary mangler' });

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 1800,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Du er Børshjelpen sin daglige børskommentator. Du skriver for norske nybegynnere som aldri har investert før. 
Svar KUN med gyldig JSON på norsk bokmål. Ikke bruk finanssjargong uten å forklare det.

JSON-struktur:
{
  "tittel": "Kort tittel for dagens utgave (maks 10 ord)",
  "hva_skjedde": "2-3 setninger om hva som skjedde på Oslo Børs i dag",
  "globale_faktorer": "2-3 setninger om globale faktorer som påvirket børsen",
  "nyheter": [
    { "tittel": "Nyhetstittel", "tekst": "2-3 setninger", "aksje": "TICKER eller null", "kilde": "Kildetype" }
  ],
  "aksje_påvirkning": [
    { "ticker": "EQNR", "navn": "Equinor", "forklaring": "Kort forklaring" }
  ],
  "risiko": "2-3 setninger om risikoer å holde øye med",
  "nybegynner_tips": {
    "overskrift": "Kort overskrift for dagens tips (f.eks. 'Hva er P/E-tall?')",
    "intro": "1-2 setninger som introduserer konseptet enkelt",
    "punkter": [
      "Punkt 1 — kort og konkret",
      "Punkt 2 — kort og konkret",
      "Punkt 3 — kort og konkret",
      "Punkt 4 — kort og konkret"
    ],
    "konklusjon": "1 setning som oppsummerer hvorfor dette er nyttig å vite"
  }
}`
        },
        {
          role: 'user',
          content: `Dagens kursdata fra Oslo Børs: ${stockSummary}`
        }
      ]
    });

    const raw = completion.choices[0].message.content;
    const ai = JSON.parse(raw);

    // Lagre i Supabase
    await sb.from('borsbrygg_editions').insert({
      date: today,
      title: ai.tittel || 'Børsbrygg ' + today,
      content: ai
    });

    return res.status(200).json(ai);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
