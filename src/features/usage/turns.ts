/**
 * Turns and threads for the usage dashboard. A turn is one finished reply, a
 * thread is one session.
 *
 * Turns add up across groups, sessions do not: one session can span months,
 * models, and days. So the range's thread count comes from the ungrouped
 * total and each month's from its own group, and nothing here adds sessions.
 * Every ratio divides two sums, never averages ratios.
 */

import type { UsageGroup } from '@/services/api/usageStats';
import type { UsageRange } from './logic';

/** The stats the turns panel reads for one range. */
export interface TurnsSource {
  /** The range as one group, or null when it has no requests. */
  total: UsageGroup | null;
  /** The range restricted to main sessions, those without a parent session. */
  main: UsageGroup | null;
  /** Grouped by `month` (`YYYY-MM`). */
  months: readonly UsageGroup[];
  /** Grouped by `month` and `stop_reason`. */
  monthStops: readonly UsageGroup[];
}

/**
 * What can be said about the turns of a span. Turns are counted from stop
 * reasons, which only some providers report and only newer rows store, so a
 * span with requests can still have no countable turns.
 */
export type TurnCount =
  | { kind: 'idle' }
  /** Requests, but none of the successful ones recorded a stop reason. */
  | { kind: 'unrecorded' }
  | {
      kind: 'counted';
      turns: number;
      /** Successful requests that recorded no stop reason, so count no turns. */
      unrecorded: number;
      /** `unrecorded` as a percentage of successful requests. */
      unrecordedShare: number;
    };

export interface MonthTurns {
  /** `YYYY-MM` in the viewer's calendar. */
  key: string;
  /** The part of the month inside the range. */
  from: number;
  to: number;
  partial: boolean;
  count: TurnCount;
  threads: number;
}

export interface TurnFigures {
  count: TurnCount;
  threads: number;
  mainThreads: number;
  subagentThreads: number;
  /** Per-turn ratios use only requests that recorded a stop reason; null with no turns. */
  requestsPerTurn: number | null;
  tokensPerTurn: number | null;
  costPerTurn: number | null;
  /** Null with no threads, or when turns were not recorded. */
  turnsPerThread: number | null;
  costPerThread: number | null;
  /** One row per month from the first with requests; empty when the range spans one month. */
  months: MonthTurns[];
}

const pad = (value: number): string => String(value).padStart(2, '0');

const monthKey = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;

const ratio = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? numerator / denominator : null;

interface StopTally {
  requests: number;
  /** Successful requests with a stop reason. */
  stopped: number;
  /** Successful requests without one. */
  unstopped: number;
  /** Requests, tokens, and cost of every request with a stop reason, failed ones included. */
  stoppedRequests: number;
  stoppedTokens: number;
  stoppedCost: number;
}

function tallyStops(groups: readonly UsageGroup[]): StopTally {
  const tally: StopTally = {
    requests: 0,
    stopped: 0,
    unstopped: 0,
    stoppedRequests: 0,
    stoppedTokens: 0,
    stoppedCost: 0,
  };
  for (const group of groups) {
    const succeeded = group.requests - group.failed;
    tally.requests += group.requests;
    if ((group.dimensions.stop_reason ?? '') === '') {
      tally.unstopped += succeeded;
      continue;
    }
    tally.stopped += succeeded;
    tally.stoppedRequests += group.requests;
    tally.stoppedTokens += group.totalTokens;
    tally.stoppedCost += group.costUsd;
  }
  return tally;
}

function countTurns(turns: number, tally: StopTally): TurnCount {
  if (tally.requests === 0) return { kind: 'idle' };
  if (tally.stopped === 0 && tally.unstopped > 0) return { kind: 'unrecorded' };
  const succeeded = tally.stopped + tally.unstopped;
  return {
    kind: 'counted',
    turns,
    unrecorded: tally.unstopped,
    unrecordedShare: succeeded > 0 ? (tally.unstopped / succeeded) * 100 : 0,
  };
}

type RangeMonth = Pick<MonthTurns, 'key' | 'from' | 'to' | 'partial'>;

/** Months the range touches, oldest first, each clipped to the range. */
export function listRangeMonths(range: UsageRange): RangeMonth[] {
  const months: RangeMonth[] = [];
  const start = new Date(range.from);
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  // Guard against a malformed range producing an unbounded loop.
  for (let i = 0; i < 240 && cursor.getTime() < range.to; i += 1) {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    months.push({
      key: monthKey(cursor),
      from: Math.max(cursor.getTime(), range.from),
      to: Math.min(next.getTime(), range.to),
      partial: range.from > cursor.getTime() || range.to < next.getTime(),
    });
    cursor = next;
  }
  return months;
}

function buildMonths(source: TurnsSource, range: UsageRange): MonthTurns[] {
  const byMonth = new Map(source.months.map((group) => [group.dimensions.month ?? '', group]));
  const rows = listRangeMonths(range).map((month): MonthTurns => {
    const group = byMonth.get(month.key);
    const stops = source.monthStops.filter((entry) => entry.dimensions.month === month.key);
    return {
      ...month,
      count: countTurns(group?.turns ?? 0, tallyStops(stops)),
      threads: group?.sessions ?? 0,
    };
  });
  // Months before recording began say nothing about usage.
  const first = rows.findIndex((row) => row.count.kind !== 'idle');
  const recorded = first === -1 ? [] : rows.slice(first);
  return recorded.length > 1 ? recorded : [];
}

export function buildTurnFigures(source: TurnsSource, range: UsageRange): TurnFigures {
  const total = source.total;
  const tally = tallyStops(source.monthStops);
  const count = countTurns(total?.turns ?? 0, tally);
  const turns = count.kind === 'counted' ? count.turns : 0;
  const threads = total?.sessions ?? 0;
  // The two counts come from separate requests; a session recorded between
  // them must not turn the subagent count negative.
  const mainThreads = Math.min(source.main?.sessions ?? 0, threads);
  return {
    count,
    threads,
    mainThreads,
    subagentThreads: threads - mainThreads,
    requestsPerTurn: ratio(tally.stoppedRequests, turns),
    tokensPerTurn: ratio(tally.stoppedTokens, turns),
    costPerTurn: ratio(tally.stoppedCost, turns),
    turnsPerThread: count.kind === 'counted' ? ratio(turns, threads) : null,
    costPerThread: ratio(total?.costUsd ?? 0, threads),
    months: buildMonths(source, range),
  };
}
