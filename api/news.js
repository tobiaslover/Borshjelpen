import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/) || [])[1] || '';
    const link = (item.match(/<link>(.*?)<\/link>/) || item.match(/<guid>(.*?)<\/guid>/) || [])[1] || '';
    const desc = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || item.match(/<description>(.*?)<\/description>/) || [])[1] || '';
    const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '';
    if (title && link) items.push({ title: title.trim(), link: link.trim(), description: desc.replace(/<[^>]+>/g, '').trim().slice(0, 300), pubDate });
  }
  return items;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).end();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Ikke autentisert' });
  const token = authHeader.replace('Bearer ', '');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: { user }, error: authError } = await sb.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Ugyldig token' });

  const feeds = [
    { url: 'https://e24.no/rss/feed', source: 'E24' },
    { url: 'https://www.dn.no/rss/', source: 'DN' },
    { url: 'https://finansavisen.no/rss', source: 'Finansavisen' },
  ];

  let allItems = [];

  for (const feed of feeds) {
    try {
      // Bruk rss2json API som proxy
      const proxyUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed.url)}&count=5`;
      const r = await fetch(proxyUrl);
      if (!r.ok) { console.log('rss2json feil', feed.source, r.status); continue; }
      const data = await r.json();
      if (data.status !== 'ok' || !data.items) { console.log('rss2json ingen items', feed.source); continue; }
      const items = data.items.map(item => ({
        title: item.title,
        link: item.link,
        description: (item.description || '').replace(/<[^>]+>/g, '').slice(0, 300),
        pubDate: item.pubDate,
        source: feed.source
      }));
      allItems = allItems.concat(items);
      console.log('rss2json OK', feed.source, items.length, 'artikler');
    } catch(e) {
      console.log('RSS feil', feed.source, e.message);
      continue;
    }
  }

  if (!allItems.length) return res.status(200).json({ news: [] });

  const keywords = ['aksje','børs','økonomi','rente','inflasjon','kvartal','resultat','Equinor','DNB','Norges Bank','Oslo Børs','investering','marked','olje','shipping','finans','fond'];
  let relevant = allItems.filter(item =>
    keywords.some(kw => (item.title + item.description).toLowerCase().includes(kw.toLowerCase()))
  );
  if (!relevant.length) relevant = allItems;

  const top = relevant.slice(0, 6);

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const summaries = await Promise.all(top.map(async item => {
      try {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          max_tokens: 60,
          messages: [{ role: 'user', content: `Skriv én kort setning (maks 15 ord) på norsk som oppsummerer denne overskriften. Svar kun med setningen.\n\nOverskrift: ${item.title}` }]
        });
        return { ...item, summary: completion.choices[0].message.content.trim() };
      } catch(e) { return { ...item, summary: null }; }
    }));

    return res.status(200).json({ news: summaries.map(item => ({
      title: item.title,
      summary: item.summary,
      url: item.link,
      source: item.source,
      published: item.pubDate,
    }))});
  } catch(e) {
    return res.status(200).json({ news: top.map(item => ({
      title: item.title,
      summary: null,
      url: item.link,
      source: item.source,
      published: item.pubDate,
    }))});
  }
}
