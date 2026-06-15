// api/cron-events.js  (codeVersion: v4-euronext-reports)
// UKENTLIG JOBB. Henter:
//   1) Oslo Bors-universet (.OL) med navn - prover FLERE FMP-kilder
//   2) Utbytte PER TICKER for alle .OL-aksjer (fanger smaaksjer som MPCC)
//   3) Kvartals-/halvaarsrapporter fra HARDKODET Euronext-finanskalender (REPORTS).
//      Navn matches mot FMPs egne .OL-selskapsnavn for aa finne ticker.
// Lagrer ferdig events-liste i Supabase (market_cache, key='events').
//
// Rapportdatoene er hentet manuelt fra Euronext sin offisielle finanskalender
// (live.euronext.com/en/markets/oslo/financial-calendars) og er bekreftede datoer,
// i motsetning til FMPs estimater. Oppdater REPORTS naar nye datoer publiseres.
//
// ENV i Vercel: FMP_API_KEY (el. FMP_KEY), SUPABASE_URL,
//               SUPABASE_SERVICE_KEY (el. ..._ROLE_KEY), CRON_SECRET

import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 60 };

const FMP_KEY = process.env.FMP_API_KEY || process.env.FMP_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

const HORIZON_DAYS = 90;
const CONCURRENCY = 12;
const ymd = (d) => d.toISOString().slice(0, 10);

