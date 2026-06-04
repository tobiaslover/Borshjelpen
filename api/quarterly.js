
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Ikke autentisert' });
  const token = authHeader.replace('Bearer ', '');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: { user }, error: authError } = await sb.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Ugyldig token' });

  const { ticker, name } = req.body || {};
  if (!ticker) return res.status(400).json({ error: 'Ticker mangler' });

  // Kun Proff-plan
  const { data: planData } = await sb.from('user_plans').select('plan').eq('user_id', user.id).maybeSingle();
  const plan = planData?.plan || 'free';
  if (plan !== 'proff') {
    return res.status(403).json({ error: 'Kvartalsrapporter krever Proff-abonnement.', plan });
  }

  const olSymbol = ticker.toUpperCase() + '.OL';
  const apiKey = process.env.FMP_API_KEY;

  try {
    // Hent siste 5 kvartaler parallelt
    const [incomeRes, cashflowRes, earningsRes] = await Promise.all([
      fetch(`https://financialmodelingprep.com/stable/income-statement?symbol=${olSymbol}&period=quarter&limit=5&apikey=${apiKey}`),
      fetch(`https://financialmodelingprep.com/stable/cash-flow-statement?symbol=${olSymbol}&period=quarter&limit=2&apikey=${apiKey}`),
      fetch(`https://financialmodelingprep.com/stable/earnings-surprises?symbol=${olSymbol}&limit=4&apikey=${apiKey}`),
    ]);

    let income = [], cashflow = [], earnings = [];
    if (incomeRes.ok) { try { income = await incomeRes.json(); } catch(e) {} }
    if (cashflowRes.ok) { try { cashflow = await cashflowRes.json(); } catch(e) {} }
    if (earningsRes.ok) { try { earnings = await earningsRes.json(); } catch(e) {} }

    if (!Array.isArray(income) || !income.length) {
      return res.status(404).json({ error: 'Ingen kvartalsdata tilgjengelig for ' + ticker });
    }

    const latest = income[0];
    const yearAgo = income[4] || null; // Samme kvartal i fjor
    const cf = Array.isArray(cashflow) ? cashflow[0] : null;
    const latestEarnings = Array.isArray(earnings) ? earnings[0] : null;

    // Hjelpefunksjon
    function fmtB(val, currency = 'USD') {
      if (!val) return '—';
      const abs = Math.abs(val);
      const sign = val < 0 ? '-' : '';
      if (abs >= 1e9) return sign + (abs/1e9).toFixed(1) + ' mrd ' + currency;
      if (abs >= 1e6) return sign + (abs/1e6).toFixed(0) + ' mill ' + currency;
      return sign + val.toLocaleString() + ' ' + currency;
    }

    function pctChange(a, b) {
      if (!a || !b || b === 0) return null;
      return ((a - b) / Math.abs(b) * 100).toFixed(1) + '%';
    }

    // Bygg kvartalsdata
    const qData = {
      period: latest.period || latest.calendarYear + ' Q?',
      date: latest.date,
      revenue: fmtB(latest.revenue),
      revenueChange: pctChange(latest.revenue, yearAgo?.revenue),
      ebit: fmtB(latest.operatingIncome),
      ebitChange: pctChange(latest.operatingIncome, yearAgo?.operatingIncome),
      netIncome: fmtB(latest.netIncome),
      netIncomeChange: pctChange(latest.netIncome, yearAgo?.netIncome),
      eps: latest.eps ? parseFloat(latest.eps).toFixed(2) : null,
      epsEstimated: latestEarnings?.estimatedEarning ? parseFloat(latestEarnings.estimatedEarning).toFixed(2) : null,
      epsSurprise: latestEarnings?.actualEarningResult && latestEarnings?.estimatedEarning
        ? pctChange(latestEarnings.actualEarningResult, latestEarnings.estimatedEarning)
        : null,
      grossMargin: latest.grossProfit && latest.revenue
        ? (latest.grossProfit / latest.revenue * 100).toFixed(1) + '%' : null,
      operatingMargin: latest.operatingIncome && latest.revenue
        ? (latest.operatingIncome / latest.revenue * 100).toFixed(1) + '%' : null,
      freeCashFlow: cf ? fmtB(cf.freeCashFlow) : null,
    };

    // Sende til AI for oppsummering
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const prompt = `Du er Børshjelpen sin finansanalytiker — du snakker som en ærlig, engasjert venn som kan finans godt. Forklar kvartalsrapporten grundig og konkret. Bruk de faktiske tallene aktivt i analysen.

Kvartalsrapport for ${name || ticker} (${qData.period}):

RESULTATREGNSKAP:
- Omsetning: ${qData.revenue} ${qData.revenueChange ? '(' + qData.revenueChange + ' vs samme kvartal i fjor)' : ''}
- EBIT: ${qData.ebit} ${qData.ebitChange ? '(' + qData.ebitChange + ' vs fjorår)' : ''}
- Nettoresultat: ${qData.netIncome} ${qData.netIncomeChange ? '(' + qData.netIncomeChange + ' vs fjorår)' : ''}
- EPS: ${qData.eps || '—'} ${qData.epsEstimated ? '(analytikerne ventet: ' + qData.epsEstimated + ')' : ''}
${qData.epsSurprise ? '- Slo/bommet estimat med: ' + qData.epsSurprise : ''}
- Bruttomargin: ${qData.grossMargin || '—'}
- Driftsmargin: ${qData.operatingMargin || '—'}
${qData.freeCashFlow ? '- Fri kontantstrøm: ' + qData.freeCashFlow : ''}

Svar KUN med gyldig JSON. Vær gjerne utfyllende der det er nyttig — ikke kutt ned for korthetens skyld:
{
  "sammendrag": "3-5 setninger som oppsummerer rapporten konkret. Bruk de faktiske tallene. Var dette en sterk, svak eller nøytral rapport — og hvorfor?",
  "vs_fjoraar": "2-3 setninger om hvordan dette kvartalet var sammenlignet med samme kvartal i fjor. Hva forbedret seg? Hva ble svakere?",
  "eps_forklaring": "Forklar EPS-resultatet konkret — slo de forventningene eller ikke, og hva betyr det i praksis? Kun hvis EPS-data er tilgjengelig.",
  "marginer": "Kommenter bruttomargin og driftsmargin — er de gode, svake eller typiske for bransjen?",
  "positive": ["Konkret positivt punkt med tall", "Konkret positivt punkt med tall", "Eventuelt tredje punkt"],
  "negative": ["Konkret bekymring med tall", "Konkret bekymring med tall"],
  "nybegynner_tips": "Én konkret setning som hjelper en nybegynner forstå det viktigste fra denne rapporten."
}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });

    let ai = {};
    try {
      const raw = completion.choices[0].message.content.replace(/```json|```/g, '').trim();
      ai = JSON.parse(raw);
    } catch(e) {
      ai = { sammendrag: 'Kunne ikke analysere rapporten automatisk.' };
    }

    return res.status(200).json({ qData, ai });
  } catch(e) {
    console.error('quarterly error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
