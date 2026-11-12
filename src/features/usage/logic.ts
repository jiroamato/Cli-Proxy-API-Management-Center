/**
 * Pure data shaping for the usage dashboard: time ranges, series, totals,
 * subscription value, and breakdown rows. No React, no I/O.
 */

import type { AccountPlan, UsageGroup, UsageMetrics } from '@/services/api/usageStats';

export const USAGE_RANGE_IDS = ['today', '7d', '30d', 'month', '90d'] as const;
export type UsageRangeId = (typeof USAGE_RANGE_IDS)[number];

export type UsageBucket = 'hour' | 'day';

export interface UsageRange {
  from: number;
  to: number;
  bucket: UsageBucket;
}

export const BREAKDOWN_DIMENSIONS = [
  'project',
  'model',
  'client_key',
  'user_agent',
  'reasoning_effort',
  'service_tier',
  'session_id',
] as const;
export type BreakdownDimension = (typeof BREAKDOWN_DIMENSIONS)[number];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Average month length, for prorating a monthly plan price over a window. */
const DAYS_PER_MONTH = 365.25 / 12;

const RANGE_DAYS: Partial<Record<UsageRangeId, number>> = { '7d': 7, '30d': 30, '90d': 90 };

/** Placeholder for a value that does not exist. */
export const EMPTY_VALUE = '-';

const pad = (value: number): string => String(value).padStart(2, '0');

const startOfLocalDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

/**
 * Resolves a range to timestamps. Ranges start on a local midnight so day
 * buckets are whole calendar days, and end at `now`.
 */
export function resolveRange(id: UsageRangeId, now: Date): UsageRange {
  const today = startOfLocalDay(now);
  const to = now.getTime();
  if (id === 'today') return { from: today.getTime(), to, bucket: 'hour' };
  if (id === 'month') {
    return { from: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), to, bucket: 'day' };
  }
  const days = RANGE_DAYS[id] ?? 30;
  // Date arithmetic rather than subtracting milliseconds, so DST shifts keep midnight.
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));
  return { from: from.getTime(), to, bucket: 'day' };
}

/** Minutes east of UTC, the sign convention the backend expects. */
export const utcOffsetMinutes = (date: Date): number => -date.getTimezoneOffset();

const bucketKey = (date: Date, bucket: UsageBucket): string => {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return bucket === 'day' ? day : `${day}T${pad(date.getHours())}:00`;
};

/** Every bucket key in the range, in order, so empty buckets still get a slot. */
export function listBucketKeys(range: UsageRange): string[] {
  const keys: string[] = [];
  const cursor = new Date(range.from);
  if (range.bucket === 'day') cursor.setHours(0, 0, 0, 0);
  else cursor.setMinutes(0, 0, 0);
  // Guard against a malformed range producing an unbounded loop.
  for (let i = 0; i < 2000 && cursor.getTime() <= range.to; i += 1) {
    keys.push(bucketKey(cursor, range.bucket));
    if (range.bucket === 'day') cursor.setDate(cursor.getDate() + 1);
    else cursor.setHours(cursor.getHours() + 1);
  }
  return keys;
}

/** Local timestamp at the start of a bucket key, or null when malformed. */
export function bucketKeyToTime(key: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):00)?$/.exec(key);
  if (!match) return null;
  const [, year, month, day, hour] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour ?? 0)).getTime();
}

export const emptyMetrics = (): UsageMetrics => ({
  requests: 0,
  failed: 0,
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  unclassifiedTokens: 0,
  totalTokens: 0,
  webSearchRequests: 0,
  costUsd: 0,
  unpricedTokens: 0,
});

const METRIC_KEYS = Object.keys(emptyMetrics()) as (keyof UsageMetrics)[];

export function addMetrics(target: UsageMetrics, source: UsageMetrics): UsageMetrics {
  for (const key of METRIC_KEYS) target[key] += source[key];
  return target;
}

export const sumMetrics = (groups: readonly UsageMetrics[]): UsageMetrics =>
  groups.reduce<UsageMetrics>((total, group) => addMetrics(total, group), emptyMetrics());