// === HARDKODET RAPPORTKALENDER (Euronext, manuelt innhentet) ===
// Format: [dato 'YYYY-MM-DD', selskapsnavn (Euronext), periode 'Q1'|'Q2'|'Q3'|'Q4'|'H1'|'FY']
const REPORTS = [
  ['2026-06-15','Interoil Exploration and Prod. ASA','FY'],
  ['2026-06-18','Norcod AS','Q1'],
  ['2026-06-19','Kaldvik AS','FY'],
  ['2026-06-24','SoftOx Solutions AS','Q1'],
  ['2026-06-26','Helgeland Kraft AS','FY'],
  ['2026-06-26','Pyrum Innovations AG','Q1'],
  ['2026-06-30','Akobo Minerals AB (publ)','Q1'],
  ['2026-06-30','Envipco Holding N.V.','FY'],
  ['2026-06-30','Hofseth BioCare ASA','Q1'],
  ['2026-06-30','Okechamp Global B.V.','FY'],
  ['2026-06-30','Servatur Holding AS','Q4'],
  ['2026-06-30','The Kingfish Company N.V.','FY'],
  ['2026-07-03','Norwegian Property ASA','H1'],
  ['2026-07-07','ABG Sundal Collier Holding ASA','H1'],
  ['2026-07-09','BlueNord ASA','H1'],
  ['2026-07-09','Bonheur ASA','H1'],
  ['2026-07-09','Europris ASA','H1'],
  ['2026-07-09','Gentian Diagnostics ASA','H1'],
  ['2026-07-09','Stolt-Nielsen Limited','H1'],
  ['2026-07-10','Elkem ASA','H1'],
  ['2026-07-10','Entra ASA','H1'],
  ['2026-07-10','Kitron ASA','H1'],
  ['2026-07-10','Protector Forsikring ASA','H1'],
  ['2026-07-10','StrongPoint ASA','H1'],
  ['2026-07-13','Fremtind Forsikring AS','H1'],
  ['2026-07-13','Gjensidige Forsikring ASA','H1'],
  ['2026-07-13','Kongsberg Gruppen ASA','H1'],
  ['2026-07-13','Kongsberg Maritime ASA','H1'],
  ['2026-07-13','Smartoptics Group ASA','H1'],
  ['2026-07-14','Aker Solutions ASA','H1'],
  ['2026-07-14','DNB Bank ASA','H1'],
  ['2026-07-14','Norske Skog ASA','H1'],
  ['2026-07-14','Norwegian Air Shuttle ASA','H1'],
  ['2026-07-14','Sparebanken Øst','H1'],
  ['2026-07-15','Aker BP ASA','H1'],
  ['2026-07-15','Hermana Holding ASA','H1'],
  ['2026-07-15','NEL ASA','H1'],
  ['2026-07-15','OBOS BBL','H1'],
  ['2026-07-15','PPI Public Property Invest AB (publ)','H1'],
  ['2026-07-15','Solstad Maritime ASA','H1'],
  ['2026-07-15','Solstad Offshore ASA','H1'],
  ['2026-07-15','Storebrand ASA','H1'],
  ['2026-07-16','Aker ASA','H1'],
  ['2026-07-16','Atea ASA','H1'],
  ['2026-07-16','Borregaard ASA','H1'],
  ['2026-07-16','Hexagon Purus ASA','H1'],
  ['2026-07-16','Kongsberg Automotive ASA','H1'],
  ['2026-07-16','OKEA ASA','H1'],
  ['2026-07-16','Telenor ASA','H1'],
  ['2026-07-17','Goodtech ASA','H1'],
  ['2026-07-17','Komplett ASA','H1'],
  ['2026-07-17','Pareto Bank ASA','H1'],
  ['2026-07-17','Tomra Systems ASA','H1'],
  ['2026-07-17','Vend Marketplaces ASA','H1'],
  ['2026-07-17','Yara International ASA','H1'],
  ['2026-07-21','Boliden AB','H1'],
  ['2026-07-21','Statkraft AS','H1'],
  ['2026-07-21','Vår Energi ASA','H1'],
  ['2026-07-22','Equinor ASA','H1'],
  ['2026-07-22','Norsk Hydro ASA','H1'],
  ['2026-07-23','TGS ASA','H1'],
  ['2026-07-23','Telford Finco','H1'],
  ['2026-07-29','Photocure ASA','H1'],
  ['2026-07-30','BW Energy Limited','H1'],
  ['2026-07-30','MPC Energy Solutions N.V.','H1'],
  ['2026-07-30','Polaris Renewable Energy Inc.','H1'],
  ['2026-07-30','Subsea 7 S.A.','H1'],
  ['2026-07-31','Zenith Energy Ltd','FY'],
  ['2026-08-04','Okeanis Eco Tankers Corp.','H1'],
  ['2026-08-05','ShaMaran Petroleum Ltd.','H1'],
  ['2026-08-05','Stainless Tankers ASA','H1'],
  ['2026-08-06','Hexagon Composites ASA','H1'],
  ['2026-08-06','Kommunalbanken AS','H1'],
  ['2026-08-06','Nordic Semiconductor ASA','H1'],
  ['2026-08-06','REC Silicon ASA','H1'],
  ['2026-08-06','S.D. Standard ETC Plc','H1'],
  ['2026-08-06','Selvaag Bolig ASA','H1'],
  ['2026-08-06','poLight ASA','H1'],
  ['2026-08-11','Bien Sparebank ASA','H1'],
  ['2026-08-11','Himalaya Shipping Ltd','H1'],
  ['2026-08-11','Kredinor AS','H1'],
  ['2026-08-11','Questerre Energy Corporation','H1'],
  ['2026-08-11','Sparebanken Norge','H1'],
  ['2026-08-11','Wallenius Wilhelmsen ASA','H1'],
  ['2026-08-12','Aurskog Sparebank','H1'],
  ['2026-08-12','BN Bank ASA','H1'],
  ['2026-08-12','Bergen Carbon Solutions AS','H1'],
  ['2026-08-12','Borr Drilling Limited','H1'],
  ['2026-08-12','Envipco Holding N.V.','H1'],
  ['2026-08-12','Fana Sparebank Boligkreditt AS','Q3'],
  ['2026-08-12','Fana Sparebank Boligkreditt AS','H1'],
  ['2026-08-12','Landkreditt Bank AS','H1'],
  ['2026-08-12','Landkreditt Boligkreditt AS','H1'],
  ['2026-08-12','Landkreditt Forsikring AS','H1'],
  ['2026-08-12','Rogaland Sparebank','H1'],
  ['2026-08-12','Rogaland Sparebank Boligkreditt AS','H1'],
  ['2026-08-12','Voss Veksel- og Landmandsbank ASA','H1'],
  ['2026-08-12','Wilh. Wilhelmsen Holding ASA','H1'],
  ['2026-08-13','Aasen Sparebank','H1'],
  ['2026-08-13','Archer Limited','H1'],
  ['2026-08-13','Axactor ASA','H1'],
  ['2026-08-13','Bruton Limited','H1'],
  ['2026-08-13','Eika Boligkreditt AS','H1'],
  ['2026-08-13','Fana Sparebank','H1'],
  ['2026-08-13','General Oceans ASA','H1'],
  ['2026-08-13','Induct AS','H1'],
  ['2026-08-13','Kraft Bank ASA','H1'],
  ['2026-08-13','Lea Bank AB','H1'],
  ['2026-08-13','MatvareExpressen AS','H1'],
  ['2026-08-13','Moreld ASA','H1'],
  ['2026-08-13','Morrow Bank AB','H1'],
  ['2026-08-13','Møre Boligkreditt AS','H1'],
  ['2026-08-13','NRC Group ASA','H1'],
  ['2026-08-13','Nidaros Sparebank','H1'],
  ['2026-08-13','Olav Thon Eiendom AS','H1'],
  ['2026-08-13','Otovo ASA','H1'],
  ['2026-08-13','Pexip Holding ASA','H1'],
  ['2026-08-13','SpareBank 1 Nord-Norge','H1'],
  ['2026-08-13','SpareBank 1 Ringerike Hadeland','H1'],
  ['2026-08-13','Tinde Sparebank','H1'],
  ['2026-08-13','Vantage Drilling International Ltd','H1'],
  ['2026-08-13','Xplora Technologies AS','H1'],
  ['2026-08-14','AKVA group ASA','H1'],
  ['2026-08-14','Aqua Bio Technology ASA','H1'],
  ['2026-08-14','ArcticZymes Technologies ASA','H1'],
  ['2026-08-14','Borgestad ASA','H1'],
  ['2026-08-14','Flekkefjord Sparebank','H1'],
  ['2026-08-14','Høland og Setskog Sparebank','H1'],
  ['2026-08-14','Instabank ASA','H1'],
  ['2026-08-14','KLP Banken AS','H1'],
  ['2026-08-14','KLP Boligkreditt AS','H1'],
  ['2026-08-14','KLP Kommunekreditt AS','H1'],
  ['2026-08-14','NoA Bidco AS','H1'],
  ['2026-08-14','Polaris Media ASA','H1'],
  ['2026-08-14','Romerike Sparebank','H1'],
  ['2026-08-14','RørosBanken','H1'],
  ['2026-08-14','SATS ASA','H1'],
  ['2026-08-14','Sogn Sparebank','H1'],
  ['2026-08-14','SpareBank 1 Hallingdal Valdres','H1'],
  ['2026-08-14','SpareBank 1 Nordmøre','H1'],
  ['2026-08-14','SpareBank 1 Sogn og Fjordane','H1'],
  ['2026-08-14','SpareBank 1 Østfold Akershus','H1'],
  ['2026-08-14','Trøndelag Sparebank','H1'],
  ['2026-08-14','Veidekke ASA','H1'],
  ['2026-08-17','Longship Group B.V.','H1'],
  ['2026-08-17','Ocean Yield AS','H1'],
  ['2026-08-18','Elopak ASA','H1'],
  ['2026-08-18','Gigante Salmon AS','H1'],
  ['2026-08-18','Grong Sparebank','H1'],
  ['2026-08-18','Multiconsult ASA','H1'],
  ['2026-08-18','Nordhealth AS','H1'],
  ['2026-08-18','Nordic Mining ASA','H1'],
  ['2026-08-18','Odfjell Drilling Ltd','H1'],
  ['2026-08-18','Reach Subsea ASA','H1'],
  ['2026-08-18','Salmon Evolution ASA','H1'],
  ['2026-08-19','Arctic Fish Holding AS','H1'],
  ['2026-08-19','Austevoll Seafood ASA','H1'],
  ['2026-08-19','BEWi ASA','H1'],
  ['2026-08-19','Bouvet ASA','H1'],
  ['2026-08-19','Cambi ASA','H1'],
  ['2026-08-19','Cloudberry Clean Energy ASA','H1'],
  ['2026-08-19','Constellation Oil Services Holding S.A.','H1'],
  ['2026-08-19','DOF Group ASA','H1'],
  ['2026-08-19','Desert Control AS','H1'],
  ['2026-08-19','Elektroimportøren AS','H1'],
  ['2026-08-19','Elmera Group ASA','H1'],
  ['2026-08-19','Havila Shipping ASA','H1'],
  ['2026-08-19','Lerøy Seafood Group ASA','H1'],
  ['2026-08-19','Lifecare ASA','H1'],
  ['2026-08-19','Link Mobility Group Holding ASA','H1'],
  ['2026-08-19','Medistim ASA','H1'],
  ['2026-08-19','Mowi ASA','H1'],
  ['2026-08-19','Norsk Titanium AS','H1'],
  ['2026-08-19','North Energy ASA','H1'],
  ['2026-08-19','Scana ASA','H1'],
  ['2026-08-19','Zaptec ASA','H1'],
  ['2026-08-20','ABL Group ASA','H1'],
  ['2026-08-20','Atlantic Sapphire ASA','H1'],
  ['2026-08-20','B2 Impact ASA','H1'],
  ['2026-08-20','Cyviz AS','H1'],
  ['2026-08-20','Endúr ASA','H1'],
  ['2026-08-20','Green Minerals AS','H1'],
  ['2026-08-20','Höegh Autoliners ASA','H1'],
  ['2026-08-20','IDEX Biometrics ASA','H1'],
  ['2026-08-20','Kid ASA','H1'],
  ['2026-08-20','Nekkar ASA','H1'],
  ['2026-08-20','Norconsult ASA','H1'],
  ['2026-08-20','Norse Atlantic ASA','H1'],
  ['2026-08-20','Odfjell SE','H1'],
  ['2026-08-20','Odfjell Technology Ltd','H1'],
  ['2026-08-20','Panoro Energy ASA','H1'],
  ['2026-08-20','Pioneer Property Group ASA','H1'],
  ['2026-08-20','Soiltech ASA','H1'],
  ['2026-08-20','Techstep ASA','H1'],
  ['2026-08-20','Vistin Pharma ASA','H1'],
  ['2026-08-20','Zelluna ASA','H1'],
  ['2026-08-21','ALNG ASA','H1'],
  ['2026-08-21','Akastor ASA','H1'],
  ['2026-08-21','Arendals Fossekompani ASA','H1'],
  ['2026-08-21','Eidesvik Offshore ASA','H1'],
  ['2026-08-21','Hofseth BioCare ASA','H1'],
  ['2026-08-21','HydrogenPro ASA','H1'],
  ['2026-08-21','Otello Corporation ASA','H1'],
  ['2026-08-21','Scatec ASA','H1'],
  ['2026-08-21','Zalaris ASA','H1'],
  ['2026-08-24','BW Offshore Limited','H1'],
  ['2026-08-25','Cadeler A/S','H1'],
  ['2026-08-25','Gulf Keystone Petroleum Ltd.','H1'],
  ['2026-08-25','Icelandic Salmon AS','H1'],
  ['2026-08-25','Jacktel AS','H1'],
  ['2026-08-25','Klaveness Combination Carriers ASA','H1'],
  ['2026-08-25','Napatech A/S','H1'],
  ['2026-08-25','Neptune Bidco AS','H1'],
  ['2026-08-25','Observe Medical ASA','H1'],
  ['2026-08-25','SalMar ASA','H1'],
  ['2026-08-25','Western Bulk Chartering AS','H1'],
  ['2026-08-26','2020 Bulkers Ltd.','H1'],
  ['2026-08-26','Avinor AS','H1'],
  ['2026-08-26','Capsol Technologies ASA','H1'],
  ['2026-08-26','Color Group AS','H1'],
  ['2026-08-26','Eidsiva Energi AS','H1'],
  ['2026-08-26','Eqva ASA','H1'],
  ['2026-08-26','Gyldendal ASA','H1'],
  ['2026-08-26','INIFY Laboratories AB','H1'],
  ['2026-08-26','MPC Container Ships ASA','H1'],
  ['2026-08-26','Magnora ASA','H1'],
  ['2026-08-26','Magnora Data Center ASA','H1'],
  ['2026-08-26','NEXT Biometrics Group ASA','H1'],
  ['2026-08-26','NorgesGruppen ASA','H1'],
  ['2026-08-26','Nykode Therapeutics ASA','H1'],
  ['2026-08-26','Ocean Sun AS','H1'],
  ['2026-08-26','SED Energy Holdings Plc','H1'],
  ['2026-08-26','Saga Pure ASA','H1'],
  ['2026-08-26','SoftwareOne Holding AG','H1'],
  ['2026-08-27','ADS Maritime Holding Plc','H1'],
  ['2026-08-27','Agilyx ASA','H1'],
  ['2026-08-27','Andfjord Salmon Group AS','H1'],
  ['2026-08-27','Arctic Bioscience AS','H1'],
  ['2026-08-27','Arribatec Group ASA','H1'],
  ['2026-08-27','BEVEST ASA','H1'],
  ['2026-08-27','CMB.TECH NV','H1'],
  ['2026-08-27','Cavendish Hydrogen ASA','H1'],
  ['2026-08-27','ContextVision AB','H1'],
  ['2026-08-27','EAM Solar AS','H1'],
  ['2026-08-27','Electromagnetic Geoservices ASA','H1'],
  ['2026-08-27','Elliptic Laboratories ASA','H1'],
  ['2026-08-27','Fjord Defence Group ASA','H1'],
  ['2026-08-27','Grieg Seafood ASA','H1'],
  ['2026-08-27','HAV Group ASA','H1'],
  ['2026-08-27','Havila Kystruten AS','H1'],
  ['2026-08-27','Huddlestock Fintech AS','H1'],
  ['2026-08-27','Huddly AS','H1'],
  ['2026-08-27','Hunter Group ASA','H1'],
  ['2026-08-27','Integrated Wind Solutions ASA','H1'],
  ['2026-08-27','Kaldvik AS','H1'],
  ['2026-08-27','Lumi Education Group AS','H1'],
  ['2026-08-27','Lytix Biopharma ASA','H1'],
  ['2026-08-27','Måsøval AS','H1'],
  ['2026-08-27','Norcod AS','H1'],
  ['2026-08-27','Nordic Aqua Partners AS','H1'],
  ['2026-08-27','Nordic Halibut AS','H1'],
  ['2026-08-27','Omda AS','H1'],
  ['2026-08-27','Oncoinvent ASA','H1'],
  ['2026-08-27','Petrolia SE','H1'],
  ['2026-08-27','Resurs Bank AB (publ)','H1'],
  ['2026-08-27','River Tech p.l.c.','H1'],
  ['2026-08-27','Sentia ASA','H1'],
  ['2026-08-27','Statnett SF','H1'],
  ['2026-08-27','Å Energi AS','H1'],
  ['2026-08-28','AF Gruppen ASA','H1'],
  ['2026-08-28','Ayfie International AS','H1'],
  ['2026-08-28','BW LPG Limited','H1'],
  ['2026-08-28','Baltic Sea Properties AS','H1'],
  ['2026-08-28','Barramundi Group Ltd.','H1'],
  ['2026-08-28','Byggma ASA','H1'],
  ['2026-08-28','CodeLab Capital AS','H1'],
  ['2026-08-28','Dellia Group ASA','H1'],
  ['2026-08-28','Golden Energy Offshore Services ASA','H1'],
  ['2026-08-28','Hafnia Limited','H1'],
  ['2026-08-28','Hafslund AS','H1'],
  ['2026-08-28','Itera ASA','H1'],
  ['2026-08-28','Nordic Financials ASA','H1'],
  ['2026-08-28','Northern Ocean Ltd.','H1'],
  ['2026-08-28','Paratus Energy Services Ltd.','H1'],
  ['2026-08-28','PetroNor E&P ASA','H1'],
  ['2026-08-28','Prosafe SE','H1'],
  ['2026-08-28','Proximar Seafood AS','H1'],
  ['2026-08-28','RomReal Ltd.','H1'],
  ['2026-08-28','Thor Medical ASA','H1'],
  ['2026-08-28','Østfold Energi AS','H1'],
  ['2026-08-31','Bakkafrost P/f','H1'],
  ['2026-08-31','Circio Holding ASA','H1'],
  ['2026-08-31','Frontline plc','H1'],
  ['2026-08-31','G&O Maritime Group A/S','H1'],
  ['2026-08-31','Hörmann Industries GmbH','H1'],
  ['2026-08-31','Inin Group AS','H1'],
  ['2026-08-31','Interoil Exploration and Prod. ASA','H1'],
  ['2026-08-31','Jinhui Shipping and Transport. Ltd','H1'],
  ['2026-08-31','Lokotech Group AS','H1'],
  ['2026-08-31','Okechamp Global B.V.','H1'],
  ['2026-08-31','Pelagic Credit Plc','H1'],
  ['2026-08-31','Refuels N.V.','FY'],
  ['2026-08-31','SP Cruises Intermediate Limited','H1'],
  ['2026-08-31','Servatur Holding AS','FY'],
  ['2026-08-31','Skandia GreenPower AS','H1'],
  ['2026-08-31','TWMA Finance AS','H1'],
  ['2026-08-31','Vital Energi Midco PLC','Q4'],
  ['2026-08-31','momox Holding SE','H1'],
  ['2026-09-01','Capital Tankers Corp.','H1'],
  ['2026-09-03','EXACT Therapeutics AS','H1'],
  ['2026-09-03','Ocean GeoLoop ASA','H1'],
  ['2026-09-03','The Kingfish Company N.V.','H1'],
  ['2026-09-04','NOS Nova AS','H1'],
  ['2026-09-08','Karlsberg Brauerei GmbH','H1'],
  ['2026-09-10','Akobo Minerals AB (publ)','H1'],
  ['2026-09-11','Homann Holzwerkstoffe GmbH','H1'],
  ['2026-09-13','Katjes International GmbH & Co. KG','H1'],
  ['2026-09-15','M Vest Water AS','H1'],
  ['2026-09-23','Energeia AS','H1'],
  ['2026-09-23','SoftOx Solutions AS','H1'],
  ['2026-09-25','Pyrum Innovations AG','H1'],
  ['2026-09-30','Ace Digital AS','H1'],
  ['2026-09-30','Black Sea Property AS','H1'],
  ['2026-09-30','Servatur Holding AS','Q1'],
  ['2026-10-01','Stolt-Nielsen Limited','Q3'],
  ['2026-10-13','ABG Sundal Collier Holding ASA','Q3'],
  ['2026-10-14','Norwegian Property ASA','Q3'],
  ['2026-10-15','Entra ASA','Q3'],
  ['2026-10-19','Fremtind Forsikring AS','Q3'],
  ['2026-10-19','Kredinor AS','Q3'],
  ['2026-10-20','Gentian Diagnostics ASA','Q3'],
  ['2026-10-20','Gigante Salmon AS','Q3'],
  ['2026-10-20','Hexagon Purus ASA','Q3'],
  ['2026-10-21','DNB Bank ASA','Q3'],
  ['2026-10-21','Landkreditt Bank AS','Q3'],
  ['2026-10-21','Landkreditt Boligkreditt AS','Q3'],
  ['2026-10-21','Landkreditt Forsikring AS','Q3'],
  ['2026-10-21','NEL ASA','Q3'],
  ['2026-10-21','Storebrand ASA','Q3'],
  ['2026-10-21','Vår Energi ASA','Q3'],
  ['2026-10-22','Atea ASA','Q3'],
  ['2026-10-22','EAM Solar AS','Q3'],
  ['2026-10-22','Helgeland Kraft AS','Q3'],
  ['2026-10-22','Kitron ASA','Q3'],
  ['2026-10-22','Komplett ASA','Q3'],
  ['2026-10-22','Lea Bank AB','Q3'],
  ['2026-10-22','Nordic Semiconductor ASA','Q3'],
  ['2026-10-22','Norske Skog ASA','Q3'],
  ['2026-10-22','Protector Forsikring ASA','Q3'],
  ['2026-10-23','Gjensidige Forsikring ASA','Q3'],
  ['2026-10-23','Medistim ASA','Q3'],
  ['2026-10-23','Norsk Hydro ASA','Q3'],
  ['2026-10-23','Telford Finco','Q3'],
  ['2026-10-23','Tomra Systems ASA','Q3'],
  ['2026-10-23','Yara International ASA','Q3'],
  ['2026-10-23','Zalaris ASA','Q3'],
  ['2026-10-27','BN Bank ASA','Q3'],
  ['2026-10-27','Elopak ASA','Q3'],
  ['2026-10-27','Klaveness Combination Carriers ASA','Q3'],
  ['2026-10-27','Kraft Bank ASA','Q3'],
  ['2026-10-27','OBOS BBL','Q3'],
  ['2026-10-27','PPI Public Property Invest AB (publ)','Q3'],
  ['2026-10-27','SATS ASA','Q3'],
  ['2026-10-27','Vend Marketplaces ASA','Q3'],
  ['2026-10-28','Aker Solutions ASA','Q3'],
  ['2026-10-28','BlueNord ASA','Q3'],
  ['2026-10-28','Borregaard ASA','Q3'],
  ['2026-10-28','INIFY Laboratories AB','Q3'],
  ['2026-10-28','Norwegian Air Shuttle ASA','Q3'],
  ['2026-10-28','Photocure ASA','Q3'],
  ['2026-10-28','Pryme N.V.','Q3'],
  ['2026-10-28','Salmon Evolution ASA','Q3'],
  ['2026-10-28','SpareBank 1 Nordmøre','Q3'],
  ['2026-10-28','Sparebanken Øst','Q3'],
  ['2026-10-28','StrongPoint ASA','Q3'],
  ['2026-10-28','Voss Veksel- og Landmandsbank ASA','Q3'],
  ['2026-10-29','ABL Group ASA','Q3'],
  ['2026-10-29','Aker BP ASA','Q3'],
  ['2026-10-29','Aker BioMarine ASA','Q3'],
  ['2026-10-29','Appear ASA','Q3'],
  ['2026-10-29','Archer Limited','Q3'],
  ['2026-10-29','Axactor ASA','Q3'],
  ['2026-10-29','BW Energy Limited','Q3'],
  ['2026-10-29','DNO ASA','Q3'],
  ['2026-10-29','Deep Value Driller AS','Q3'],
  ['2026-10-29','Eidsiva Energi AS','Q3'],
  ['2026-10-29','Elkem ASA','Q3'],
  ['2026-10-29','Europris ASA','Q3'],
  ['2026-10-29','Kommunalbanken AS','Q3'],
  ['2026-10-29','Kongsberg Gruppen ASA','Q3'],
  ['2026-10-29','Navamedic ASA','Q3'],
  ['2026-10-29','Polaris Renewable Energy Inc.','Q3'],
  ['2026-10-29','Smartoptics Group ASA','Q3'],
  ['2026-10-29','SpareBank 1 Helgeland','Q3'],
  ['2026-10-29','SpareBank 1 Sør-Norge ASA','Q3'],
  ['2026-10-29','Sparebanken Norge','Q3'],
  ['2026-10-29','Statkraft AS','Q3'],
  ['2026-10-29','Vistin Pharma ASA','Q3'],
  ['2026-10-30','Boliden AB','Q3'],
  ['2026-10-30','Bonheur ASA','Q3'],
  ['2026-10-30','Borgestad ASA','Q3'],
  ['2026-10-30','G&O Maritime Group A/S','Q3'],
  ['2026-10-30','Goodtech ASA','Q3'],
  ['2026-10-30','Hafslund AS','Q3'],
  ['2026-10-30','Kongsberg Maritime ASA','Q3'],
  ['2026-10-30','Magnora ASA','Q3'],
  ['2026-10-30','Magnora Data Center ASA','Q3'],
  ['2026-10-30','Scatec ASA','Q3'],
  ['2026-10-30','Skandia GreenPower AS','Q3'],
  ['2026-10-30','Soiltech ASA','Q3'],
  ['2026-10-30','SpareBank 1 Nord-Norge','Q3'],
  ['2026-10-30','SpareBank 1 Ringerike Hadeland','Q3'],
  ['2026-10-31','Vital Energi Midco PLC','FY'],
  ['2026-11-02','Bakkafrost P/f','Q3'],
  ['2026-11-03','Høland og Setskog Sparebank','Q3'],
  ['2026-11-03','Icelandic Salmon AS','Q3'],
  ['2026-11-03','Multiconsult ASA','Q3'],
  ['2026-11-03','Norconsult ASA','Q3'],
  ['2026-11-03','Nordic Mining ASA','Q3'],
  ['2026-11-03','OKEA ASA','Q3'],
  ['2026-11-03','Odfjell Drilling Ltd','Q3'],
  ['2026-11-03','Odfjell Technology Ltd','Q3'],
  ['2026-11-03','SalMar ASA','Q3'],
  ['2026-11-03','SpareBank 1 Østfold Akershus','Q3'],
  ['2026-11-04','Arctic Fish Holding AS','Q3'],
  ['2026-11-04','BEWi ASA','Q3'],
  ['2026-11-04','Bouvet ASA','Q3'],
  ['2026-11-04','Cambi ASA','Q3'],
  ['2026-11-04','Cloudberry Clean Energy ASA','Q3'],
  ['2026-11-04','Elektroimportøren AS','Q3'],
  ['2026-11-04','Itera ASA','Q3'],
  ['2026-11-04','KLP Banken AS','Q3'],
  ['2026-11-04','KLP Boligkreditt AS','Q3'],
  ['2026-11-04','KLP Kommunekreditt AS','Q3'],
  ['2026-11-04','Link Mobility Group Holding ASA','Q3'],
  ['2026-11-04','Mowi ASA','Q3'],
  ['2026-11-04','Odfjell SE','Q3'],
  ['2026-11-04','Saga Pure ASA','Q3'],
  ['2026-11-04','Solstad Maritime ASA','Q3'],
  ['2026-11-04','Solstad Offshore ASA','Q3'],
  ['2026-11-04','SpareBank 1 Østlandet','Q3'],
  ['2026-11-04','Wallenius Wilhelmsen ASA','Q3'],
  ['2026-11-04','Wilh. Wilhelmsen Holding ASA','Q3'],
  ['2026-11-04','Zaptec ASA','Q3'],
  ['2026-11-05','Aasen Sparebank','Q3'],
  ['2026-11-05','Aker ASA','Q3'],
  ['2026-11-05','ArcticZymes Technologies ASA','Q3'],
  ['2026-11-05','AutoStore Holdings Ltd.','Q3'],
  ['2026-11-05','B2 Impact ASA','Q3'],
  ['2026-11-05','Bergen Carbon Solutions AS','Q3'],
  ['2026-11-05','ContextVision AB','Q3'],
  ['2026-11-05','Cyviz AS','Q3'],
  ['2026-11-05','Fana Sparebank','Q3'],
  ['2026-11-05','Hexagon Composites ASA','Q3'],
  ['2026-11-05','Huddly AS','Q3'],
  ['2026-11-05','Jæren Sparebank','Q3'],
  ['2026-11-05','Kid ASA','Q3'],
  ['2026-11-05','MPC Energy Solutions N.V.','Q3'],
  ['2026-11-05','MatvareExpressen AS','Q3'],
  ['2026-11-05','Moreld ASA','Q3'],
  ['2026-11-05','NRC Group ASA','Q3'],
  ['2026-11-05','Napatech A/S','Q3'],
  ['2026-11-05','Nekkar ASA','Q3'],
  ['2026-11-05','Norcod AS','Q3'],
  ['2026-11-05','Norsk Titanium AS','Q3'],
  ['2026-11-05','Ocean GeoLoop ASA','Q3'],
  ['2026-11-05','Ocean Sun AS','Q3'],
  ['2026-11-05','Olav Thon Eiendom AS','Q3'],
  ['2026-11-05','Pexip Holding ASA','Q3'],
  ['2026-11-05','Polaris Media ASA','Q3'],
  ['2026-11-05','REC Silicon ASA','Q3'],
  ['2026-11-05','Rogaland Sparebank','Q3'],
  ['2026-11-05','S.D. Standard ETC Plc','Q3'],
  ['2026-11-05','Selvaag Bolig ASA','Q3'],
  ['2026-11-05','SpareBank 1 Sogn og Fjordane','Q3'],
  ['2026-11-05','Tekna Holding ASA','Q3'],
  ['2026-11-05','The Kingfish Company N.V.','Q3'],
  ['2026-11-05','Zelluna ASA','Q3'],
  ['2026-11-05','Å Energi AS','Q3'],
  ['2026-11-06','AKVA group ASA','Q3'],
  ['2026-11-06','Byggma ASA','Q3'],
  ['2026-11-06','Flekkefjord Sparebank','Q3'],
  ['2026-11-06','Hofseth BioCare ASA','Q3'],
  ['2026-11-06','Instabank ASA','Q3'],
  ['2026-11-06','Orkla ASA','Q3'],
  ['2026-11-06','Sea1 Offshore Inc.','Q3'],
  ['2026-11-09','Eika Boligkreditt AS','Q3'],
  ['2026-11-09','ShaMaran Petroleum Ltd.','Q3'],
  ['2026-11-10','Arendals Fossekompani ASA','Q3'],
  ['2026-11-10','Austevoll Seafood ASA','Q3'],
  ['2026-11-10','Lerøy Seafood Group ASA','Q3'],
  ['2026-11-10','Nordhealth AS','Q3'],
  ['2026-11-10','Sentia ASA','Q3'],
  ['2026-11-11','Akastor ASA','Q3'],
  ['2026-11-11','Aurskog Sparebank','Q3'],
  ['2026-11-11','Bien Sparebank ASA','Q3'],
  ['2026-11-11','Capsol Technologies ASA','Q3'],
  ['2026-11-11','Ensurge Micropower ASA','Q3'],
  ['2026-11-11','Envipco Holding N.V.','Q3'],
  ['2026-11-11','Himalaya Shipping Ltd','Q3'],
  ['2026-11-11','Lytix Biopharma ASA','Q3'],
  ['2026-11-11','Okeanis Eco Tankers Corp.','Q3'],
  ['2026-11-11','SoftwareOne Holding AG','Q3'],
  ['2026-11-11','Techstep ASA','Q3'],
  ['2026-11-12','Cavendish Hydrogen ASA','Q3'],
  ['2026-11-12','DOF Group ASA','Q3'],
  ['2026-11-12','Eidesvik Offshore ASA','Q3'],
  ['2026-11-12','Elmera Group ASA','Q3'],
  ['2026-11-12','Endúr ASA','Q3'],
  ['2026-11-12','Eqva ASA','Q3'],
  ['2026-11-12','General Oceans ASA','Q3'],
  ['2026-11-12','IDEX Biometrics ASA','Q3'],
  ['2026-11-12','Induct AS','Q3'],
  ['2026-11-12','Lifecare ASA','Q3'],
  ['2026-11-12','Melhus Sparebank','Q3'],
  ['2026-11-12','Morrow Bank AB','Q3'],
  ['2026-11-12','Mutares SE & CO KGaA','Q3'],
  ['2026-11-12','NORBIT ASA','Q3'],
  ['2026-11-12','Nidaros Sparebank','Q3'],
  ['2026-11-12','Nordic Aqua Partners AS','Q3'],
  ['2026-11-12','Otovo ASA','Q3'],
  ['2026-11-12','Questerre Energy Corporation','Q3'],
  ['2026-11-12','Rogaland Sparebank Boligkreditt AS','Q3'],
  ['2026-11-12','Scana ASA','Q3'],
  ['2026-11-12','Skue Sparebank','Q3'],
  ['2026-11-12','Stainless Tankers ASA','Q3'],
  ['2026-11-12','Tinde Sparebank','Q3'],
  ['2026-11-12','Vantage Drilling International Ltd','Q3'],
  ['2026-11-12','Veidekke ASA','Q3'],
  ['2026-11-12','Xplora Technologies AS','Q3'],
  ['2026-11-13','AF Gruppen ASA','Q3'],
  ['2026-11-13','Haugesund Sparebank','Q3'],
  ['2026-11-13','HydrogenPro ASA','Q3'],
  ['2026-11-13','IDEX Biometrics ASA','Q3'],
  ['2026-11-13','Kaldvik AS','Q3'],
  ['2026-11-13','NoA Bidco AS','Q3'],
  ['2026-11-13','Romerike Sparebank','Q3'],
  ['2026-11-13','RørosBanken','Q3'],
  ['2026-11-13','Sogn Sparebank','Q3'],
  ['2026-11-13','SpareBank 1 Hallingdal Valdres','Q3'],
  ['2026-11-13','Trøndelag Sparebank','Q3'],
  ['2026-11-16','Longship Group B.V.','Q3'],
  ['2026-11-17','Andfjord Salmon Group AS','Q3'],
  ['2026-11-17','M Vest Water AS','Q3'],
  ['2026-11-17','Måsøval AS','Q3'],
  ['2026-11-17','Ocean Yield AS','Q3'],
  ['2026-11-17','Reach Subsea ASA','Q3'],
  ['2026-11-18','ALNG ASA','Q3'],
  ['2026-11-18','Arribatec Group ASA','Q3'],
  ['2026-11-18','Borr Drilling Limited','Q3'],
  ['2026-11-18','Constellation Oil Services Holding S.A.','Q3'],
  ['2026-11-18','Grong Sparebank','Q3'],
  ['2026-11-18','Hafnia Limited','Q3'],
  ['2026-11-18','Havila Shipping ASA','Q3'],
  ['2026-11-18','NEXT Biometrics Group ASA','Q3'],
  ['2026-11-18','North Energy ASA','Q3'],
  ['2026-11-18','Omda AS','Q3'],
  ['2026-11-18','SED Energy Holdings Plc','Q3'],
  ['2026-11-18','Vow ASA','Q3'],
  ['2026-11-19','BEVEST ASA','Q3'],
  ['2026-11-19','Elliptic Laboratories ASA','Q3'],
  ['2026-11-19','Huddlestock Fintech AS','Q3'],
  ['2026-11-19','Höegh Autoliners ASA','Q3'],
  ['2026-11-19','Nordic Halibut AS','Q3'],
  ['2026-11-19','Subsea 7 S.A.','Q3'],
  ['2026-11-19','Ziton A/S','Q3'],
  ['2026-11-20','Baltic Sea Properties AS','Q3'],
  ['2026-11-20','Golden Energy Offshore Services ASA','Q3'],
  ['2026-11-20','HAV Group ASA','Q3'],
  ['2026-11-20','Integrated Wind Solutions ASA','Q3'],
  ['2026-11-20','PetroNor E&P ASA','Q3'],
  ['2026-11-20','Prosafe SE','Q3'],
  ['2026-11-20','Pyrum Innovations AG','Q3'],
  ['2026-11-23','Cadeler A/S','Q3'],
  ['2026-11-24','BW LPG Limited','Q3'],
  ['2026-11-25','2020 Bulkers Ltd.','Q3'],
  ['2026-11-25','Avinor AS','Q3'],
  ['2026-11-25','BW Offshore Limited','Q3'],
  ['2026-11-25','Jacktel AS','Q3'],
  ['2026-11-25','MPC Container Ships ASA','Q3'],
  ['2026-11-25','Norse Atlantic ASA','Q3'],
  ['2026-11-25','Nykode Therapeutics ASA','Q3'],
  ['2026-11-25','SoftOx Solutions AS','Q3'],
  ['2026-11-26','CMB.TECH NV','Q3'],
  ['2026-11-26','CodeLab Capital AS','Q3'],
  ['2026-11-26','Fjord Defence Group ASA','Q3'],
  ['2026-11-26','Havila Kystruten AS','Q3'],
  ['2026-11-26','Hunter Group ASA','Q3'],
  ['2026-11-26','Neptune Bidco AS','Q3'],
  ['2026-11-27','Dellia Group ASA','Q3'],
  ['2026-11-27','Dolphin Drilling AS','Q3'],
  ['2026-11-27','NorAm Drilling AS','Q3'],
  ['2026-11-27','Nordic Financials ASA','Q3'],
  ['2026-11-27','Northern Ocean Ltd.','Q3'],
  ['2026-11-27','Paratus Energy Services Ltd.','Q3'],
  ['2026-11-27','Proximar Seafood AS','Q3'],
  ['2026-11-27','Refuels N.V.','H1'],
  ['2026-11-27','RomReal Ltd.','Q3'],
  ['2026-11-27','Shearwater GeoServices AS','Q3'],
  ['2026-11-27','Ventura Offshore Holding Ltd.','Q3'],
  ['2026-11-30','Ax INV1 Holding AS','Q3'],
  ['2026-11-30','Capital Tankers Corp.','Q3'],
  ['2026-11-30','Frontline plc','Q3'],
  ['2026-11-30','Hörmann Industries GmbH','Q3'],
  ['2026-11-30','Jinhui Shipping and Transport. Ltd','Q3'],
  ['2026-11-30','Okechamp Global B.V.','Q3'],
  ['2026-11-30','Pelagic Credit Plc','Q3'],
  ['2026-11-30','SP Cruises Intermediate Limited','Q3'],
  ['2026-11-30','TWMA Finance AS','Q3'],
  ['2026-11-30','momox Holding SE','Q3'],
  ['2026-12-10','Akobo Minerals AB (publ)','Q3'],
  ['2026-12-22','Servatur Holding AS','H1'],
  ['2026-12-31','Zenith Energy Ltd','H1'],
  ['2027-01-19','Gigante Salmon AS','Q4'],
  ['2027-01-27','Europris ASA','Q4'],
  ['2027-01-27','Gjensidige Forsikring ASA','Q4'],
  ['2027-01-28','Pareto Bank ASA','Q4'],
  ['2027-01-29','Scatec ASA','Q4'],
  ['2027-02-03','2020 Bulkers Ltd.','Q4'],
  ['2027-02-03','Nordic Mining ASA','Q4'],
  ['2027-02-04','DNB Bank ASA','Q4'],
  ['2027-02-04','Green Minerals AS','Q4'],
  ['2027-02-05','G&O Maritime Group A/S','Q4'],
  ['2027-02-05','Nordic Semiconductor ASA','Q4'],
  ['2027-02-09','Atea ASA','Q4'],
  ['2027-02-09','Hexagon Purus ASA','Q4'],
  ['2027-02-10','ABG Sundal Collier Holding ASA','Q4'],
  ['2027-02-10','Entra ASA','Q4'],
  ['2027-02-10','SpareBank 1 Nord-Norge','Q4'],
  ['2027-02-10','SpareBank 1 Nordmøre','Q4'],
  ['2027-02-11','AutoStore Holdings Ltd.','Q4'],
  ['2027-02-11','BEWi ASA','Q4'],
  ['2027-02-11','Elektroimportøren AS','Q4'],
  ['2027-02-11','Kitron ASA','Q4'],
  ['2027-02-11','NORBIT ASA','Q4'],
  ['2027-02-11','Olav Thon Eiendom AS','Q4'],
  ['2027-02-11','Polaris Media ASA','Q4'],
  ['2027-02-11','Zelluna ASA','Q4']
];

