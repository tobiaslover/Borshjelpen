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

  let user, plan;
  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data: { user: u }, error: authError } = await sb.auth.getUser(token);
    if (authError || !u) return res.status(401).json({ error: 'Ugyldig token' });
    user = u;
    // Porteføljeanalyse er KUN for Proff — håndheves server-side, ikke bare i UI.
    const { data: planData } = await sb.from('user_plans').select('plan').eq('user_id', user.id).maybeSingle();
    plan = planData?.plan || 'free';
  } catch (e) {
    return res.status(500).json({ error: 'Klarte ikke å verifisere bruker: ' + e.message });
  }

  if (plan !== 'proff') {
    return res.status(403).json({ error: 'Porteføljeanalyse krever Proff', plan });
  }

  const { portfolio, total } = req.body || {};
  if (!Array.isArray(portfolio) || portfolio.length < 2) {
    return res.status(400).json({ error: 'Legg til minst to aksjer for å analysere porteføljen.' });
  }

  // Bygg porteføljetekst server-side (kun ticker/navn/sektor/andel — ingen kursdata)
  const portfolioText = portfolio
    .map(p => `${p.ticker} (${p.name || p.ticker}, ${p.sector || 'ukjent sektor'}): ${p.pct}% av porteføljen`)
    .join('\n');
  const totalPct = typeof total === 'number'
    ? total
    : portfolio.reduce((sum, p) => sum + (parseFloat(p.pct) || 0), 0);

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 1100,
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content: `Du er Børshjelpen sin porteføljeanalytiker — du snakker som en klok, ærlig venn som kan finans godt. Du analyserer en privatinvestors aksjeportefølje på Oslo Børs for en norsk nybegynner. Tonen er varm, konkret og forklarende, aldri kald eller robotaktig.

REGLER:
- Gi ALDRI kjøps- eller salgsanbefalinger, og foreslå ALDRI å kjøpe eller selge spesifikke aksjer. Beskriv heller egenskaper, risiko og avveininger, og la beslutningen være leserens.
- Skriv på naturlig norsk bokmål. Forklar faguttrykk kort når du bruker dem.
- Vær konkret — bruk de faktiske aksjene, sektorene og prosentandelene som er oppgitt.
- IKKE DIKT: du har KUN ticker, navn, sektor og andel — ikke kurser, nøkkeltall eller nyheter. Påstå aldri konkrete tall, kurser eller hendelser du ikke har fått oppgitt.
- Avslutt alltid med setningen: "Dette er ikke finansiell rådgivning."

Strukturer svaret med korte fete deloverskrifter på formen **Tekst:** og bruk punktlister med "-". Dekk disse delene:
- **Sektorfordeling:** Hvordan porteføljen fordeler seg på sektorer, og om den er konsentrert eller bredt spredt.
- **Konsentrasjonsrisiko:** Om én enkelt aksje eller sektor utgjør en uforholdsmessig stor andel, og hva det betyr for risikoen.
- **Diversifisering:** Hvor godt spredt risikoen er, og om flere posisjoner trolig beveger seg likt (f.eks. henger energi-/oljeaksjer sammen med oljeprisen, sjømat med lakseprisen).
- **Allokering:** Kommenter på total allokering — under, lik eller over 100% — og hva det innebærer (kontantandel, eller mer enn fullt investert).
- **Verdt å tenke på:** 2-4 konkrete, balanserte punkter investoren bør reflektere over, uten kjøps- eller salgsråd.`
        },
        {
          role: 'user',
          content: `Analyser denne aksjeporteføljen:\n\n${portfolioText}\n\nTotal allokering: ${Number(totalPct).toFixed(0)}%`
        }
      ]
    });

    res.status(200).json({ reply: completion.choices[0].message.content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
