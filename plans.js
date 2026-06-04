// Plangrenser for Børshjelpen — ÉN sannhetskilde for hele nettstedet.
// Endrer du en grense her, oppdateres både aksjer.html (håndheving)
// og forsiden (pris-kortene) automatisk.
// Infinity = ubegrenset.
window.PLANS = {
  free:     { aiAnalysis: 2,   aiChat: 5,   watchlist: 2 },
  investor: { aiAnalysis: 200, aiChat: 200, watchlist: 10 },
  proff:    { aiAnalysis: 200, aiChat: 200, watchlist: Infinity }
};
