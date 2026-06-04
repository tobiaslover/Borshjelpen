// Henter vinnere og tapere fra FMP i to kall — raskt og effektivt

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'public, max-age=300'); // 5 min cache

  if (req.method !== 'GET') return res.status(405).end();

  const apiKey = process.env.FMP_API_KEY;

  // Oslo Børs-tickers for filtrering
  const OSLO_TICKERS = new Set([
    '2020','5PG','AASB','ABG','ABL','ACED','ADS','AFG','AGLX','AKAST','AKER','AKBM',
    'AKRBP','AKSO','AKOBO','AKVA','ANDF','APR','ABTEC','ARCH','ABS','AFISH','AFK',
    'ARR','ATEA','AURG','AUSS','AUTO','ALNG','ACR','AIX','DNB','DNO','EQNR','FRO',
    'GJF','GOGL','GRIEG','GSF','HAFNI','HAVI','KOG','LSG','MOWI','MPCC','NEL','NHY',
    'ORK','RECSI','SALM','SCATC','SRBANK','STB','SUBC','TEL','TGS','TOMRA','YAR',
    'BOUVET','ENTRA','BORR','OKEA','SDRL','FLNG','BWLPG','BELCO','PEXIP','KAHOT',
    'AUTO','ATEA','BRG','KID','BWO','BEWI','NAS','PGS','AKSO','IDEX'
  ]);

  try {
    const [gainersRes, losersRes] = await Promise.all([
      fetch(`https://financialmodelingprep.com/stable/biggest-gainers?apikey=${apiKey}`),
      fetch(`https://financialmodelingprep.com/stable/biggest-losers?apikey=${apiKey}`),
    ]);

    let gainers = [], losers = [];

    if (gainersRes.ok) {
      const d = await gainersRes.json();
      gainers = Array.isArray(d) ? d : [];
    }
    if (losersRes.ok) {
      const d = await losersRes.json();
      losers = Array.isArray(d) ? d : [];
    }

    // Filtrer på Oslo Børs (.OL suffix eller i listen vår)
    function isOslo(item) {
      const sym = item.symbol || item.ticker || '';
      return sym.endsWith('.OL') || OSLO_TICKERS.has(sym.replace('.OL', ''));
    }

    function fmt(item) {
      const sym = (item.symbol || item.ticker || '').replace('.OL', '');
      return {
        ticker: sym,
        name: (item.name || item.companyName || sym).split(' ').slice(0, 2).join(' '),
        price: parseFloat(item.price || 0).toFixed(2),
        changePct: Math.abs(parseFloat(item.changesPercentage || item.changePercentage || 0)).toFixed(2),
        up: parseFloat(item.changesPercentage || item.changePercentage || 0) >= 0
      };
    }

    const osloGainers = gainers.filter(isOslo).slice(0, 5).map(fmt);
    const osloLosers = losers.filter(isOslo).slice(0, 5).map(fmt);

    // Fallback: hvis ingen Oslo-aksjer i FMP-listen, bruk alle
    const winners = osloGainers.length >= 3 ? osloGainers : gainers.slice(0, 5).map(fmt);
    const losersList = osloLosers.length >= 3 ? osloLosers : losers.slice(0, 5).map(fmt);

    // Estimer OBX-endring fra top gainers/losers
    const allChanges = [...winners, ...losersList].map(s => parseFloat(s.changePct) * (s.up ? 1 : -1));
    const obxChange = allChanges.length ? (allChanges.reduce((a, b) => a + b, 0) / allChanges.length).toFixed(2) : '0.00';

    return res.status(200).json({ winners, losers: losersList, obxChange });
  } catch(e) {
    console.error('movers error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
