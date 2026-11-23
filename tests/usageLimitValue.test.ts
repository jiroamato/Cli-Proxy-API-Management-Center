import { describe, expect, test } from 'bun:test';
import {
  normalizeLimitValue,
  type LimitModelSpend,
  type LimitSeries,
  type LimitSpend,
} from '../src/services/api/limitValue';
import { buildLimitValueCards, THIN_EVIDENCE_PERCENT } from '../src/features/usage/limitValue';

const spend = (
  costUsd: number,
  percentUsed: number,
  extra: Partial<LimitSpend> = {}
): LimitSpend => ({
  requests: 0,
  failed: 0,
  turns: 0,
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  unclassifiedTokens: 0,
  totalTokens: 0,
  webSearchRequests: 0,
  costUsd,
  inputCostUsd: 0,
  cacheReadCostUsd: 0,
  cacheWriteCostUsd: 0,
  outputCostUsd: costUsd,
  unpricedTokens: 0,
  intervals: percentUsed,
  percentUsed,
  usdPerPercent: percentUsed > 0 ? costUsd / percentUsed : null,
  outputTokensPerPercent: null,
  ...extra,
});

const model = (name: string, costUsd: number, percentUsed: number): LimitModelSpend => ({
  ...spend(costUsd, percentUsed),
  model: name,
});

const series = (
  account: string,
  window: string,
  totals: LimitSpend,
  models: LimitModelSpend[] = [],
  extra: Partial<LimitSeries> = {}
): LimitSeries => ({
  ...totals,
  provider: 'claude',
  authIndex: account,
  account,
  window,
  modelScope: '',
  models,
  ...extra,
});

