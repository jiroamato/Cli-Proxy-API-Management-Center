import { describe, expect, test } from 'bun:test';
import type { UsageGroup, UsageMetrics } from '../src/services/api/usageStats';
import {
  axisCeil,
  buildAccountRows,
  buildBreakdownRows,
  buildSeries,
  bucketKeyToTime,
  cacheHitRate,
  emptyMetrics,
  errorRate,
  foldAccountModels,
  formatDurationMs,
  formatMultiple,
  formatUsd,
  formatUsdTick,
  listBucketKeys,
  recordedWindowDays,
  resolveRange,
  subscriptionValue,
  sumMetrics,
  topModelsByCost,
  withAccountPlan,
} from '../src/features/usage/logic';

const group = (dimensions: Record<string, string>, metrics: Partial<UsageMetrics>): UsageGroup => ({
  ...emptyMetrics(),
  ...metrics,
  dimensions,
});

describe('resolveRange', () => {
  const now = new Date(2026, 10, 12, 15, 30);

  test('today starts at local midnight and buckets by hour', () => {
    const range = resolveRange('today', now);
    expect(new Date(range.from)).toEqual(new Date(2026, 10, 12));
    expect(range.to).toBe(now.getTime());
    expect(range.bucket).toBe('hour');
  });

  test('N-day ranges cover N calendar days including today', () => {
    const range = resolveRange('7d', now);
    expect(new Date(range.from)).toEqual(new Date(2026, 10, 6));
    expect(range.bucket).toBe('day');
    expect(listBucketKeys(range)).toHaveLength(7);
  });

  test('month starts on the first of the current month', () => {
    expect(new Date(resolveRange('month', now).from)).toEqual(new Date(2026, 10, 1));
  });
});

describe('listBucketKeys', () => {
  test('lists every day, so days without traffic still get a slot', () => {
    const keys = listBucketKeys(resolveRange('7d', new Date(2026, 10, 12, 9)));
    expect(keys[0]).toBe('2026-11-06');
    expect(keys.at(-1)).toBe('2026-11-12');
  });

  test('lists hours up to the current one for today', () => {
    const keys = listBucketKeys(resolveRange('today', new Date(2026, 10, 12, 2, 59)));
    expect(keys).toEqual(['2026-11-12T00:00', '2026-11-12T01:00', '2026-11-12T02:00']);
  });

  test('round-trips keys back to local bucket starts', () => {
    expect(bucketKeyToTime('2026-11-12')).toBe(new Date(2026, 10, 12).getTime());
    expect(bucketKeyToTime('2026-11-12T07:00')).toBe(new Date(2026, 10, 12, 7).getTime());
    expect(bucketKeyToTime('nonsense')).toBeNull();
  });
});

describe('series and totals', () => {
  const groups = [
    group({ day: '2026-11-11', model: 'opus' }, { requests: 2, totalTokens: 100, costUsd: 3 }),
    group({ day: '2026-11-11', model: 'haiku' }, { requests: 1, totalTokens: 10, costUsd: 0.5 }),
    group({ day: '2026-11-12', model: 'opus' }, { requests: 4, totalTokens: 200, costUsd: 6 }),
    group({ day: '2026-10-01', model: 'opus' }, { requests: 9, totalTokens: 999, costUsd: 99 }),
  ];
  const keys = ['2026-11-10', '2026-11-11', '2026-11-12'];

  test('folds models into one point per bucket and keeps empty buckets', () => {
    const series = buildSeries(groups, 'day', keys);
    expect(series.map((point) => point.metrics.totalTokens)).toEqual([0, 110, 200]);
    expect(series[1].costByModel).toEqual({ opus: 3, haiku: 0.5 });
  });

  test('ranks models by cost and drops free ones', () => {
    const free = group({ day: '2026-11-12', model: 'free' }, { totalTokens: 5 });
    expect(topModelsByCost([...groups, free], 2)).toEqual(['opus', 'haiku']);
  });

  test('sums every metric', () => {
    const total = sumMetrics(groups.slice(0, 3));
    expect(total.requests).toBe(7);
    expect(total.costUsd).toBe(9.5);
  });

  test('cache hit rate is cache reads over all input, and null without input', () => {
    const metrics = {
      ...emptyMetrics(),
      inputTokens: 10,
      cacheReadTokens: 80,
      cacheWriteTokens: 10,
    };
    expect(cacheHitRate(metrics)).toBe(80);
    expect(cacheHitRate({ ...emptyMetrics(), outputTokens: 5 })).toBeNull();
  });

  test('error rate is null without requests', () => {
    expect(errorRate({ ...emptyMetrics(), requests: 200, failed: 3 })).toBe(1.5);
    expect(errorRate(emptyMetrics())).toBeNull();
  });
});

