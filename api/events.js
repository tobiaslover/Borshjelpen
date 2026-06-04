import { createClient } from '@supabase/supabase-js';

// Hardkodede OBX events — oppdateres manuelt hvert kvartal
// Kilde: Oslo Børs / selskapenes investor relations
const HARDCODED_EVENTS = [
  // Kvartalsrapporter Q2 2026
  { date: '2026-07-02', ticker: 'EQNR', name: 'Equinor', type: 'rapport', label: 'Kvartalsrapport' },
  { date: '2026-07-09', ticker: 'DNB', name: 'DNB', type: 'rapport', label: 'Kvartalsrapport' },
  { date: '2026-07-09', ticker: 'STB', name: 'Storebrand', type: 'rapport', label: 'Kvartalsrapport' },
  { date: '2026-07-10', ticker: 'AKRBP', name: 'Aker BP', type: 'rapport', label: 'Kvartalsrapport' },
  { date: '2026-07-10', ticker: 'NHY', name: 'Norsk Hydro', type: 'rapport', label: 'Kvartalsrapport' },
  { date: '2026-07-14', ticker: 'GJF', name: 'Gjensidige', type: 'rapport', label: 'Kvartalsrapport' },
  { date: '2026-07-14', ticker: 'TEL', name: 'Telenor', type: 'rapport', label: 'Kvartalsrapport' },
  { date: '2026-07-15', ticker: 'YAR', name: 'Yara', type: 'rapport', label: 'Kvartalsrapport' },
  { date: '2026-07-16', ticker: 'ORK', name: 'Orkla', type: 'rapport', label: 'Kvartalsrapport' },
  { date: '2026-07-16', ticker: 'KOG', name: 'Kongsberg Gruppen', type: 'rapport', label: 'Kvartalsrapport' },
  { date: '2026-08-12', ticker: 'MOWI', name: 'Mowi', type: 'rapport', label: 'Kvartalsrapport' },
  { date: '2026-08-13', ticker: 'SALM', name: 'SalMar', type: 'rapport', label: 'Kvartalsrapport' },
  { date: '2026-08-19', ticker: 'TOM', name: 'Tomra', type: 'rapport', label: 'Kvartalsrapport' },
  { date: '2026-08-20', ticker: 'NOD', name: 'Nordic Semiconductor', type: 'rapport', label: 'Kvartalsrapport' },
  { date: '2026-08-27', ticker: 'SUBC', name: 'Subsea 7', type: 'rapport', label: 'Kvartalsrapport' },
  // Utbyttedatoer
  { date: '2026-06-23', ticker: 'SALM', name: 'SalMar', type: 'utbytte', label: 'Utbyttedato', amount: '10.00' },
  { date: '2026-08-13', ticker: 'EQNR', name: 'Equinor', type: 'utbytte', label: 'Utbyttedato', amount: '3.61' },
  { date: '2026-08-14', ticker: 'EQNR', name: 'Equinor', type: 'utbytte', label: 'Utbyttedato', amount: '0.39' },
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  if (req.method !== 'GET') return res.status(405).end();

  const today = new Date().toISOString().slice(0, 10);

  const events = HARDCODED_EVENTS
    .filter(e => e.date >= today)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  return res.status(200).json({ events, cached: false });
}