/** Share of input served from cache, as a percentage; null with no input. */
export function cacheHitRate(metrics: UsageMetrics): number | null {
  const input = metrics.inputTokens + metrics.cacheReadTokens + metrics.cacheWriteTokens;
  return input > 0 ? (metrics.cacheReadTokens / input) * 100 : null;
}

/** Failed requests as a percentage; null with no requests. */
export const errorRate = (metrics: UsageMetrics): number | null =>
  metrics.requests > 0 ? (metrics.failed / metrics.requests) * 100 : null;

export interface SeriesPoint {
  key: string;
  metrics: UsageMetrics;
  costByModel: Record<string, number>;
}

/**
 * Folds (bucket, model) groups into one point per bucket key. Groups whose
 * bucket is outside `keys` are dropped rather than appended out of order.
 */
export function buildSeries(
  groups: readonly UsageGroup[],
  bucket: UsageBucket,
  keys: readonly string[]
): SeriesPoint[] {
  const points = new Map<string, SeriesPoint>(
    keys.map((key) => [key, { key, metrics: emptyMetrics(), costByModel: {} }])
  );
  for (const group of groups) {
    const point = points.get(group.dimensions[bucket] ?? '');
    if (!point) continue;
    addMetrics(point.metrics, group);
    const model = group.dimensions.model ?? '';
    point.costByModel[model] = (point.costByModel[model] ?? 0) + group.costUsd;
  }
  return keys.map((key) => points.get(key) as SeriesPoint);
}

/** The `limit` models with the highest cost, most expensive first. */
export function topModelsByCost(groups: readonly UsageGroup[], limit: number): string[] {
  const totals = new Map<string, number>();
  for (const group of groups) {
    const model = group.dimensions.model ?? '';
    totals.set(model, (totals.get(model) ?? 0) + group.costUsd);
  }
  return [...totals.entries()]
    .filter(([, cost]) => cost > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([model]) => model);
}

/**
 * Days the window covers for prorating plan prices. It starts at the first
 * bucket that has data when recording began after the range start, so a new
 * install is not compared against months it never recorded. At least one day.
 */
export function recordedWindowDays(range: UsageRange, series: readonly SeriesPoint[]): number {
  const first = series.find((point) => point.metrics.requests > 0);
  const firstTime = first ? bucketKeyToTime(first.key) : null;
  const start = Math.max(range.from, firstTime ?? range.from);
  return Math.max(1, (range.to - start) / DAY_MS);
}

/** What a share is a fraction of: cost when anything is priced, otherwise tokens. */
export type ShareBasis = 'cost' | 'tokens';

/** Cost is the basis whenever any of it is known; unpriced usage falls back to tokens. */
export const shareBasisOf = (total: UsageMetrics): ShareBasis =>
  total.costUsd > 0 ? 'cost' : 'tokens';

const basisValue = (metrics: UsageMetrics, basis: ShareBasis): number =>
  basis === 'cost' ? metrics.costUsd : metrics.totalTokens;

/** Largest first by the basis, then by tokens and requests so ties stay stable. */
const byBasisDesc =
  (basis: ShareBasis) =>
  (a: UsageMetrics, b: UsageMetrics): number =>
    basisValue(b, basis) - basisValue(a, basis) ||
    b.totalTokens - a.totalTokens ||
    b.requests - a.requests;

export interface AccountModelRow {
  model: string;
  metrics: UsageMetrics;
  /** Share of the account's usage on its basis, 0..100. */
  share: number;
}

export interface AccountRow {
  provider: string;
  account: string;
  metrics: UsageMetrics;
  /** The models this account served, largest share first. */
  models: AccountModelRow[];
  /** What the model shares are fractions of. */
  shareBasis: ShareBasis;
  planMonthlyUsd: number | null;
  /** The plan price prorated to the window. */
  planWindowUsd: number | null;
  /** API-equivalent cost divided by the prorated plan price. */
  multiple: number | null;
}

export const accountPlanKey = (provider: string, account: string): string =>
  `${provider}\u0000${account}`;

/**
 * Folds (provider, account, model) groups into one row per account, most
 * valuable first, joined with its plan and broken down by model.
 */
