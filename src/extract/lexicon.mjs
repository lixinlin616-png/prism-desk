/**
 * Lexicons used by the deterministic extractor and by the risk-flag channel.
 *
 * Kept explicit and auditable on purpose: when Prism runs offline the whole
 * "reading" of a document reduces to these weighted term lists, so a reviewer
 * can see exactly why a card was produced instead of trusting a black box.
 */

/** Guidance / outlook direction. */
/**
 * Guidance / outlook direction.
 *
 * Terms are deliberately multi-word where the single word is ambiguous: "raised"
 * appears in "raised prices", "raised inventory" and "raised guidance", and only
 * the last one is an outlook event. Ties are broken toward the MORE SEVERE
 * stance (see GUIDANCE_PRIORITY) because a false "raise" is far more expensive
 * than a false "lower" on a research desk.
 */
export const GUIDANCE = {
  raise: ['raise', 'raised', 'raising', 'above our prior outlook', 'better than expected', 'upside to our guidance', 'now expect higher', 'increased its full-year', 'increased our full-year', 'raised its full-year', 'raised the full-year', 'raised its outlook', 'raised our outlook', 'increased its outlook'],
  lower: ['lower', 'lowered', 'lowering', 'reduced', 'reducing', 'below our prior outlook', 'cut our guidance', 'now expect lower', 'narrowed to the low end', 'softening demand', 'reduced production'],
  reiterate: ['reiterate', 'reaffirm', 'maintain', 'unchanged', 'in line with our prior outlook', 'consistent with guidance'],
  withdraw: ['withdraw', 'withdrawing', 'withdrew', 'suspend', 'suspending', 'unable to provide', 'not providing guidance', 'withdrawn our outlook', 'will not reinstate'],
};

/** Most severe first - used to break classification ties conservatively. */
export const GUIDANCE_PRIORITY = ['withdraw', 'lower', 'raise', 'reiterate'];

/** Nouns that make a withdrawal an OUTLOOK event rather than loose phrasing. */
const GUIDANCE_NOUNS = ['guidance', 'outlook', 'forecast', 'full-year', 'full year', 'out-year', 'projection', 'range', 'target range'];

/**
 * Detect a withdrawal of the OUTLOOK specifically.
 *
 * "The company withdrew its prior comment on the long-term margin framework" is
 * bad news but it is not a guidance withdrawal. "The company withdrew its
 * full-year outlook" is. Requiring a guidance noun within a 90-character window
 * of the withdrawal verb keeps the two apart, which matters because withdraw is
 * the most heavily penalised stance in the rubric.
 */
export function findGuidanceWithdrawals(text) {
  const low = String(text ?? '').toLowerCase();
  const hits = [];
  for (const term of GUIDANCE.withdraw) {
    let idx = low.indexOf(term);
    while (idx !== -1) {
      const window = low.slice(Math.max(0, idx - 90), idx + term.length + 90);
      const noun = GUIDANCE_NOUNS.find((n) => window.includes(n));
      if (noun) hits.push({ term, noun, context: window.replace(/\s+/g, ' ').trim() });
      idx = low.indexOf(term, idx + term.length);
    }
  }
  return hits;
}

/** Hawkish / dovish language for central-bank text. */
export const POLICY = {
  hawkish: ['inflation remains elevated', 'upside risks to inflation', 'further policy firming', 'higher for longer', 'restrictive', 'ongoing increases', 'not yet sufficiently restrictive', 'price stability', 'tightening', 'hike', 'rate increase', 'inflation has not yet'],
  dovish: ['disinflation', 'inflation has eased', 'downside risks', 'pause', 'hold', 'balanced risks', 'progress toward 2 percent', 'restrictive enough', 'cuts', 'rate cut', 'easing', 'moderating', 'softening'],
  recession: ['contraction', 'recession', 'deteriorat', 'sharp slowdown', 'stress', 'contagion', 'tighter credit conditions', 'weakening labor market', 'rising unemployment'],
};

/** Business-condition sentiment, weighted. */
export const SENTIMENT = {
  positive: ['record revenue', 'all-time high', 'beat', 'exceeded', 'strong demand', 'accelerat', 'expansion', 'margin expansion', 'operating leverage', 'outperform', 'momentum', 'tailwind', 'robust', 'better than expected', 'upgrade', 'raised full-year'],
  negative: ['miss', 'below expectations', 'weak demand', 'weakening demand', 'slowdown', 'decelerat', 'contraction', 'margin pressure', 'margin declined', 'gross margin declined', 'headwind', 'impairment', 'write-down', 'restructur', 'layoff', 'downgrade', 'downgraded', 'softness', 'softening', 'deteriorat', 'inventory build', 'elevated channel inventory', 'markdowns', 'pricing pressure', 'challenging environment', 'legal provision', 'withdrew', 'unable to provide guidance', 'unusual uncertainty', 'strategic review', 'covenant', 'declined'],
};

