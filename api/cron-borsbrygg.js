export default async function handler(req, res) {
  // Kun tillatt fra Vercel Cron
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Ikke generer når gårsdagen ikke var en handelsdag (søndag/mandag i Oslo-tid).
  // Cronen fyrer hver dag (01:00 UTC), men utgaven skal kun lages tirsdag–lørdag.
  const osloDow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Oslo' })).getDay();
  if (osloDow === 0 || osloDow === 1) {
    return res.status(200).json({ skipped: true, reason: 'Ingen handelsdag i går (helg)' });
  }

  try {
    // Hent HELE Oslo-universet (~330+ aksjer) + ev. EKTE indeksdata fra movers.
    // scope=all gir bredt, representativt grunnlag for bredde og vinnere/tapere.
    // Movers fabrikkerer IKKE et indekstall fra aksjene — den gir:
    //   - alle Oslo Børs-aksjene (ekte per-aksje-kurser, sortert størst opp -> ned)
    //   - faktisk OSEBX/OBX-nivå KUN hvis FMP returnerer det (ellers: ingen indeks)
    const movers = await fetch('https://borshjelpen.no/api/movers?scope=all')
      .then(r => r.json())
      .catch(() => null);

    const all = movers && Array.isArray(movers.all) ? movers.all : [];
    if (!all.length) {
      return res.status(500).json({ error: 'Ingen kursdata tilgjengelig fra movers' });
    }

    // all er allerede sortert: størst oppgang -> størst nedgang (changePctRaw desc).
    const fmt = s => `${s.name} (${s.ticker}): ${s.price} NOK, ${s.changePctRaw >= 0 ? '+' : '-'}${s.changePct}%`;

    const gainers = all.filter(s => s.changePctRaw > 0);
    const fallers = all.filter(s => s.changePctRaw < 0);
    const flat    = all.filter(s => s.changePctRaw === 0);

    const topGainers = gainers.slice(0, 5);                       // allerede størst først
    const topFallers = fallers.slice().reverse().slice(0, 5);     // størst nedgang først

    // EKTE indeksdata? Movers gir osebx/obx = null når FMP ikke har den.
    const idx = movers.osebx || movers.obx || null;
    const idxName = movers.osebx ? 'OSEBX' : (movers.obx ? 'OBX' : null);
    const hasIndexData = !!idx;

    const indexLine = hasIndexData
      ? `INDEKS (FAKTISK indeksdata fra FMP): ${idxName} ${idx.price}, ${idx.up ? '+' : '-'}${idx.changePct}%. Dette er ekte indeksdata — du KAN oppgi denne samlede børsretningen.`
      : `INDEKS: Ingen offisiell OSEBX/OBX-indeksdata er tilgjengelig i dag. Du skal derfor IKKE oppgi en samlet børsretning eller noe indekstall ("Oslo Børs steg/falt X%"). Beskriv i stedet konkret hvilke av de største aksjene som steg og hvilke som falt.`;

    const breadthLine = `Bredde blant ${all.length} aksjer på Oslo Børs: ${gainers.length} steg, ${fallers.length} falt${flat.length ? `, ${flat.length} uendret` : ''}. (Dette beskriver bredden i utvalget — det er IKKE det samme som hele den markedsvekt-justerte hovedindeksens retning.)`;

    const parts = [
      indexLine,
      breadthLine,
      topGainers.length ? `Størst oppgang i går: ${topGainers.map(fmt).join('; ')}.` : null,
      topFallers.length ? `Størst nedgang i går: ${topFallers.map(fmt).join('; ')}.` : null,
      `De største bevegelsene på Oslo Børs (sortert størst opp -> størst ned, topp 40): ${all.slice(0, 40).map(fmt).join('; ')}.`
    ].filter(Boolean);

    const stockSummary = parts.join('\n\n');

    // Øyeblikksbilde av vinnere/tapere som fryses inn i utgaven (topp 3 hver vei).
    const snap = s => ({ ticker: s.ticker, name: s.name, changePct: s.changePct, up: s.up });
    const moversSnapshot = {
      winners: topGainers.slice(0, 3).map(snap),
      losers: topFallers.slice(0, 3).map(snap)
    };

    // Trigger Børsbrygg-generering (autentiser som internt cron-kall)
    const response = await fetch('https://borshjelpen.no/api/borsbrygg', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.CRON_SECRET}`
      },
      body: JSON.stringify({ stockSummary, hasIndexData, moversSnapshot })
    });
    const data = await response.json();
    return res.status(200).json({ success: true, title: data.tittel, stocks: all.length, hasIndexData });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
