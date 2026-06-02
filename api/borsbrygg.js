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
      max_tokens: 1800,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Du er Børshjelpen sin daglige børskommentator for norske nybegynnere.
Svar KUN med gyldig JSON. Bruk BARE ASCII-kompatible nøkkelnavn (ingen æøå i JSON-nøkler).

JSON-struktur (bruk eksakt disse nøklene):
{
  "tittel": "Kort tittel maks 10 ord",
  "hva_skjedde": "2-3 setninger om hva som skjedde på Oslo Børs",
  "globale_faktorer": "2-3 setninger om globale faktorer",
  "nyheter": [
    { "tittel": "Nyhetstittel", "tekst": "2-3 setninger", "aksje": "TICKER eller null", "kilde": "Kildetype" }
  ],
  "aksje_paavirkning": [
    { "ticker": "EQNR", "navn": "Equinor", "forklaring": "Kort forklaring" }
  ],
  "risiko": "2-3 setninger om risikoer",
  "nybegynner_tips": {
    "overskrift": "Kort overskrift f.eks. Hva er P/E-tall?",
    "intro": "1-2 setninger som introduserer konseptet",
    "punkter": ["Punkt 1", "Punkt 2", "Punkt 3", "Punkt 4"],
    "konklusjon": "1 setning som oppsummerer hvorfor dette er nyttig"
  }
}`
        },
        {
          role: 'user',
          content: 'Dagens kursdata: ' + stockSummary
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
      // Logg men ikke feile — returner innhold uansett
      console.error('Supabase insert feil:', e.message);
    }

    return res.status(200).json(ai);
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
}