/** Language that historically precedes trouble - drives the risk-flag channel. */
export const RISK_LANGUAGE = [
  'substantial doubt', 'going concern', 'material weakness', 'restatement', 'delayed filing',
  'investigation', 'subpoena', 'litigation reserve', 'goodwill impairment', 'covenant',
  'liquidity', 'customer concentration', 'reliance on a single', 'declining retention',
  'churn', 'deferred revenue declined', 'days sales outstanding increased', 'aggressive recognition',
];

/** Accounting / balance-sheet anomalies worth flagging. */
export const RISK_RATIO_CHECKS = [
  { id: 'dso-inflation', label: 'Receivables growing faster than revenue', test: (r) => r.dsoGrowthPct - r.revenueGrowthPct > 8 },
  { id: 'inventory-build', label: 'Inventory building faster than sales', test: (r) => r.inventoryGrowthPct - r.revenueGrowthPct > 10 },
  { id: 'fcf-negative', label: 'Positive net income but negative free cash flow', test: (r) => r.netIncome > 0 && r.fcf < 0 },
  { id: 'leverage-spike', label: 'Net debt / EBITDA above 4x', test: (r) => r.netDebtToEbitda > 4 },
  { id: 'margin-erosion', label: 'Gross margin down more than 300bp y/y', test: (r) => r.grossMarginDeltaBp < -300 },
];

/**
 * Macro transmission map.
 *
 * For each macro surprise type, which channels get hit and in which direction.
 * `betaTag` selects the cross-sectional sorting variable that the engine then
 * computes from the real bundled price dataset - so the ranking is measured,
 * not asserted.
 */
export const TRANSMISSION = {
  cpi: {
    label: 'Inflation print (CPI)',
    hot: {
      narrative: 'Hotter inflation pushes the terminal policy rate higher, raising the discount rate applied to long-dated cash flows.',
      hits: [
        { betaTag: 'duration', direction: -1, mechanism: 'Higher discount rate compresses the present value of long-dated growth cash flows' },
        { betaTag: 'rateBeta', direction: -1, mechanism: 'Long-duration equity proxies behave like long bonds' },
        { betaTag: 'leverage', direction: -1, mechanism: 'Higher refinancing cost for levered balance sheets' },
      ],
      beneficiaries: [
        { betaTag: 'energyWeight', direction: 1, mechanism: 'Energy and commodity producers are the inflation hedge' },
      ],
    },
    cool: {
      narrative: 'Cooler inflation pulls the terminal policy rate lower, cutting the discount rate and re-rating long-dated cash flows.',
      hits: [
        { betaTag: 'energyWeight', direction: -1, mechanism: 'Disinflation removes the commodity bid' },
      ],
      beneficiaries: [
        { betaTag: 'duration', direction: 1, mechanism: 'Long-duration growth re-rates higher as the discount rate falls' },
        { betaTag: 'rateBeta', direction: 1, mechanism: 'Rate-sensitive proxies rally with the bond complex' },
        { betaTag: 'leverage', direction: 1, mechanism: 'Cheaper refinancing for levered balance sheets' },
      ],
    },
  },
  nfp: {
    label: 'Labor market print (NFP / claims)',
    hot: {
      narrative: 'A hot labor market keeps wage growth and services inflation sticky, delaying easing.',
      hits: [{ betaTag: 'duration', direction: -1, mechanism: 'Higher-for-longer repricing hits long-duration equity' }],
      beneficiaries: [{ betaTag: 'cyclical', direction: 1, mechanism: 'Strong demand supports cyclicals' }],
    },
    cool: {
      narrative: 'A cooling labor market raises easing odds but also recession risk - a two-sided shock.',
      hits: [{ betaTag: 'cyclical', direction: -1, mechanism: 'Demand-sensitive cyclicals take the growth scare' }],
      beneficiaries: [{ betaTag: 'duration', direction: 1, mechanism: 'Rate-cut expectations lift long-duration growth' }],
    },
  },
  fomc: {
    label: 'Policy decision (FOMC)',
    hot: {
      narrative: 'A hawkish shift raises the expected policy path and tightens financial conditions.',
      hits: [{ betaTag: 'duration', direction: -1, mechanism: 'Discount-rate shock' }, { betaTag: 'leverage', direction: -1, mechanism: 'Funding cost shock' }],
      beneficiaries: [{ betaTag: 'energyWeight', direction: 1, mechanism: 'Commodity-linked value is the relative haven in a hawkish repricing' }],
    },
    cool: {
      narrative: 'A dovish shift lowers the expected policy path and eases financial conditions.',
      hits: [{ betaTag: 'energyWeight', direction: -1, mechanism: 'Easing removes the commodity bid and the inflation hedge' }],
      beneficiaries: [{ betaTag: 'duration', direction: 1, mechanism: 'Discount-rate relief rally' }, { betaTag: 'leverage', direction: 1, mechanism: 'Cheaper funding' }],
    },
  },
  pmi: {
    label: 'Activity print (PMI / ISM)',
    hot: { narrative: 'Expanding activity supports the earnings cycle.', hits: [{ betaTag: 'duration', direction: -1, mechanism: 'Fewer cuts priced' }], beneficiaries: [{ betaTag: 'cyclical', direction: 1, mechanism: 'Demand-sensitive earnings upside' }] },
    cool: { narrative: 'Contracting activity threatens the earnings cycle.', hits: [{ betaTag: 'cyclical', direction: -1, mechanism: 'Demand-sensitive earnings downside' }], beneficiaries: [{ betaTag: 'duration', direction: 1, mechanism: 'Growth scare cuts the discount rate' }] },
  },
};

