import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'public, max-age=900');
  if (req.method !== 'GET') return res.status(405).end();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Ikke autentisert' });
  const token = authHeader.replace('Bearer ', '');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: { user }, error: authError } = await sb.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Ugyldig token' });

  // Rate limit: gratis 100/dag, investor/proff 500/dag
  const LIMITS = { free: 100, investor: 500, proff: 500 };
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });
  const { data: planData } = await sb.from('user_plans').select('plan').eq('user_id', user.id).maybeSingle();
  const plan = planData?.plan || 'free';
  const limit = LIMITS[plan] ?? 100;
  const { count } = await sb.from('user_activity').select('*', { count: 'exact', head: true })
    .eq('user_id', user.id).eq('activity', 'sok').gte('created_at', today + 'T00:00:00+02:00');
  if ((count || 0) >= limit) {
    return res.status(429).json({ error: `Du har nådd dagens grense på ${limit} aksjesøk.`, limit, plan });
  }

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Ticker mangler' });

  const apiKey = process.env.FMP_API_KEY;
  const t = ticker.toUpperCase();

  try {
    const [profileRes, ratiosRes, earningsRes, keyMetricsRes] = await Promise.all([
      fetch(`https://financialmodelingprep.com/api/v3/profile/${t}?apikey=${apiKey}`),
      fetch(`https://financialmodelingprep.com/api/v3/ratios-ttm/${t}?apikey=${apiKey}`),
      fetch(`https://financialmodelingprep.com/api/v3/earnings-surprises/${t}?apikey=${apiKey}`),
      fetch(`https://financialmodelingprep.com/api/v3/key-metrics-ttm/${t}?apikey=${apiKey}`),
    ]);

    const [profileData, ratiosData, earningsData, keyMetricsData] = await Promise.all([
      profileRes.json(),
      ratiosRes.json(),
      earningsRes.json(),
      keyMetricsRes.json(),
    ]);

    console.log('FMP profile status:', profileRes.status);
    console.log('FMP ratios status:', ratiosRes.status);

    const profile = Array.isArray(profileData) ? profileData[0] : profileData;
    const ratios = Array.isArray(ratiosData) ? ratiosData[0] : ratiosData;
    const earnings = Array.isArray(earningsData) ? earningsData : [];
    const keyMetrics = Array.isArray(keyMetricsData) ? keyMetricsData[0] : keyMetricsData;

    function fmt(val, decimals = 1, suffix = '') {
      if (val === null || val === undefined || isNaN(val)) return null;
      return parseFloat(val).toFixed(decimals) + suffix;
    }

    const data = {
      description: profile?.description || null,
      ceo: profile?.ceo || null,
      employees: profile?.fullTimeEmployees || null,
      website: profile?.website || null,
      country: profile?.country || null,
      exchange: profile?.exchangeShortName || null,

      // Verdsettelse
      peRatio: fmt(ratios?.peRatioTTM),
      pbRatio: fmt(ratios?.priceToBookRatioTTM),
      psRatio: fmt(ratios?.priceToSalesRatioTTM),
      evEbitda: fmt(keyMetrics?.enterpriseValueOverEBITDATTM),
      dividendYield: ratios?.dividendYieldTTM ? fmt(ratios.dividendYieldTTM * 100, 2, '%') : null,

      // Lønnsomhet
      roe: ratios?.returnOnEquityTTM ? fmt(ratios.returnOnEquityTTM * 100, 1, '%') : null,
      roa: ratios?.returnOnAssetsTTM ? fmt(ratios.returnOnAssetsTTM * 100, 1, '%') : null,
      grossMargin: ratios?.grossProfitMarginTTM ? fmt(ratios.grossProfitMarginTTM * 100, 1, '%') : null,
      netMargin: ratios?.netProfitMarginTTM ? fmt(ratios.netProfitMarginTTM * 100, 1, '%') : null,
      ebitdaMargin: keyMetrics?.ebitdaMarginTTM ? fmt(keyMetrics.ebitdaMarginTTM * 100, 1, '%') : null,

      // Finansiell styrke
      debtEquity: fmt(ratios?.debtEquityRatioTTM, 2),
      currentRatio: fmt(ratios?.currentRatioTTM, 2),
      interestCoverage: fmt(ratios?.interestCoverageTTM, 1),
      freeCashFlowYield: keyMetrics?.freeCashFlowYieldTTM ? fmt(keyMetrics.freeCashFlowYieldTTM * 100, 1, '%') : null,

      // Kvartalsresultater
      earnings: earnings.slice(0, 4).map(e => ({
        date: e.date,
        actual: e.actualEarningResult,
        estimated: e.estimatedEarning,
        surprise: e.actualEarningResult && e.estimatedEarning
          ? fmt((e.actualEarningResult - e.estimatedEarning) / Math.abs(e.estimatedEarning) * 100, 1, '%')
          : null
      }))
    };

    return res.status(200).json(data);
  } catch(e) {
    console.error('FMP error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
