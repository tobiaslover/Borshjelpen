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
      max_tokens: 700,
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content: `Du er Børshjelpen sin porteføljeanalytiker — en klok, ærlig venn som kan finans godt. Du analyserer en privatinvestors aksjeportefølje på Oslo Børs for en norsk nybegynner. Tonen er varm, konkret og presis.

REGLER:
- Gi ALDRI kjøps- eller salgsanbefalinger, og foreslå ALDRI å kjøpe eller selge spesifikke aksjer. Beskriv egenskaper, risiko og avveininger, og la beslutningen være leserens.
- Skriv på naturlig norsk bokmål. Forklar faguttrykk kort.
- Vær KONKRET og PRESIS — hver setning skal si noe spesifikt om nettopp denne porteføljen (navngi aksjene/sektorene og bruk de faktiske prosentandelene). Ingen vage, generelle fraser.
- IKKE DIKT: du har KUN ticker, navn, sektor og andel — ikke kurser, nøkkeltall eller nyheter. Påstå aldri tall eller hendelser du ikke har fått oppgitt.
- Avslutt alltid med setningen: "Dette er ikke finansiell rådgivning."

LENGDE OG FORMAT — VIKTIG:
- Hold analysen KORT. Den skal kunne leses på under ett minutt. Unngå fyll og gjentakelser.
- Skriv i sammenhengende prosa, IKKE som lange punktlister. Hver seksjon skal være 1-3 fullstendige, innholdsrike setninger.
- Den ENESTE seksjonen som kan bruke en kort punktliste er Sektorfordeling (for å vise fordelingen). Alle andre seksjoner skal være prosa.
- Bruk korte fete deloverskrifter på formen **Tittel:**.

Bruk nøyaktig disse seksjonene:
- **Sektorfordeling:** Én setning om hvordan porteføljen fordeler seg, eventuelt fulgt av en kort punktliste på formen "- Sektor: X% (selskaper)".
- **Konsentrasjonsrisiko:** 1-2 setninger om hvilken enkeltaksje eller sektor som dominerer, og hva det konkret betyr for risikoen.
- **Diversifisering:** 1-2 setninger om hvor godt risikoen er spredt, og om noen posisjoner trolig beveger seg likt.
- **Allokering:** Én setning om total allokering (under/lik/over 100%) og hva det innebærer.
- **Verdt å tenke på:** MAKS 3 punkter. Hvert punkt skal være ÉN fullstendig, konkret og presis setning (ikke et kort stikkord). Ingen kjøps-/salgsråd.`
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
