/**
 * Quota pool: one window's remaining capacity summed across a provider's
 * accounts, its recorded history, and a projection forward. `now` is always
 * passed in.
 *
 * A pool reads each account as a list of readings: the recorded quota
 * samples, plus the ledger's read when the credential's quota is loaded. The
 * newest reading is the account's state now, so the pool header and the
 * ledger row agree whenever the ledger read is the freshest observation.
 */

import type { QuotaSamplePoint, QuotaSampleSeries } from '@/services/api/quotaSamples';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/utils/time/durations';
import type { LedgerMetric } from './ledger/model';

export const POOL_PROVIDERS = ['claude', 'codex'] as const;
export type PoolProvider = (typeof POOL_PROVIDERS)[number];

export const isPoolProvider = (type: string): type is PoolProvider =>
  (POOL_PROVIDERS as readonly string[]).includes(type);

/** How far back the burn rate looks. */
export const BURN_LOOKBACK_MS = 3 * HOUR_MS;

/** One observation of how full an account's window was. */
export interface WindowReading {
  atMs: number;
  /** Used share of the window, 0 to 100. */
  usedPercent: number;
  resetsAtMs: number | null;
}

/** A credential the Quota page lists, with what its ledger row read. */
export interface PoolCredential {
  /** Auth index, the key quota samples are recorded under. */
  key: string;
  label: string;
  /** Ledger reads by sample window id; empty until the credential's quota loads. */
  ledger: Partial<Record<string, WindowReading>>;
}

export interface PoolAccount {
  key: string;
  label: string;
  /** Samples and the ledger read, in any order. Empty when nothing is known. */
  readings: WindowReading[];
}

export interface QuotaPool {
  provider: PoolProvider;
  window: string;
  periodMs: number;
  accounts: PoolAccount[];
  /** True when the server simplified any series for this window. */
  thinned: boolean;
}

/** One provider's pools; only providers the page lists credentials for get one. */
export interface QuotaPoolGroup {
  provider: PoolProvider;
  accountCount: number;
  pools: QuotaPool[];
}

interface WindowSpec {
  ledgerMetricId: string;
  labelKey: string;
}

/**
 * Sample window ids per provider, in the order the window control offers them,
 * with the ledger column that reads the same limit.
 */
const WINDOW_SPECS: Record<PoolProvider, Record<string, WindowSpec>> = {
  claude: {
    '7d': { ledgerMetricId: 'seven-day', labelKey: 'claude_quota.seven_day' },
    '5h': { ledgerMetricId: 'five-hour', labelKey: 'claude_quota.five_hour' },
    '7d_oi': { ledgerMetricId: 'seven-day-fable', labelKey: 'claude_quota.seven_day_fable' },
    '7d_opus': { ledgerMetricId: 'seven-day-opus', labelKey: 'claude_quota.seven_day_opus' },
    '7d_sonnet': { ledgerMetricId: 'seven-day-sonnet', labelKey: 'claude_quota.seven_day_sonnet' },
  },
  codex: {
    '7d': { ledgerMetricId: 'weekly', labelKey: 'codex_quota.secondary_window' },
    '5h': { ledgerMetricId: 'five-hour', labelKey: 'codex_quota.primary_window' },
  },
};

const UNIT_MS: Record<string, number> = { d: DAY_MS, h: HOUR_MS, m: MINUTE_MS };

/** Codex names a window `primary` or `secondary` when it reports no length. */
const UNSIZED_WINDOW_MS: Record<string, number> = { primary: 5 * HOUR_MS, secondary: 7 * DAY_MS };

export function windowPeriodMs(window: string): number {
  const match = /^([1-9]\d*)([dhm])/.exec(window);
  if (match) return Number(match[1]) * UNIT_MS[match[2]];
  return UNSIZED_WINDOW_MS[window] ?? 7 * DAY_MS;
}

export const windowLabelKey = (provider: PoolProvider, window: string): string | null =>
  WINDOW_SPECS[provider][window]?.labelKey ?? null;