describe('buildLimitValueCards', () => {
  test('combines accounts by summing cost and percent, not by averaging their ratios', () => {
    const [card] = buildLimitValueCards(
      [series('a', '7d', spend(100, 10)), series('b', '7d', spend(300, 100))],
      []
    );
    // 400 dollars over 110 points; the mean of $10 and $3 per point would be $6.50.
    expect(card.figures.usdPerPercent).toBeCloseTo(400 / 110, 10);
    expect(card.figures.fullLimitUsd).toBeCloseTo(40_000 / 110, 10);
    expect(card.accounts.map((row) => [row.account, row.usdPerPercent])).toEqual([
      ['b', 3],
      ['a', 10],
    ]);
  });

  test('a window that never rose has no value rather than a zero one', () => {
    const [card] = buildLimitValueCards([series('a', '7d', spend(0, 0))], []);
    expect(card.figures.usdPerPercent).toBeNull();
    expect(card.figures.fullLimitUsd).toBeNull();
    expect(card.monthlyUsd).toBeNull();
    expect(card.figures.outputTokensPerLimit).toBeNull();
  });

  test('values a month of full weekly limits, model-scoped ones included, and no other window', () => {
    const cards = buildLimitValueCards(
      [
        series('a', '7d', spend(500, 100)),
        series('a', '5h', spend(500, 400)),
        series('a', '7d_oi', spend(125, 100), [], { modelScope: 'fable' }),
      ],
      []
    );
    const byWindow = Object.fromEntries(cards.map((card) => [card.window, card]));
    expect(byWindow['7d'].monthlyUsd).toBeCloseTo((500 * 30) / 7, 10);
    expect(byWindow['7d_oi'].monthlyUsd).toBeCloseTo((125 * 30) / 7, 10);
    expect(byWindow['5h'].monthlyUsd).toBeNull();
    expect(byWindow['5h'].figures.fullLimitUsd).toBe(125);
  });

  test('flags evidence under the threshold as thin', () => {
    const [card] = buildLimitValueCards(
      [
        series('a', '7d', spend(100, THIN_EVIDENCE_PERCENT), [
          model('claude-opus-5-5', 95, THIN_EVIDENCE_PERCENT - 1),
        ]),
      ],
      []
    );
    expect(card.figures.thin).toBe(false);
    expect(card.models[0].thin).toBe(true);
  });

  test('sums each model across accounts, most evidence first', () => {
    const [card] = buildLimitValueCards(
      [
        series('a', '7d', spend(400, 90), [
          model('claude-opus-5-5', 250, 50),
          model('claude-fable-5-2', 50, 20),
        ]),
        series('b', '7d', spend(300, 60), [model('claude-opus-5-5', 250, 50)]),
      ],
      []
    );
    expect(card.models.map((row) => [row.model, row.percentUsed, row.usdPerPercent])).toEqual([
      ['claude-opus-5-5', 100, 5],
      ['claude-fable-5-2', 20, 2.5],
    ]);
  });

  test('counts reasoning as output for tokens per full limit', () => {
    const [card] = buildLimitValueCards(
      [series('a', '7d', spend(10, 4, { outputTokens: 300, reasoningTokens: 100 }))],
      []
    );
    expect(card.figures.outputTokensPerLimit).toBe(10_000);
  });

  test('joins plan prices per account and shows a card price only when all agree', () => {
    const plans = [
      { provider: 'claude', account: 'a', monthlyUsd: 200 },
      { provider: 'claude', account: 'b', monthlyUsd: 200 },
      { provider: 'codex', account: 'c', monthlyUsd: 200 },
      { provider: 'codex', account: 'd', monthlyUsd: 20 },
    ];
    const cards = buildLimitValueCards(
      [
        series('a', '7d', spend(100, 20)),
        series('b', '7d', spend(100, 20)),
        series('c', '7d', spend(100, 20), [], { provider: 'codex' }),
        series('d', '7d', spend(100, 20), [], { provider: 'codex' }),
      ],
      plans
    );
    expect(cards.map((card) => [card.provider, card.planMonthlyUsd])).toEqual([
      ['claude', 200],
      ['codex', null],
    ]);
    expect(cards[1].accounts.map((row) => [row.account, row.planMonthlyUsd])).toEqual([
      ['c', 200],
      ['d', 20],
    ]);
  });

  test('leaves the plan out of a model-scoped window, which is only part of the subscription', () => {
    const [card] = buildLimitValueCards(
      [series('a', '7d_oi', spend(125, 100), [], { modelScope: 'fable' })],
      [{ provider: 'claude', account: 'a', monthlyUsd: 200 }]
    );
    expect(card.monthlyUsd).toBeCloseTo((125 * 30) / 7, 10);
    expect(card.planMonthlyUsd).toBeNull();
    expect(card.accounts[0].planMonthlyUsd).toBeNull();
  });

  test('orders Claude before Codex and weekly, 5-hour, then model-scoped windows', () => {
    const cards = buildLimitValueCards(
      [
        series('c', '5h', spend(1, 1), [], { provider: 'codex' }),
        series('a', '7d_oi', spend(1, 1), [], { modelScope: 'fable' }),
        series('a', '5h', spend(1, 1)),
        series('c', '7d', spend(1, 1), [], { provider: 'codex' }),
        series('a', '7d', spend(1, 1)),
      ],
      []
    );
    expect(cards.map((card) => `${card.provider}/${card.window}`)).toEqual([
      'claude/7d',
      'claude/5h',
      'claude/7d_oi',
      'codex/7d',
      'codex/5h',
    ]);
  });
});

describe('normalizeLimitValue', () => {
  test('keeps a null ratio null and maps the backend fields', () => {
    const result = normalizeLimitValue({
      from: 1,
      to: 2,
      unpriced_models: ['mystery', 3],
      series: [
        {
          provider: 'claude',
          auth_index: 'x1',
          account: 'a@example.com',
          window: '7d_oi',
          model_scope: 'fable',
          intervals: 0,
          percent_used: 0,
          cost_usd: 0,
          output_tokens: 5,
          usd_per_percent: null,
          output_tokens_per_percent: null,
          models: [
            { model: 'claude-fable-5-2', percent_used: 2, cost_usd: 2.5, usd_per_percent: 1.25 },
          ],
        },
        'not a series',
      ],
    });
    expect(result.unpricedModels).toEqual(['mystery']);
    expect(result.series).toHaveLength(1);
    expect(result.series[0]).toMatchObject({
      authIndex: 'x1',
      modelScope: 'fable',
      outputTokens: 5,
      usdPerPercent: null,
      outputTokensPerPercent: null,
    });
    expect(result.series[0].models[0]).toMatchObject({
      model: 'claude-fable-5-2',
      percentUsed: 2,
      usdPerPercent: 1.25,
    });
  });
});