export function buildAccountRows(
  groups: readonly UsageGroup[],
  plans: readonly AccountPlan[],
  windowDays: number
): AccountRow[] {
  const planByKey = new Map(
    plans.map((plan) => [accountPlanKey(plan.provider, plan.account), plan.monthlyUsd])
  );
  const byAccount = new Map<
    string,
    { provider: string; account: string; models: Map<string, UsageMetrics> }
  >();
  for (const group of groups) {
    const provider = group.dimensions.provider ?? '';
    const account = group.dimensions.account ?? '';
    const key = accountPlanKey(provider, account);
    const entry = byAccount.get(key) ?? { provider, account, models: new Map() };
    byAccount.set(key, entry);
    const model = group.dimensions.model ?? '';
    entry.models.set(model, addMetrics(entry.models.get(model) ?? emptyMetrics(), group));
  }

  const rows = [...byAccount.entries()].map(([key, entry]): AccountRow => {
    const metrics = sumMetrics([...entry.models.values()]);
    const shareBasis = shareBasisOf(metrics);
    const total = basisValue(metrics, shareBasis);
    const models = [...entry.models.entries()]
      .map(([model, modelMetrics]): AccountModelRow => ({
        model,
        metrics: modelMetrics,
        share: total > 0 ? (basisValue(modelMetrics, shareBasis) / total) * 100 : 0,
      }))
      .sort(
        (a, b) => byBasisDesc(shareBasis)(a.metrics, b.metrics) || a.model.localeCompare(b.model)
      );
    const monthly = planByKey.get(key);
    const planMonthlyUsd = monthly !== undefined && monthly > 0 ? monthly : null;
    const planWindowUsd =
      planMonthlyUsd === null ? null : (planMonthlyUsd * windowDays) / DAYS_PER_MONTH;
    return {
      provider: entry.provider,
      account: entry.account,
      metrics,
      models,
      shareBasis,
      planMonthlyUsd,
      planWindowUsd,
      multiple: planWindowUsd ? metrics.costUsd / planWindowUsd : null,
    };
  });
  return rows.sort(
    (a, b) =>
      b.metrics.costUsd - a.metrics.costUsd ||
      b.metrics.totalTokens - a.metrics.totalTokens ||
      accountPlanKey(a.provider, a.account).localeCompare(accountPlanKey(b.provider, b.account))
  );
}

/**
 * Keeps the first `limit` model rows and folds the rest into one remainder,
 * so an account with many models stays readable. `folded` is how many models
 * the remainder stands for (0 when nothing was folded).
 */
export function foldAccountModels(
  models: readonly AccountModelRow[],
  limit: number
): { rows: AccountModelRow[]; folded: number } {
  if (models.length <= limit) return { rows: [...models], folded: 0 };
  const rest = models.slice(limit);
  return {
    rows: [
      ...models.slice(0, limit),
      {
        model: '',
        metrics: sumMetrics(rest.map((row) => row.metrics)),
        share: rest.reduce((sum, row) => sum + row.share, 0),
      },
    ],
    folded: rest.length,
  };
}

export interface SubscriptionValue {
  costUsd: number;
  planWindowUsd: number;
  multiple: number;
}

/** Combined value over the accounts that have a plan price; null when none do. */
export function subscriptionValue(rows: readonly AccountRow[]): SubscriptionValue | null {
  let costUsd = 0;
  let planWindowUsd = 0;
  for (const row of rows) {
    if (row.planWindowUsd === null) continue;
    costUsd += row.metrics.costUsd;
    planWindowUsd += row.planWindowUsd;
  }
  return planWindowUsd > 0 ? { costUsd, planWindowUsd, multiple: costUsd / planWindowUsd } : null;
}

/** Replaces or removes (when `monthlyUsd` is not positive) one account's plan. */
export function withAccountPlan(
  plans: readonly AccountPlan[],
  provider: string,
  account: string,
  monthlyUsd: number
): AccountPlan[] {
  const key = accountPlanKey(provider, account);
  const others = plans.filter((plan) => accountPlanKey(plan.provider, plan.account) !== key);
  return monthlyUsd > 0 ? [...others, { provider, account, monthlyUsd }] : others;
}

