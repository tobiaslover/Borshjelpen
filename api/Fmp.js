import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'public, max-age=900'); // 15 min cache
  if (req.method !== 'GET') return res.status(405).end();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Ikke autentisert' });
  const token = authHeader.replace('Bearer ', '');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: { user }, error: authError } = await sb.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Ugyldig token' });

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Ticker mangler' });

  const apiKey = process.env.FMP_API_KEY;

  try {
    // Hent nøkkeltall og profil parallelt
    const [profileRes, ratiosRes, earningsRes] = await Promise.all([
      fetch(`https://financialmodelingprep.com/stable/profile?symbol=${ticker}&apikey=${apiKey}`),
      fetch(`https://financialmodelingprep.com/stable/ratios-ttm?symbol=${ticker}&apikey=${apiKey}`),
      fetch(`https://financialmodelingprep.com/stable/earnings-surprises?symbol=${ticker}&limit=4&apikey=${apiKey}`),
    ]);

    const [profileData, ratiosData, earningsData] = await Promise.all([
      profileRes.json(),
      ratiosRes.json(),
      earningsRes.json(),
    ]);

    const profile = Array.isArray(profileData) ? profileData[0] : profileData;
    const ratios = Array.isArray(ratiosData) ? ratiosData[0] : ratiosData;
    const earnings = Array.isArray(earningsData) ? earningsData : [];

    // Formater nøkkeltall
    const data = {
      // Profil
      description: profile?.description || null,
      ceo: profile?.ceo || null,
      employees: profile?.fullTimeEmployees || null,
      website: profile?.website || null,
      isin: profile?.isin || null,

      // Nøkkeltall (TTM = trailing twelve months)
      peRatio: ratios?.peRatioTTM ? parseFloat(ratios.peRatioTTM).toFixed(1) : null,
      pbRatio: ratios?.priceToBookRatioTTM ? parseFloat(ratios.priceToBookRatioTTM).toFixed(1) : null,
      psRatio: ratios?.priceToSalesRatioTTM ? parseFloat(ratios.priceToSalesRatioTTM).toFixed(1) : null,
      evEbitda: ratios?.enterpriseValueMultipleTTM ? parseFloat(ratios.enterpriseValueMultipleTTM).toFixed(1) : null,
      dividendYield: ratios?.dividendYieldTTM ? (parseFloat(ratios.dividendYieldTTM) * 100).toFixed(1) + '%' : null,
      roe: ratios?.returnOnEquityTTM ? (parseFloat(ratios.returnOnEquityTTM) * 100).toFixed(1) + '%' : null,
      roa: ratios?.returnOnAssetsTTM ? (parseFloat(ratios.returnOnAssetsTTM) * 100).toFixed(1) + '%' : null,
      debtEquity: ratios?.debtEquityRatioTTM ? parseFloat(ratios.debtEquityRatioTTM).toFixed(2) : null,
      currentRatio: ratios?.currentRatioTTM ? parseFloat(ratios.currentRatioTTM).toFixed(2) : null,
      grossMargin: ratios?.grossProfitMarginTTM ? (parseFloat(ratios.grossProfitMarginTTM) * 100).toFixed(1) + '%' : null,
      netMargin: ratios?.netProfitMarginTTM ? (parseFloat(ratios.netProfitMarginTTM) * 100).toFixed(1) + '%' : null,
      freeCashFlowYield: ratios?.freeCashFlowYieldTTM ? (parseFloat(ratios.freeCashFlowYieldTTM) * 100).toFixed(1) + '%' : null,

      // Siste kvartalsresultater
      earnings: earnings.slice(0, 4).map(e => ({
        date: e.date,
        actual: e.actualEarningResult,
        estimated: e.estimatedEarning,
        surprise: e.actualEarningResult && e.estimatedEarning
          ? ((e.actualEarningResult - e.estimatedEarning) / Math.abs(e.estimatedEarning) * 100).toFixed(1) + '%'
          : null
      }))
    };

    return res.status(200).json(data);
  } catch(e) {
    console.error('FMP error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