describe('recordedWindowDays', () => {
  const range = {
    from: new Date(2026, 10, 1).getTime(),
    to: new Date(2026, 10, 11).getTime(),
    bucket: 'day' as const,
  };
  const point = (key: string, requests: number) => ({
    key,
    metrics: { ...emptyMetrics(), requests },
    costByModel: {},
  });

  test('starts at the first bucket with data when recording began mid-range', () => {
    const series = [point('2026-11-01', 0), point('2026-11-09', 5), point('2026-11-10', 5)];
    expect(recordedWindowDays(range, series)).toBe(2);
  });

  test('covers the whole range when data exists from its start', () => {
    expect(recordedWindowDays(range, [point('2026-11-01', 1)])).toBe(10);
  });

  test('never drops below one day', () => {
    const today = { from: range.to - 3 * 60 * 60 * 1000, to: range.to, bucket: 'hour' as const };
    expect(recordedWindowDays(today, [])).toBe(1);
  });
});

describe('subscription value', () => {
  const groups = [
    group({ provider: 'claude', account: 'a@x.com' }, { costUsd: 400, totalTokens: 10 }),
    group({ provider: 'codex', account: 'a@x.com' }, { costUsd: 900, totalTokens: 20 }),
    group({ provider: 'claude', account: 'b@x.com' }, { costUsd: 50, totalTokens: 5 }),
  ];
  const plans = [{ provider: 'claude', account: 'a@x.com', monthlyUsd: 200 }];
  const windowDays = 365.25 / 12; // exactly one average month

  test('joins plans by provider and account, most valuable first', () => {
    const rows = buildAccountRows(groups, plans, windowDays);
    expect(rows.map((row) => row.provider)).toEqual(['codex', 'claude', 'claude']);
    const claudeA = rows[1];
    expect(claudeA.planMonthlyUsd).toBe(200);
    expect(claudeA.planWindowUsd).toBeCloseTo(200);
    expect(claudeA.multiple).toBeCloseTo(2);
    // The same email on another provider is a different subscription.
    expect(rows[0].planMonthlyUsd).toBeNull();
    expect(rows[0].multiple).toBeNull();
  });

  test('prorates the plan price to the window', () => {
    const [, claudeA] = buildAccountRows(groups, plans, windowDays / 2);
    expect(claudeA.planWindowUsd).toBeCloseTo(100);
    expect(claudeA.multiple).toBeCloseTo(4);
  });

  test('totals only the accounts that have a plan', () => {
    const value = subscriptionValue(buildAccountRows(groups, plans, windowDays));
    expect(value?.costUsd).toBe(400);
    expect(value?.multiple).toBeCloseTo(2);
    expect(subscriptionValue(buildAccountRows(groups, [], windowDays))).toBeNull();
  });

  test('withAccountPlan replaces, adds, and removes plans', () => {
    const replaced = withAccountPlan(plans, 'claude', 'a@x.com', 100);
    expect(replaced).toEqual([{ provider: 'claude', account: 'a@x.com', monthlyUsd: 100 }]);
    expect(withAccountPlan(plans, 'codex', 'a@x.com', 20)).toHaveLength(2);
    expect(withAccountPlan(plans, 'claude', 'a@x.com', 0)).toEqual([]);
  });
});

describe('models per account', () => {
  const account = { provider: 'claude', account: 'a@x.com' };
  const groups = [
    group({ ...account, model: 'fable' }, { costUsd: 5000, totalTokens: 100, requests: 10 }),
    group({ ...account, model: 'opus' }, { costUsd: 10_000, totalTokens: 900, requests: 40 }),
    group({ provider: 'codex', account: 'a@x.com', model: 'gpt' }, { costUsd: 1, totalTokens: 9 }),
  ];

  test('folds model groups into one row per account with its totals', () => {
    const rows = buildAccountRows(groups, [], 30);
    expect(rows).toHaveLength(2);
    const [claude] = rows;
    expect(claude.metrics.costUsd).toBe(15_000);
    expect(claude.metrics.totalTokens).toBe(1000);
    expect(claude.metrics.requests).toBe(50);
  });

  test('ranks models by their share of the account cost, not of its tokens', () => {
    const [claude] = buildAccountRows(groups, [], 30);
    expect(claude.shareBasis).toBe('cost');
    expect(claude.models.map((row) => row.model)).toEqual(['opus', 'fable']);
    expect(claude.models[0].share).toBeCloseTo(66.667, 2);
    expect(claude.models[1].share).toBeCloseTo(33.333, 2);
    expect(claude.models[0].metrics.costUsd).toBe(10_000);
  });

  test('shares fall back to tokens for an account with no priced usage', () => {
    const unpriced = [
      group({ ...account, model: 'small' }, { totalTokens: 25 }),
      group({ ...account, model: 'large' }, { totalTokens: 75 }),
    ];
    const [row] = buildAccountRows(unpriced, [], 30);
    expect(row.shareBasis).toBe('tokens');
    expect(row.models.map((model) => [model.model, model.share])).toEqual([
      ['large', 75],
      ['small', 25],
    ]);
  });

  test('does not mutate the groups it folds', () => {
    buildAccountRows(groups, [], 30);
    expect(groups[0].costUsd).toBe(5000);
    expect(groups[1].costUsd).toBe(10_000);
  });

  test('foldAccountModels keeps the top models and sums the rest', () => {
    const [claude] = buildAccountRows(groups, [], 30);
    expect(foldAccountModels(claude.models, 6)).toEqual({ rows: claude.models, folded: 0 });

    const folded = foldAccountModels(claude.models, 1);
    expect(folded.folded).toBe(1);
    expect(folded.rows).toHaveLength(2);
    expect(folded.rows[1].metrics.costUsd).toBe(5000);
    expect(folded.rows[1].share).toBeCloseTo(33.333, 2);
  });
});