export interface BreakdownRow {
  /** Dimension value; empty when the request carried none. */
  value: string;
  metrics: UsageMetrics;
  /** Share of the whole breakdown on its basis, 0..100. */
  share: number;
  /** Number of groups folded into this row (1 unless it is the remainder). */
  folded: number;
  /** True for the trailing row that sums the groups past the limit. */
  remainder: boolean;
}

export interface Breakdown {
  rows: BreakdownRow[];
  /** What the shares are fractions of. */
  basis: ShareBasis;
}

/**
 * Ranks groups by their share of API-equivalent cost (or of tokens when
 * nothing is priced) and folds the groups past `limit` into one trailing
 * remainder row, so the list stays short without hiding volume.
 */
export function buildBreakdownRows(
  groups: readonly UsageGroup[],
  dimension: string,
  limit: number
): Breakdown {
  const totals = sumMetrics(groups);
  const basis = shareBasisOf(totals);
  const total = basisValue(totals, basis);
  const share = (metrics: UsageMetrics): number =>
    total > 0 ? (basisValue(metrics, basis) / total) * 100 : 0;
  const sorted = [...groups].sort(
    (a, b) =>
      byBasisDesc(basis)(a, b) ||
      (a.dimensions[dimension] ?? '').localeCompare(b.dimensions[dimension] ?? '')
  );
  // A single group past the limit is listed by name: a remainder row would
  // take the same space and hide which group it is.
  const shown = sorted.length === limit + 1 ? sorted.length : limit;
  const rows: BreakdownRow[] = sorted.slice(0, shown).map((group) => ({
    value: group.dimensions[dimension] ?? '',
    metrics: group,
    share: share(group),
    folded: 1,
    remainder: false,
  }));
  const rest = sorted.slice(shown);
  if (rest.length > 0) {
    const metrics = sumMetrics(rest);
    rows.push({
      value: '',
      metrics,
      share: share(metrics),
      folded: rest.length,
      remainder: true,
    });
  }
  return { rows, basis };
}

const AXIS_STEPS = [1, 2, 2.5, 4, 5, 8, 10] as const;

/**
 * Rounds a peak up to a readable axis maximum that divides into four even
 * intervals. Works for fractional peaks (small costs) as well as large counts.
 */
export function axisCeil(peak: number): number {
  if (!Number.isFinite(peak) || peak <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  const normalized = peak / magnitude;
  const step = AXIS_STEPS.find((candidate) => normalized <= candidate) ?? 10;
  return step * magnitude;
}

/** USD for axis ticks: whole dollars lose their cents ($40, not $40.00). */
export function formatUsdTick(value: number): string {
  return Number.isInteger(value) && Math.abs(value) < 1000 ? `$${value}` : formatUsd(value);
}

/** USD with precision that suits its size: $0.0042, $3.18, $1,204, $12.4K. */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return EMPTY_VALUE;
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs === 0) return '$0';
  if (abs < 0.01) return `${sign}$${abs.toFixed(4)}`;
  if (abs < 1000) return `${sign}$${abs.toFixed(2)}`;
  if (abs < 10_000) return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
  if (abs < 1_000_000) return `${sign}$${Number((abs / 1000).toFixed(1))}K`;
  return `${sign}$${Number((abs / 1_000_000).toFixed(2))}M`;
}

/** Value multiple: ×0.4, ×3.2, ×18. */
export function formatMultiple(value: number): string {
  if (!Number.isFinite(value)) return EMPTY_VALUE;
  return `×${value >= 10 ? Math.round(value) : Number(value.toFixed(1))}`;
}

/** Milliseconds as a short duration: 840ms, 4.2s, 1m 05s. */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return EMPTY_VALUE;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${Number(seconds.toFixed(1))}s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}m ${pad(whole % 60)}s`;
}

/** Axis and tooltip label for a bucket key in the viewer's locale. */
export function formatBucketLabel(key: string, bucket: UsageBucket, locale?: string): string {
  const time = bucketKeyToTime(key);
  if (time === null) return key;
  const options: Intl.DateTimeFormatOptions =
    bucket === 'day' ? { month: 'short', day: 'numeric' } : { hour: 'numeric' };
  return new Intl.DateTimeFormat(locale, options).format(new Date(time));
}
