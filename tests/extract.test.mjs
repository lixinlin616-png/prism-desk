/**
 * Question planning, lexicon and extraction tests.
 *
 * Two things are being pinned down here. First, that a natural-language question
 * routes to the right channels and data intents in both English and Chinese -
 * the LUI is the product surface, so misrouting is a real defect. Second, that
 * the lexicon distinguishes the cases that matter, above all a guidance
 * WITHDRAWAL from ordinary bad news, because withdraw is the most heavily
 * penalised stance in the rubric.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planQuestion } from '../src/desk/pipeline.mjs';
import {
  classifyGuidance, findGuidanceWithdrawals, classifyPolicy, toneScore,
  riskLanguageHits, GUIDANCE_PRIORITY, TRANSMISSION, MACRO_KINDS,
} from '../src/extract/lexicon.mjs';
import { RuleExtractor } from '../src/extract/rules.mjs';
import { Extractor } from '../src/extract/index.mjs';
import { Pipeline } from '../src/desk/pipeline.mjs';
import { initHub } from '../src/ingest/index.mjs';
import { CHANNEL_IDS } from '../src/schema.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EVAL_SET = JSON.parse(readFileSync(join(ROOT, 'data', 'eval', 'extraction-eval.json'), 'utf8'));
const evalDoc = (id) => EVAL_SET.extraction.find((c) => c.id === id).document;

// --------------------------------------------------------------- planQuestion

test('an earnings question routes to earnings-gap and pulls the right intents', () => {
  const p = planQuestion('How did the quarterly EPS print compare with guidance?');
  assert.ok(p.channels.includes('earnings-gap'));
  assert.ok(p.intents.includes('earningsCalendar'));
  assert.ok(p.intents.includes('analystEstimates'));
  assert.ok(p.docKinds.includes('earnings-release'));
});

test('a CPI question routes to macro-transmission and identifies the indicator', () => {
  const p = planQuestion('The August CPI inflation print came in cool - map the transmission.');
  assert.ok(p.channels.includes('macro-transmission'));
  assert.ok(!p.matched.includes('earnings-gap'), 'the word "print" is not an earnings print');
  assert.ok(p.indicators.includes('cpi'));
  assert.ok(p.docKinds.includes('macro-print'));
});

test('a closed-window question routes to closed-window', () => {
  for (const q of ['the rToken still trades over the weekend while the cash market is closed', 'how should I price the overnight gap']) {
    assert.ok(planQuestion(q).channels.includes('closed-window'), `failed to route: ${q}`);
  }
});

test('a flow question routes to flow-footprint and pulls insider/13F intents', () => {
  const p = planQuestion('Any insider selling clusters or 13F position changes?');
  assert.ok(p.channels.includes('flow-footprint'));
  assert.ok(p.intents.includes('insiderTrades'));
  assert.ok(p.intents.includes('institutionalHoldings'));
});

test('a risk question routes to risk-flag and pulls the balance-sheet intents', () => {
  const p = planQuestion('Where is the bear case and are there accounting red flags?');
  assert.ok(p.channels.includes('risk-flag'));
  assert.ok(p.intents.includes('ratios'));
});

test('Chinese questions route to the same channels as their English equivalents', () => {
  assert.ok(planQuestion('这家公司的财报和业绩指引怎么样').channels.includes('earnings-gap'));
  assert.ok(planQuestion('CPI 通胀数据对市场的传导链路是什么').channels.includes('macro-transmission'));
  assert.ok(planQuestion('周末休市期间 rToken 怎么定价').channels.includes('closed-window'));
  assert.ok(planQuestion('有没有内部人减持和机构资金变化').channels.includes('flow-footprint'));
  assert.ok(planQuestion('这个标的有什么做空风险和暴雷迹象').channels.includes('risk-flag'));
  assert.ok(planQuestion('非农不及预期，传导到谁').matched.includes('macro-transmission'));
  assert.ok(planQuestion('美联储如果降息，久期怎么走').matched.includes('macro-transmission'));
  assert.ok(planQuestion('代币化美股周末跳空怎么定价').matched.includes('closed-window'));
  assert.ok(planQuestion('这份财报超预期但撤回了指引').matched.includes('earnings-gap'));
  assert.ok(planQuestion('技术面超买，离 200 日均线太远').matched.includes('risk-flag'));
  assert.ok(planQuestion('才报和业绩指引怎么样').matched.includes('earnings-gap'), '才报 is a listed typo for 财报');
  assert.ok(planQuestion('CPI 低于预期，哪些标的的传导最强？').matched.includes('macro-transmission'));
  assert.ok(!planQuestion('CPI 低于预期，哪些标的的传导最强？').matched.includes('earnings-gap'));
});

test('a company named in Chinese resolves to its ticker instead of falling back to the issuers in scope', () => {
  // TICKER_RE sees Latin letters only, so before the alias list "英伟达财报" resolved
  // zero tickers and the desk answered with whatever issuers were in scope.
  assert.deepEqual(planQuestion('英伟达下周财报前该怎么 positioning').tickers, ['NVDA']);
  assert.deepEqual(planQuestion('苹果和微软的估值贵不贵').tickers, ['AAPL', 'MSFT']);
  assert.deepEqual(planQuestion('特斯拉这次跳空多大').tickers, ['TSLA']);
  assert.deepEqual(planQuestion('标普500ETF 和纳指ETF 谁更强').tickers, ['SPY', 'QQQ']);
  // A named ticker means the question was parsed, so it must not be reported as
  // off-domain (a scan is not an answer to a specific ask).
  assert.equal(planQuestion('英伟达有什么风险').offDomain, false);
  // Mixed Chinese and Latin still resolves once, and a plain Latin name is unaffected.
  assert.deepEqual(planQuestion('英伟达 NVDA 的预期差').tickers, ['NVDA']);
  assert.deepEqual(planQuestion('怎么看 CRVS 这份财报').tickers, ['CRVS']);
  // No name, no ticker: the fallback stays a labelled fallback.
  assert.deepEqual(planQuestion('这份财报超预期但撤回了指引').tickers, []);
});

test('english substring traps do not open the wrong channel', () => {
  const disclosed = planQuestion('The company disclosed a material weakness in its controls.');
  assert.ok(!disclosed.matched.includes('closed-window'), 'disclosed must not match closed');
  const method = planQuestion('Is there a methodology for something like position sizing?');
  assert.ok(!method.matched.includes('cross-asset'), `methodology/something opened ${method.matched.join(',')}`);
  const feedback = planQuestion('Any feedback on the product roadmap?');
  assert.ok(!feedback.matched.includes('macro-transmission'), 'feedback must not match fed');
  const cpi = planQuestion('The August CPI print came in cool on the headline but hot on core.');
  assert.deepEqual(cpi.matched, ['macro-transmission']);
  const earn = planQuestion('Walk me through the earnings expectation gaps in scope.');
  assert.ok(earn.matched.includes('earnings-gap'));
  assert.ok(!earn.matched.includes('closed-window'), 'expectation gaps are not the overnight gap');
  const typo = planQuestion('earinngs guidnace versus concensus');
  assert.ok(typo.matched.includes('earnings-gap'));
});

test('uppercase ordinary words are candidates only, and are rejected at resolution', async () => {
  // planQuestion works on raw text, so "Full desk sweep" yields FULL/DESK/SWEEP as
  // CANDIDATES. The pipeline resolves them against the symbols the desk can
  // actually price or read, which is where the junk has to be dropped.
  const p = planQuestion('Full desk sweep across every channel - what is tradeable?');
  assert.ok(p.tickers.includes('FULL'), 'the candidate list is deliberately permissive');

  const desk = new Pipeline();
  await desk.ready();
  const run = await desk.runTask({ question: 'Full desk sweep across every channel', asOf: new Date('2025-09-19T20:00:00Z'), persist: false });
  for (const junk of ['FULL', 'DESK', 'SWEEP']) {
    assert.ok(!run.plan.tickersResolved.includes(junk), `${junk} survived resolution into the data plan`);
    assert.ok(run.plan.tickersRejected.includes(junk), `${junk} was not reported as rejected`);
  }
  assert.ok(run.cards.every((c) => !(c.tickers || []).some((t) => ['FULL', 'DESK', 'SWEEP'].includes(t))),
    'a non-ticker word ended up on a card');
});

test('a real ticker in the question is picked up', () => {
  const p = planQuestion('What is the desk read on NVDA and CRVS right now?');
  assert.ok(p.tickers.includes('NVDA'));
  assert.ok(p.tickers.includes('CRVS'));
});

test('a question that matches nothing still returns a well-formed plan', () => {
  const p = planQuestion('hello');
  assert.deepEqual(p.channels.filter((c) => !CHANNEL_IDS.includes(c)), []);
  assert.ok(p.session && typeof p.session.state === 'string');
  assert.ok(Array.isArray(p.intents));
});

test('the plan always carries a US cash session state - the closed-window channel depends on it', () => {
  const p = planQuestion('anything tradeable');
  assert.ok(['open', 'closed', 'pre-market', 'after-hours', 'unknown'].includes(p.session.state), p.session.state);
});

// -------------------------------------------------------------------- lexicon

test('guidance stances are classified correctly', () => {
  assert.equal(classifyGuidance('The company raised its full-year outlook and now expects higher revenue.').stance, 'raise');
  assert.equal(classifyGuidance('The company lowered its guidance citing softening demand.').stance, 'lower');
  assert.equal(classifyGuidance('The company reiterated its prior outlook, unchanged.').stance, 'reiterate');
  assert.equal(classifyGuidance('Results were fine.').stance, 'unclear');
});

test('an OUTLOOK withdrawal is categorical and beats any number of raise terms', () => {
  const text = 'The company raised its full-year revenue outlook and increased its dividend. Separately, it withdrew its long-term guidance and will not provide updated projections at this time.';
  const g = classifyGuidance(text);
  assert.equal(g.stance, 'withdraw');
  assert.ok(g.withdrawals.length >= 1);
});

test('a withdrawal of something that is NOT the outlook does not count as a guidance withdrawal', () => {
  // This is the false positive the proximity rule exists to prevent.
  const text = 'Management withdrew its prior comment on the long-term margin philosophy during the Q&A.';
  assert.equal(findGuidanceWithdrawals(text).length, 0);
  assert.notEqual(classifyGuidance(text).stance, 'withdraw');
});

test('withdraw is the most severe stance in the tie-break order', () => {
  assert.equal(GUIDANCE_PRIORITY[0], 'withdraw');
});

test('central-bank language is classified hawkish vs dovish', () => {
  assert.equal(classifyPolicy('Inflation remains elevated and further policy firming may be appropriate; the stance stays restrictive.').stance, 'hawkish');
  assert.equal(classifyPolicy('Disinflation has progressed, risks are balanced, and the committee discussed rate cuts and easing.').stance, 'dovish');
});

test('toneScore is signed and counts its hits', () => {
  const pos = toneScore('Record revenue, strong demand, accelerating momentum, margin expansion and a robust tailwind.');
  const neg = toneScore('A miss below expectations, weak demand, margin pressure, an impairment and a downgrade.');
  assert.ok(pos.tone > 0.5, `positive tone was ${pos.tone}`);
  assert.ok(neg.tone < -0.5, `negative tone was ${neg.tone}`);
  assert.ok(pos.hits >= 3 && neg.hits >= 3);
  assert.equal(toneScore('The meeting will be held on November 14.').tone, 0);
});

test('riskLanguageHits finds the terms that historically precede trouble', () => {
  const hits = riskLanguageHits('The company disclosed a material weakness, an ongoing investigation and substantial doubt about liquidity, alongside customer concentration.');
  for (const term of ['material weakness', 'investigation', 'substantial doubt', 'liquidity', 'customer concentration']) {
    assert.ok(hits.includes(term), `missed ${term}`);
  }
  assert.deepEqual(riskLanguageHits('A routine annual meeting notice.'), []);
});

test('every macro indicator has a narrated transmission map for both directions', () => {
  assert.ok(MACRO_KINDS.length >= 4);
  for (const k of MACRO_KINDS) {
    const t = TRANSMISSION[k];
    assert.ok(t, `${k} has no transmission map`);
    for (const side of ['hot', 'cool']) {
      const leg = t[side];
      assert.ok(leg, `${k}.${side} is missing`);
      assert.ok(typeof leg.narrative === 'string' && leg.narrative.length > 20, `${k}.${side} has no narrative - the claim would be unexplained`);
      assert.ok(Array.isArray(leg.hits) && leg.hits.length, `${k}.${side} has no harmed factor legs`);
      for (const hop of [...leg.hits, ...(leg.beneficiaries || [])]) {
        assert.ok(hop.betaTag, `${k}.${side} has a leg with no betaTag - it could not be measured`);
        assert.ok(hop.direction === 1 || hop.direction === -1, `${k}.${side} has a leg with no sign`);
        assert.ok(hop.mechanism, `${k}.${side} has a leg with no mechanism`);
      }
    }
  }
});

// ------------------------------------------------------------------ extraction

test('the rule extractor routes each labelled eval document to the expected channel', async () => {
  const hub = await initHub();
  const rules = new RuleExtractor({ hub });
  const expected = {
    'earn-beat-raise': 'earnings-gap',
    'earn-miss-lower': 'earnings-gap',
    'earn-beat-withdraw': 'earnings-gap',
    'macro-cpi-hot': 'macro-transmission',
    'macro-nfp-cool': 'macro-transmission',
    'fomc-hawkish': 'macro-transmission',
    'risk-filing': 'risk-flag',
    'news-constructive': 'narrative-shift',
    'news-negative': 'narrative-shift',
  };
  for (const [id, channel] of Object.entries(expected)) {
    const cards = rules.extractFromDocument(evalDoc(id), { asOf: evalDoc(id).publishedAt });
    assert.ok(cards.length >= 1, `${id} produced no card`);
    assert.ok(cards.some((c) => c.channel === channel), `${id} produced ${cards.map((c) => c.channel).join(',')}, expected ${channel}`);
  }
});

test('the rule extractor produces nothing for an uninformative document', async () => {
  const hub = await initHub();
  const rules = new RuleExtractor({ hub });
  const cards = rules.extractFromDocument(evalDoc('negative-control-bland'), { asOf: evalDoc('negative-control-bland').publishedAt });
  assert.equal(cards.length, 0, `a routine meeting notice produced ${cards.length} card(s): ${cards.map((c) => c.title).join('; ')}`);
});

test('every extracted card carries grounded evidence and an invalidation condition', async () => {
  const hub = await initHub();
  const rules = new RuleExtractor({ hub });
  for (const c of EVAL_SET.extraction) {
    for (const card of rules.extractFromDocument(c.document, { asOf: c.document.publishedAt })) {
      assert.ok(card.evidence.length >= 1, `${c.id}: card with no evidence`);
      assert.ok(card.evidence.some((e) => e.headline), `${c.id}: no headline evidence flagged`);
      assert.ok(card.invalidation?.condition, `${c.id}: card is unfalsifiable`);
      for (const e of card.evidence) assert.equal(e.verified, 'pending', `${c.id}: evidence pre-marked as ${e.verified} before the ledger ran`);
    }
  }
});

test('Extractor in rules-only mode agrees with RuleExtractor', async () => {
  process.env.PRISM_EXTRACTOR = 'rules';
  const hub = await initHub();
  const extractor = new Extractor({ hub });
  const rules = new RuleExtractor({ hub });
  assert.equal(extractor.mode, 'rules');
  const docs = [evalDoc('earn-beat-raise'), evalDoc('macro-cpi-hot')];
  const viaExtractor = await extractor.run({ question: 'what is tradeable', documents: docs, channels: CHANNEL_IDS, asOf: '2025-09-19T20:00:00Z' });
  const viaRules = rules.extractFromDocuments(docs, { asOf: '2025-09-19T20:00:00Z' });
  assert.equal(viaExtractor.cards.length, viaRules.length);
  assert.deepEqual(
    viaExtractor.cards.map((c) => c.title).sort(),
    viaRules.map((c) => c.title).sort(),
  );
  delete process.env.PRISM_EXTRACTOR;
});

test('the extractor stamps every card against the run clock, so --as-of actually changes the answer', async () => {
  const hub = await initHub();
  const extractor = new Extractor({ hub });
  const docs = [evalDoc('earn-beat-raise')];
  const early = await extractor.run({ question: 'q', documents: docs, asOf: '2025-09-17T00:00:00Z' });
  const late = await extractor.run({ question: 'q', documents: docs, asOf: '2025-10-17T00:00:00Z' });
  assert.equal(early.cards[0].createdAt, '2025-09-17T00:00:00.000Z');
  assert.equal(late.cards[0].createdAt, '2025-10-17T00:00:00.000Z');
  // Information age differs by a month, so freshness must differ too.
  assert.equal(early.cards[0].informationAt, late.cards[0].informationAt);
  assert.notEqual(early.cards[0].expiresAt, late.cards[0].expiresAt);
});

test('informationAt is never in the future relative to the run clock', async () => {
  const hub = await initHub();
  const extractor = new Extractor({ hub });
  const docs = [evalDoc('earn-beat-raise')]; // published 2025-09-16
  const res = await extractor.run({ question: 'q', documents: docs, asOf: '2025-09-01T00:00:00Z' });
  for (const card of res.cards) {
    assert.ok(Date.parse(card.informationAt) <= Date.parse(card.createdAt),
      `${card.id}: informationAt ${card.informationAt} is after createdAt ${card.createdAt}`);
  }
});

// ---------------------------------------------------------- LLM output hygiene

test('hydrate drops LLM cards with an unknown channel rather than inventing one', async () => {
  const hub = await initHub();
  const extractor = new Extractor({ hub });
  const out = extractor.hydrate({
    cards: [
      { channel: 'moonshot', claim: 'x', title: 'bad' },
      null,
      'not-an-object',
      { channel: 'earnings-gap', title: 'good', claim: 'A well-formed card from the model.', direction: 'long', tickers: ['nvda'], evidence: [] },
    ],
  }, { asOf: '2025-09-19T20:00:00Z', documents: [] });
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'good');
  assert.deepEqual(out[0].tickers, ['NVDA']);
});

test('hydrate coerces out-of-range model values instead of trusting them', async () => {
  const hub = await initHub();
  const extractor = new Extractor({ hub });
  const [card] = extractor.hydrate({
    cards: [{
      channel: 'macro-transmission', title: 't', claim: 'c',
      direction: 'sideways', horizon: 'whenever', instruments: ['magic'],
      conviction: 999,
      transmissionChain: [{ from: 'a', to: 'b', mechanism: 'm', confidence: 42 }],
      evidence: [{ quote: 'x'.repeat(5000) }],
    }],
  }, { asOf: '2025-09-19T20:00:00Z', documents: [] });
  assert.equal(card.direction, 'neutral');
  assert.equal(card.horizon, 'days');
  assert.deepEqual(card.instruments, ['native-equity']);
  assert.equal(card.transmissionChain[0].confidence, 1);
  assert.ok(card.evidence[0].quote.length <= 600, 'an unbounded model string was accepted verbatim');
});

test('a closed-window card with no gap history degrades gracefully instead of printing null%', async () => {
  const hub = await initHub();
  const rules = new RuleExtractor({ hub });
  // 2025-09-13 is a Saturday: cash closed, rToken still trading, and the corpus
  // carries both an SPY macro doc and an ASTR guidance withdrawal in the window.
  const asOf = new Date('2025-09-13T15:00:00Z');
  const cards = rules.fromSessionContext(asOf);
  assert.ok(cards.length >= 2, 'expected closed-window cards on a weekend with off-RTH docs');

  for (const card of cards) {
    assert.equal(card.channel, 'closed-window');
    const blob = JSON.stringify(card);
    assert.ok(!/null%|undefined%|NaN%/.test(blob),
      'an unusable placeholder leaked into a card: ' + blob.slice(0, 240));
  }

  // ASTR is a fictional issuer with no bundled price series, so it must take the
  // no-prior branch and say so in plain language rather than inventing a number.
  const noPrior = cards.find((c) => c.tickers.includes('ASTR'));
  assert.ok(noPrior, 'expected an ASTR closed-window card in this window');
  assert.equal(rules.measureGapBehaviour('ASTR', asOf).n, 0);
  assert.match(noPrior.claim, /no empirical prior/i);
  assert.match(noPrior.evidence.find((e) => e.id === 'E3').quote, /no empirical prior/i);
  assert.ok(noPrior.risks.some((r) => /unanchored/i.test(r)),
    'the risk list should flag that the dislocation size has no anchor');

  // SPY does have history, so it must still quote real measured numbers.
  const withPrior = cards.find((c) => c.tickers.includes('SPY'));
  assert.ok(withPrior, 'expected an SPY closed-window card in this window');
  assert.match(withPrior.claim, /Across \d+ comparable historical gaps/);
  assert.match(withPrior.evidence.find((e) => e.id === 'E3').quote, /continued \d+(\.\d+)?%/);
});