/** The sample window a ledger metric reads, or null when no window matches it. */
export function sampleWindowForLedgerMetric(
  provider: PoolProvider,
  metricId: string
): string | null {
  const entry = Object.entries(WINDOW_SPECS[provider]).find(
    ([, spec]) => spec.ledgerMetricId === metricId
  );
  return entry ? entry[0] : null;
}

/** A loaded ledger row as readings of the sample windows it covers. */
export function ledgerReadings(
  provider: PoolProvider,
  metrics: readonly Pick<LedgerMetric, 'id' | 'remainingPercent' | 'resetAtMs'>[],
  fetchedAtMs: number | undefined
): Partial<Record<string, WindowReading>> {
  const readings: Partial<Record<string, WindowReading>> = {};
  if (fetchedAtMs === undefined) return readings;
  for (const metric of metrics) {
    const window = sampleWindowForLedgerMetric(provider, metric.id);
    if (window === null || metric.remainingPercent === null) continue;
    readings[window] = {
      atMs: fetchedAtMs,
      usedPercent: 100 - metric.remainingPercent,
      resetsAtMs: metric.resetAtMs,
    };
  }
  return readings;
}

const windowRank = (provider: PoolProvider, window: string): number => {
  const index = Object.keys(WINDOW_SPECS[provider]).indexOf(window);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

const toReading = (point: QuotaSamplePoint): WindowReading => ({
  atMs: point.tsMs,
  usedPercent: point.usedPercent,
  resetsAtMs: point.resetsAtMs,
});

/**
 * One pool per window the provider's credentials have samples for. Series of
 * credentials the page does not list (deleted or disabled ones) are left out,
 * so the pool counts the same accounts as the ledger.
 */
export function buildQuotaPools(
  provider: PoolProvider,
  credentials: readonly PoolCredential[],
  series: readonly QuotaSampleSeries[]
): QuotaPool[] {
  const keys = new Set(credentials.map((credential) => credential.key));
  const relevant = series.filter(
    (entry) => entry.provider === provider && keys.has(entry.authIndex)
  );
  const windows = [...new Set(relevant.map((entry) => entry.window))].sort(
    (a, b) => windowRank(provider, a) - windowRank(provider, b) || a.localeCompare(b)
  );
  return windows.map((window) => {
    const inWindow = relevant.filter((entry) => entry.window === window);
    return {
      provider,
      window,
      periodMs: windowPeriodMs(window),
      thinned: inWindow.some((entry) => entry.thinned),
      accounts: credentials.map((credential) => {
        const samples = inWindow
          .filter((entry) => entry.authIndex === credential.key)
          .flatMap((entry) => (entry.carryIn ? [entry.carryIn, ...entry.points] : entry.points))
          .map(toReading);
        const ledger = credential.ledger[window];
        return {
          key: credential.key,
          label: credential.label,
          readings: ledger ? [...samples, ledger] : samples,
        };
      }),
    };
  });
}

/* ---------- One account over time ---------- */

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));

/**
 * Readings in time order with the resets they imply made explicit: once a
 * reading's reset time passes before the next reading (or before now), the
 * window was empty from that instant even though nothing reported it.
 * Readings stamped after `nowMs` count as read now.
 */
function accountTimeline(readings: readonly WindowReading[], nowMs: number): WindowReading[] {
  const sorted = readings
    .map((reading) => ({
      atMs: Math.min(reading.atMs, nowMs),
      usedPercent: clampPercent(reading.usedPercent),
      resetsAtMs: reading.resetsAtMs,
    }))
    .sort((a, b) => a.atMs - b.atMs);
  const timeline: WindowReading[] = [];
  sorted.forEach((reading, index) => {
    timeline.push(reading);
    const until = sorted[index + 1]?.atMs ?? nowMs;
    if (reading.resetsAtMs !== null && reading.resetsAtMs <= until) {
      timeline.push({
        atMs: Math.max(reading.atMs, reading.resetsAtMs),
        usedPercent: 0,
        resetsAtMs: null,
      });
    }
  });
  return timeline;
}