describe('buildBreakdownRows', () => {
  const groups = [
    group({ project: 'small' }, { totalTokens: 10, requests: 1 }),
    group({ project: 'big' }, { totalTokens: 70, requests: 3 }),
    group({ project: '' }, { totalTokens: 20, requests: 2 }),
  ];

  test('ranks by tokens with shares of the whole when nothing is priced', () => {
    const { rows, basis } = buildBreakdownRows(groups, 'project', 10);
    expect(basis).toBe('tokens');
    expect(rows.map((row) => row.value)).toEqual(['big', '', 'small']);
    expect(rows.map((row) => row.share)).toEqual([70, 20, 10]);
  });

  test('ranks by cost when usage is priced, even against more tokens', () => {
    const priced = [
      group({ model: 'cheap' }, { totalTokens: 900, costUsd: 5000 }),
      group({ model: 'dear' }, { totalTokens: 100, costUsd: 10_000 }),
      group({ model: 'unpriced' }, { totalTokens: 500 }),
    ];
    const { rows, basis } = buildBreakdownRows(priced, 'model', 10);
    expect(basis).toBe('cost');
    expect(rows.map((row) => row.value)).toEqual(['dear', 'cheap', 'unpriced']);
    expect(rows[0].share).toBeCloseTo(66.667, 2);
    expect(rows[2].share).toBe(0);
  });

  test('folds the tail into one remainder row', () => {
    const { rows } = buildBreakdownRows(groups, 'project', 1);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.remainder)).toEqual([false, true]);
    expect(rows[1].folded).toBe(2);
    expect(rows[1].metrics.totalTokens).toBe(30);
    expect(rows[1].share).toBe(30);
  });

  test('lists a single group past the limit by name instead of folding it', () => {
    const { rows } = buildBreakdownRows(groups, 'project', 2);
    expect(rows.map((row) => row.value)).toEqual(['big', '', 'small']);
    expect(rows.every((row) => !row.remainder)).toBe(true);
  });

  test('handles an empty breakdown', () => {
    expect(buildBreakdownRows([], 'project', 5).rows).toEqual([]);
  });
});

describe('formatters', () => {
  test('formatUsd scales precision with magnitude', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(0.0042)).toBe('$0.0042');
    expect(formatUsd(3.176)).toBe('$3.18');
    expect(formatUsd(1204.4)).toBe('$1,204');
    expect(formatUsd(12_400)).toBe('$12.4K');
    expect(formatUsd(2_500_000)).toBe('$2.5M');
    expect(formatUsd(Number.NaN)).toBe('-');
  });

  test('formatUsdTick drops cents from whole dollars only', () => {
    expect(formatUsdTick(40)).toBe('$40');
    expect(formatUsdTick(0)).toBe('$0');
    expect(formatUsdTick(2.5)).toBe('$2.50');
    expect(formatUsdTick(4000)).toBe('$4,000');
  });

  test('axisCeil rounds up to a maximum with four even intervals', () => {
    expect(axisCeil(33.7)).toBe(40);
    expect(axisCeil(46_000_000)).toBe(50_000_000);
    expect(axisCeil(100)).toBe(100);
    expect(axisCeil(0)).toBe(1);
    expect(axisCeil(0.0031)).toBeCloseTo(0.004);
  });

  test('formatMultiple keeps one decimal below ten', () => {
    expect(formatMultiple(0.42)).toBe('×0.4');
    expect(formatMultiple(3.25)).toBe('×3.3');
    expect(formatMultiple(18.4)).toBe('×18');
  });

  test('formatDurationMs picks a readable unit', () => {
    expect(formatDurationMs(840)).toBe('840ms');
    expect(formatDurationMs(4200)).toBe('4.2s');
    expect(formatDurationMs(65_000)).toBe('1m 05s');
    expect(formatDurationMs(0)).toBe('-');
  });
});
