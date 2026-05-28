# Børshjelpen — Oppsett

## Filstruktur
```
borshjelpen/
├── borshjelpen.html      ← Landingssiden
├── aksjer.html           ← Aksjesøk med live data
├── vercel.json           ← Vercel-konfig
├── README.md             ← Denne filen
└── api/
    └── stock.js          ← Henter data fra Twelve Data (lisensiert)
```

---

## Steg 1 — Skaff API-nøkkel fra Twelve Data (gratis å starte)

1. Gå til twelvedata.com
2. Lag gratis konto
3. Gå til Dashboard → API Keys
4. Kopier nøkkelen din

Gratis plan: 800 kall/dag — nok til testing.
Kommersiell plan: ~$29/mnd — tillater redistribusjon og betalt nettside.

---

## Steg 2 — Publiser på Vercel

1. Gå til github.com → lag konto → "New repository" kalt "borshjelpen"
2. Last opp alle filene med mappestrukturen over (dra og slipp)
3. Gå til vercel.com → lag konto → "Add New Project"
4. Koble til GitHub-repoet → klikk Deploy

---

## Steg 3 — Legg til API-nøkkel i Vercel

Dette er viktig — nøkkelen skal IKKE ligge i koden:

1. Gå til prosjektet ditt på vercel.com
2. Settings → Environment Variables
3. Legg til:
   - Name:  TWELVE_DATA_API_KEY
   - Value: (lim inn nøkkelen din)
4. Klikk Save → Redeploy

---

## Ticker-format

Oslo Børs:        EQNR, DNB, TEL, AKRBP, MOWI, YAR, NHY, KAHOT
Internasjonale:   AAPL, NVDA, MSFT, TSLA (legg til når du er klar)

---

## Oppgrader til kommersiell plan

Når du begynner å ta betalt fra brukere:
1. Gå til twelvedata.com/pricing
2. Velg "Grow" plan (~$29/mnd)
3. Dette gir deg rett til kommersiell redistribusjon av data

---

## Neste steg — AI-sammendrag

Legg til en ny fil api/summary.js som kaller Claude API
og genererer norsk sammendrag basert på aksjedataene.
Trenger ANTHROPIC_API_KEY i Vercel Environment Variables.

---

## AI-sammendrag med Claude

Legg til en ny miljøvariabel i Vercel:
- Name:  ANTHROPIC_API_KEY
- Value: (hent fra console.anthropic.com → API Keys)

Når begge nøklene er satt vil nettsiden:
1. Hente kursdata fra Twelve Data
2. Sende dataene til Claude
3. Claude genererer norsk sammendrag med bull/bear, scenarioer og nybegynnertips
4. Alt vises automatisk på siden


---

## Autentisering med Supabase (gratis)

### Steg 1 — Lag Supabase-prosjekt
1. Gå til supabase.com → lag gratis konto
2. "New project" → gi det et navn
3. Gå til Settings → API
4. Kopier "Project URL" og "anon public" nøkkel

### Steg 2 — Aktiver Google-innlogging (valgfritt)
1. I Supabase: Authentication → Providers → Google
2. Aktiver og følg instruksjonene for å koble Google OAuth

### Steg 3 — Lim inn nøklene
I både auth.html og profil.html, erstatt:
  DIN_SUPABASE_URL       → din Project URL
  DIN_SUPABASE_ANON_KEY  → din anon public nøkkel

### Steg 4 — Koble innlogging til resten av sidene
I borshjelpen.html og aksjer.html — legg til denne koden
i <head> for å vise riktig navbar basert på innloggingsstatus:

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script>
    const sb = supabase.createClient('DIN_URL', 'DIN_KEY');
    sb.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        document.getElementById('navAuth').style.display = 'none';
        document.getElementById('navUser').style.display = 'flex';
      }
    });
  </script>

### Filer
- auth.html   → logg inn / registrer deg
- profil.html → brukerside etter innlogging

#oppdatert