export const MACRO_KINDS = Object.keys(TRANSMISSION);

/** Term -> weight used to score free text. Returns a normalised [-1, 1] tone. */
export function toneScore(text) {
  const hay = String(text || '').toLowerCase();
  let pos = 0;
  let neg = 0;
  for (const t of SENTIMENT.positive) pos += hay.split(t).length - 1;
  for (const t of SENTIMENT.negative) neg += hay.split(t).length - 1;
  const total = pos + neg;
  return { tone: total ? (pos - neg) / total : 0, positives: pos, negatives: neg, hits: total };
}

export function countTerms(text, terms) {
  const hay = String(text || '').toLowerCase();
  const found = [];
  for (const t of terms) if (hay.includes(t)) found.push(t);
  return found;
}

export function classifyGuidance(text) {
  const scores = {};
  const matchedByStance = {};
  for (const [k, terms] of Object.entries(GUIDANCE)) {
    matchedByStance[k] = countTerms(text, terms);
    scores[k] = matchedByStance[k].length;
  }
  // A withdrawal of the OUTLOOK is categorical: it overrides any raise/lower term
  // count, because "we cannot give you a number" is strictly worse than a bad
  // number. Withdrawals of ancillary commentary do not qualify.
  const withdrawals = findGuidanceWithdrawals(text);
  if (withdrawals.length) {
    return { stance: 'withdraw', scores, matched: matchedByStance.withdraw, withdrawals };
  }
  // The word appeared but never next to an outlook noun - "withdrew its prior
  // comment on the margin philosophy" is not a guidance withdrawal. Without this
  // the raw term count below would promote it to the most heavily penalised
  // stance in the rubric, which is the false positive the proximity rule exists
  // to prevent. Proximity has to be able to say no, not only yes.
  scores.withdraw = 0;
  let best = null;
  for (const stance of GUIDANCE_PRIORITY) {
    if (scores[stance] > 0 && (best === null || scores[stance] > scores[best])) best = stance;
  }
  if (!best) return { stance: 'unclear', scores, withdrawals: [] };
  return { stance: best, scores, matched: matchedByStance[best], withdrawals: [] };
}

export function classifyPolicy(text) {
  const hawkish = countTerms(text, POLICY.hawkish).length;
  const dovish = countTerms(text, POLICY.dovish).length;
  const recession = countTerms(text, POLICY.recession).length;
  const net = hawkish - dovish;
  return {
    stance: net > 0 ? 'hawkish' : net < 0 ? 'dovish' : 'neutral',
    hawkish, dovish, recession, net,
    matchedHawkish: countTerms(text, POLICY.hawkish),
    matchedDovish: countTerms(text, POLICY.dovish),
  };
}

export function riskLanguageHits(text) {
  return countTerms(text, RISK_LANGUAGE);
}