/**
 * Used percent at `atMs`. Before the first reading the account is read as it
 * was first seen, so an account that joins mid-range does not draw a jump.
 */
function usedAt(timeline: readonly WindowReading[], atMs: number): number {
  let used = timeline[0].usedPercent;
  for (const reading of timeline) {
    if (reading.atMs > atMs) break;
    used = reading.usedPercent;
  }
  return used;
}

/** Sum of every rise in used percent after `sinceMs`; drops are resets and count as zero. */
function risesSince(timeline: readonly WindowReading[], sinceMs: number): number {
  let previous = usedAt(timeline, sinceMs);
  let total = 0;
  for (const reading of timeline) {
    if (reading.atMs <= sinceMs) continue;
    if (reading.usedPercent > previous) total += reading.usedPercent - previous;
    previous = reading.usedPercent;
  }
  return total;
}

/**
 * A credential's state now in every window the pools track, shaped as the
 * ledger columns that read the same limits. The summary strip uses these so
 * it sums the same "now" as the pool header, also for rows not loaded yet.
 */
export function recordedLedgerMetrics(
  pools: readonly QuotaPool[],
  key: string,
  nowMs: number,
  labelFor: (pool: QuotaPool) => string
): LedgerMetric[] {
  return pools.flatMap((pool) => {
    const ledgerMetricId = WINDOW_SPECS[pool.provider][pool.window]?.ledgerMetricId;
    const readings = pool.accounts.find((account) => account.key === key)?.readings ?? [];
    if (!ledgerMetricId || readings.length === 0) return [];
    const timeline = accountTimeline(readings, nowMs);
    const last = timeline[timeline.length - 1];
    return [
      {
        id: ledgerMetricId,
        label: labelFor(pool),
        remainingPercent: 100 - last.usedPercent,
        resetAtMs: last.resetsAtMs,
        resetLabel: null,
        periodHours: pool.periodMs / HOUR_MS,
      },
    ];
  });
}

/* ---------- Pool view ---------- */

export interface PoolPoint {
  atMs: number;
  /** Remaining percent summed across known accounts. */
  remaining: number;
}

export interface AccountState {
  key: string;
  label: string;
  usedPercent: number;
  /** Null when the window already reset and nothing has reported the next one. */
  resetsAtMs: number | null;
  /** Percent of this account's window used per hour over the burn lookback. */
  burnPerHour: number;
}

export interface ProjectedReset {
  atMs: number;
  accountKey: string;
  /** Percent the reset gives back: what the account is projected to have used by then. */
  gainPercent: number;
}

export type PoolEmptyForecast =
  { kind: 'now' } | { kind: 'at'; atMs: number } | { kind: 'none'; untilMs: number };

export type AccountEmptyForecast =
  | { kind: 'now'; accountKey: string }
  | { kind: 'at'; atMs: number; accountKey: string }
  | { kind: 'none'; untilMs: number };

export interface PoolView {
  /** Accounts with at least one reading. */
  accounts: AccountState[];
  /** Accounts the page lists that have no reading for this window. */
  unknownCount: number;
  remaining: number;
  /** Accounts × 100, as the summary strip counts it; an account without readings adds none of it to `remaining`. */
  capacity: number;
  burnPerHour: number;
  /** Step line of the remaining pool from `fromMs` to now. */
  recorded: PoolPoint[];
  /** From now to the forecast horizon; equal times mark a reset's step up. */
  projected: PoolPoint[];
  nextReset: ProjectedReset | null;
  poolEmpty: PoolEmptyForecast;
  firstEmpty: AccountEmptyForecast;
}

const remainingOf = (used: readonly number[]): number =>
  used.reduce((sum, value) => sum + (100 - value), 0);