// Periode -> visningstekst i undertittel
const PERIOD_LABEL = { Q1:'Q1-rapport', Q2:'Q2-rapport', Q3:'Q3-rapport', Q4:'Q4-rapport', H1:'Halvårsrapport', FY:'Årsrapport' };

async function fmpGet(url) {
  try {
    const r = await fetch(url);
    let b = null; try { b = await r.json(); } catch (e) {}
    return { status: r.status, body: b };
  } catch (e) { return { status: 0, body: null, err: String(e) }; }
}

async function mapPool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx]); } catch (e) { out[idx] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

function extractOL(arr) {
  const map = {};
  if (!Array.isArray(arr)) return map;
  arr.forEach((it) => {
    if (!it) return;
    const sym = it.symbol || it.ticker;
    if (!sym || typeof sym !== 'string' || !sym.endsWith('.OL')) return;
    map[sym] = it.name || it.companyName || it.securityName || sym.replace('.OL', '');
  });
  return map;
}

async function getOsloSymbols() {
  const k = '&apikey=' + FMP_KEY;
  const sources = [
    ['exchange-symbols-OSL', 'https://financialmodelingprep.com/stable/available-exchange-symbols?exchange=OSL' + k],
    ['v3-symbol-OSL', 'https://financialmodelingprep.com/api/v3/symbol/OSL?apikey=' + FMP_KEY],
    ['screener-OSL', 'https://financialmodelingprep.com/stable/company-screener?exchange=OSL&limit=3000' + k],
    ['v3-screener-OSE', 'https://financialmodelingprep.com/api/v3/stock-screener?exchange=OSE&limit=3000' + k],
    ['company-symbols-list', 'https://financialmodelingprep.com/stable/company-symbols-list?apikey=' + FMP_KEY],
    ['v3-stock-list', 'https://financialmodelingprep.com/api/v3/stock/list?apikey=' + FMP_KEY],
    ['v3-available-traded', 'https://financialmodelingprep.com/api/v3/available-traded/list?apikey=' + FMP_KEY],
  ];
  const probe = [];
  for (const [name, url] of sources) {
    const r = await fmpGet(url);
    const rawCount = Array.isArray(r.body) ? r.body.length : 0;
    const map = extractOL(r.body);
    const olCount = Object.keys(map).length;
    probe.push({ source: name, status: r.status, rawCount, olCount });
    if (olCount > 0) return { nameMap: map, source: name, probe };
  }
  return { nameMap: {}, source: 'none', probe };
}

async function dividendsForSymbol(sym) {
  const s = await fmpGet('https://financialmodelingprep.com/stable/dividends?symbol=' + sym + '&apikey=' + FMP_KEY);
  if (Array.isArray(s.body)) return s.body;
  const v = await fmpGet('https://financialmodelingprep.com/api/v3/historical-price-full/stock_dividend/' + sym + '?apikey=' + FMP_KEY);
  if (v.body && Array.isArray(v.body.historical)) return v.body.historical;
  return [];
}

// Normaliser selskapsnavn for matching (fjern juridiske suffikser, tegnsetting, case)
function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\u00e6/g, 'ae').replace(/\u00f8/g, 'o').replace(/\u00e5/g, 'a')
    .replace(/[.,]/g, ' ')
    .replace(/\b(asa|asch|as|sa|plc|p\/f|ltd|limited|inc|nv|n v|ab|publ|se|gmbh|co|kg|kgaa|corp|holding|holdings|group|company|ag|a\/s|sf|bbl)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default async function handler(req, res) {
  const auth = req.headers['authorization'] || '';
  const keyParam = req.query && req.query.key;
  if (CRON_SECRET && auth !== 'Bearer ' + CRON_SECRET && keyParam !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!FMP_KEY || !SUPABASE_URL || !SERVICE_ROLE) {
    return res.status(500).json({ error: 'Mangler env-variabler', codeVersion: 'v4-euronext-reports', have: { FMP: !!FMP_KEY, SUPABASE_URL: !!SUPABASE_URL, SERVICE_ROLE: !!SERVICE_ROLE } });
  }

  const today = new Date();
  const from = ymd(today);
  const to = ymd(new Date(today.getTime() + HORIZON_DAYS * 86400000));

  // 1) Oslo-universet
  const { nameMap, source: symbolSource, probe } = await getOsloSymbols();
  const olSymbols = Object.keys(nameMap);
  const nameOf = (s) => nameMap[s] || s.replace('.OL', '');
  const strip = (s) => s.replace('.OL', '');
  let events = [];

  // Bygg navn->ticker-oppslag fra FMPs egne .OL-navn (for rapport-matching)
  const normToTicker = {};
  olSymbols.forEach((sym) => {
    const key = normName(nameMap[sym]);
    if (key && !normToTicker[key]) normToTicker[key] = strip(sym);
  });

  // 2) Utbytte per ticker (FMP gir .OL-utbytte allerede i NOK)
  const divResults = await mapPool(olSymbols, CONCURRENCY, async (sym) => ({ sym, rows: await dividendsForSymbol(sym) }));
  divResults.forEach((r) => {
    if (!r || !Array.isArray(r.rows)) return;
    r.rows.forEach((d) => {
      const exDate = d && d.date;
      if (!exDate || exDate < from || exDate > to) return;
      const amt = d.dividend != null ? Number(d.dividend) : (d.adjDividend != null ? Number(d.adjDividend) : null);
      events.push({ date: exDate, ticker: strip(r.sym), name: nameOf(r.sym), type: 'utbytte', amount: amt != null && !isNaN(amt) ? amt.toFixed(2) : undefined });
    });
  });
  const divSeen = new Set();
  events = events.filter((e) => { const key = e.ticker + '|' + e.date + '|u'; if (divSeen.has(key)) return false; divSeen.add(key); return true; });

  // 3) Rapporter fra hardkodet Euronext-kalender
  let reportMatched = 0, reportUnmatched = 0;
  const unmatchedSample = [];
  REPORTS.forEach((row) => {
    const date = row[0], rawName = row[1], period = row[2];
    if (!date || date < from || date > to) return;       // kun innenfor horisonten
    const key = normName(rawName);
    const ticker = normToTicker[key];
    if (ticker) {
      reportMatched++;
      events.push({ date, ticker, name: nameOf(ticker + '.OL'), type: 'rapport', period: PERIOD_LABEL[period] || period });
    } else {
      reportUnmatched++;
      if (unmatchedSample.length < 25) unmatchedSample.push(rawName);
      // Vis likevel raden med Euronext-navnet (uten ticker-lenke) saa datoen ikke forsvinner
      events.push({ date, ticker: '', name: rawName, type: 'rapport', period: PERIOD_LABEL[period] || period });
    }
  });
  // Dedup rapporter (samme ticker/navn + dato)
  const repSeen = new Set();
  events = events.filter((e) => {
    if (e.type !== 'rapport') return true;
    const key = (e.ticker || e.name) + '|' + e.date + '|r';
    if (repSeen.has(key)) return false; repSeen.add(key); return true;
  });

  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // 4) Lagre i Supabase
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const generatedAt = new Date().toISOString();
  const { error } = await sb.from('market_cache').upsert(
    { key: 'events', data: { events, generatedAt }, updated_at: generatedAt },
    { onConflict: 'key' }
  );
  if (error) return res.status(500).json({ error: 'Supabase upsert feilet', detail: error.message, symbolSource });

  return res.status(200).json({
    ok: true,
    codeVersion: 'v4-euronext-reports',
    symbolSource,
    osloStocks: olSymbols.length,
    dividendEvents: events.filter((e) => e.type === 'utbytte').length,
    reportEvents: events.filter((e) => e.type === 'rapport').length,
    reportMatched,
    reportUnmatched,
    unmatchedSample,
    totalEvents: events.length,
    generatedAt,
  });
}