/**
 * Remaining pool from `fromMs` to `nowMs` as a step line: each account holds
 * its last reading until the next one, and the pool is their sum.
 */
function recordedLine(
  timelines: readonly WindowReading[][],
  fromMs: number,
  nowMs: number
): PoolPoint[] {
  const used = timelines.map((timeline) => usedAt(timeline, fromMs));
  const changes = timelines
    .flatMap((timeline, account) =>
      timeline
        .filter((reading) => reading.atMs > fromMs && reading.atMs <= nowMs)
        .map((reading) => ({ account, reading }))
    )
    .sort((a, b) => a.reading.atMs - b.reading.atMs);

  const points: PoolPoint[] = [{ atMs: fromMs, remaining: remainingOf(used) }];
  let index = 0;
  while (index < changes.length) {
    const atMs = changes[index].reading.atMs;
    const before = remainingOf(used);
    while (index < changes.length && changes[index].reading.atMs === atMs) {
      used[changes[index].account] = changes[index].reading.usedPercent;
      index += 1;
    }
    const after = remainingOf(used);
    if (after !== before) points.push({ atMs, remaining: before }, { atMs, remaining: after });
  }
  if (points[points.length - 1].atMs < nowMs) {
    points.push({ atMs: nowMs, remaining: remainingOf(used) });
  }
  return points;
}

interface SimAccount {
  key: string;
  used: number;
  resetsAtMs: number | null;
  /** Share of the pool's demand this account carried over the burn lookback. */
  share: number;
}

interface Projection {
  points: PoolPoint[];
  resets: ProjectedReset[];
  poolEmptyAtMs: number | null;
  firstEmpty: { atMs: number; accountKey: string } | null;
}

/**
 * Projects the pool forward, assuming the recent demand continues. Demand is
 * split across accounts by their recent shares; when an account runs out, the
 * proxy moves its share to the accounts still serving (all equally when none
 * of them carried any). A reset empties an account's window and the next one
 * follows a period later.
 */
function project(
  accounts: readonly SimAccount[],
  burnPerHour: number,
  periodMs: number,
  nowMs: number,
  untilMs: number
): Projection {
  const state = accounts.map((account) => ({ ...account }));
  const burnPerMs = burnPerHour / HOUR_MS;
  const remaining = () => remainingOf(state.map((account) => account.used));
  const points: PoolPoint[] = [{ atMs: nowMs, remaining: remaining() }];
  const resets: ProjectedReset[] = [];
  let poolEmptyAtMs: number | null = null;
  let firstEmpty: Projection['firstEmpty'] = null;

  const noteEmpty = (atMs: number) => {
    const empty = state.find((account) => account.used >= 100);
    if (empty && firstEmpty === null) firstEmpty = { atMs, accountKey: empty.key };
    if (state.every((account) => account.used >= 100) && poolEmptyAtMs === null) {
      poolEmptyAtMs = atMs;
    }
  };
  noteEmpty(nowMs);

  let atMs = nowMs;
  for (let step = 0; step < 10_000 && atMs < untilMs; step += 1) {
    const serving = state.filter((account) => account.used < 100);
    const servingShare = serving.reduce((sum, account) => sum + account.share, 0);
    const rateOf = (account: SimAccount): number =>
      account.used >= 100 || burnPerMs === 0
        ? 0
        : servingShare > 0
          ? (burnPerMs * account.share) / servingShare
          : burnPerMs / serving.length;

    const exhaustAt = (account: SimAccount): number => {
      const rate = rateOf(account);
      return rate > 0 ? atMs + (100 - account.used) / rate : Infinity;
    };
    const nextReset = Math.min(...state.map((account) => account.resetsAtMs ?? Infinity), untilMs);
    const nextExhaust = Math.min(...serving.map(exhaustAt));
    const nextAtMs = Math.min(nextReset, nextExhaust);

    const exhausting = new Set(serving.filter((account) => exhaustAt(account) <= nextAtMs));
    state.forEach((account) => {
      account.used = exhausting.has(account)
        ? 100
        : Math.min(100, account.used + rateOf(account) * (nextAtMs - atMs));
    });
    atMs = nextAtMs;
    points.push({ atMs, remaining: remaining() });
    if (exhausting.size > 0) noteEmpty(atMs);

    const resetting = state.filter((account) => account.resetsAtMs === atMs);
    if (resetting.length > 0) {
      resetting.forEach((account) => {
        resets.push({ atMs, accountKey: account.key, gainPercent: account.used });
        account.used = 0;
        account.resetsAtMs = atMs + periodMs;
      });
      points.push({ atMs, remaining: remaining() });
    }
  }
  return { points, resets, poolEmptyAtMs, firstEmpty };
}

/**
 * Everything the pool panel shows for one window: the state now, the recorded
 * line since `fromMs`, and a projection two window periods ahead.
 */
export function buildPoolView(pool: QuotaPool, fromMs: number, nowMs: number): PoolView {
  const known = pool.accounts
    .filter((account) => account.readings.length > 0)
    .map((account) => ({ account, timeline: accountTimeline(account.readings, nowMs) }));
  const lookbackHours = BURN_LOOKBACK_MS / HOUR_MS;

  const accounts: AccountState[] = known.map(({ account, timeline }) => {
    const last = timeline[timeline.length - 1];
    return {
      key: account.key,
      label: account.label,
      usedPercent: last.usedPercent,
      resetsAtMs: last.resetsAtMs,
      burnPerHour: risesSince(timeline, nowMs - BURN_LOOKBACK_MS) / lookbackHours,
    };
  });
  const burnPerHour = accounts.reduce((sum, account) => sum + account.burnPerHour, 0);
  const untilMs = nowMs + 2 * pool.periodMs;
  const projection = project(
    accounts.map((account) => ({
      key: account.key,
      used: account.usedPercent,
      resetsAtMs: account.resetsAtMs,
      share: burnPerHour > 0 ? account.burnPerHour / burnPerHour : 0,
    })),
    burnPerHour,
    pool.periodMs,
    nowMs,
    untilMs
  );

  const poolEmpty: PoolEmptyForecast =
    projection.poolEmptyAtMs === null
      ? { kind: 'none', untilMs }
      : projection.poolEmptyAtMs === nowMs
        ? { kind: 'now' }
        : { kind: 'at', atMs: projection.poolEmptyAtMs };
  const first = projection.firstEmpty;
  const firstEmpty: AccountEmptyForecast =
    first === null
      ? { kind: 'none', untilMs }
      : first.atMs === nowMs
        ? { kind: 'now', accountKey: first.accountKey }
        : { kind: 'at', atMs: first.atMs, accountKey: first.accountKey };

  return {
    accounts,
    unknownCount: pool.accounts.length - known.length,
    remaining: remainingOf(accounts.map((account) => account.usedPercent)),
    capacity: pool.accounts.length * 100,
    burnPerHour,
    recorded:
      known.length > 0
        ? recordedLine(
            known.map(({ timeline }) => timeline),
            fromMs,
            nowMs
          )
        : [],
    projected: known.length > 0 ? projection.points : [],
    nextReset: projection.resets[0] ?? null,
    poolEmpty,
    firstEmpty,
  };
}

/** Value of a line at `atMs`, interpolating linearly; the later side of a step wins. */
export function lineValueAt(points: readonly PoolPoint[], atMs: number): number | null {
  if (points.length === 0 || atMs < points[0].atMs || atMs > points[points.length - 1].atMs) {
    return null;
  }
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (point.atMs > atMs) continue;
    const next = points[index + 1];
    if (!next || point.atMs === atMs || next.atMs === point.atMs) return point.remaining;
    const ratio = (atMs - point.atMs) / (next.atMs - point.atMs);
    return point.remaining + (next.remaining - point.remaining) * ratio;
  }
  return null;
}
