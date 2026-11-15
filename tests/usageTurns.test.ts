import { describe, expect, test } from 'bun:test';
import type { UsageGroup } from '../src/services/api/usageStats';
import { emptyMetrics, sumMetrics, type UsageRange } from '../src/features/usage/logic';
import { buildTurnFigures, listRangeMonths, type TurnsSource } from '../src/features/usage/turns';

const group = (dimensions: Record<string, string>, fields: Partial<UsageGroup>): UsageGroup => ({
  ...emptyMetrics(),
  dimensions,
  sessions: 0,
  ...fields,
});

const stop = (month: string, reason: string, fields: Partial<UsageGroup>): UsageGroup =>
  group({ month, stop_reason: reason }, fields);

const range = (from: Date, to: Date): UsageRange => ({
  from: from.getTime(),
  to: to.getTime(),
  bucket: 'day',
});

const OCT_NOV = range(new Date(2026, 9, 16), new Date(2026, 10, 14, 15, 30));
const NOV_ONLY = range(new Date(2026, 10, 1), new Date(2026, 10, 14, 15, 30));

const source = (fields: Partial<TurnsSource>): TurnsSource => ({
  total: null,
  main: null,
  months: [],
  monthStops: [],
  ...fields,
});

describe('buildTurnFigures', () => {
  test('takes threads from the range total, never from the sum of its months', () => {
    // One session ran across the month boundary, so it is in both months.
    const figures = buildTurnFigures(
      source({
        total: group({}, { requests: 6, turns: 4, sessions: 3 }),
        months: [
          group({ month: '2026-10' }, { requests: 3, turns: 2, sessions: 2 }),
          group({ month: '2026-11' }, { requests: 3, turns: 2, sessions: 2 }),
        ],
        monthStops: [
          stop('2026-10', 'end_turn', { requests: 3, turns: 2 }),
          stop('2026-11', 'end_turn', { requests: 3, turns: 2 }),
        ],
      }),
      OCT_NOV
    );
    expect(figures.threads).toBe(3);
    expect(figures.months.map((month) => month.threads)).toEqual([2, 2]);
    expect(figures.turnsPerThread).toBeCloseTo(4 / 3, 10);
  });

  test('summed metrics never carry a session count', () => {
    const summed = sumMetrics([group({}, { sessions: 2 }), group({}, { sessions: 2 })]);
    expect('sessions' in summed).toBe(false);
  });

  test('per-turn ratios divide sums over requests that recorded a stop reason', () => {
    const figures = buildTurnFigures(
      source({
        total: group({}, { requests: 18, turns: 2, sessions: 1, costUsd: 55 }),
        monthStops: [
          stop('2026-11', 'end_turn', { requests: 2, turns: 2, totalTokens: 400, costUsd: 2 }),
          stop('2026-11', 'tool_use', { requests: 6, totalTokens: 1200, costUsd: 3 }),
          // Gemini or older rows: no stop reason, so no turns and no part in per-turn figures.
          stop('2026-11', '', { requests: 10, totalTokens: 9000, costUsd: 50 }),
        ],
      }),
      NOV_ONLY
    );
    expect(figures.requestsPerTurn).toBe(4);
    expect(figures.tokensPerTurn).toBe(800);
    expect(figures.costPerTurn).toBe(2.5);
    expect(figures.costPerThread).toBe(55);
    expect(figures.count).toEqual({
      kind: 'counted',
      turns: 2,
      unrecorded: 10,
      unrecordedShare: (10 / 18) * 100,
    });
  });

  test('requests without any recorded stop reason leave turns unknown, not zero', () => {
    const figures = buildTurnFigures(
      source({
        total: group({}, { requests: 5, sessions: 2, costUsd: 4 }),
        monthStops: [stop('2026-11', '', { requests: 5 })],
      }),
      NOV_ONLY
    );
    expect(figures.count).toEqual({ kind: 'unrecorded' });
    expect(figures.requestsPerTurn).toBeNull();
    expect(figures.turnsPerThread).toBeNull();
    expect(figures.threads).toBe(2);
    expect(figures.costPerThread).toBe(2);
  });

  test('a recorded range with no finished reply counts zero turns and has no per-turn ratio', () => {
    const figures = buildTurnFigures(
      source({
        total: group({}, { requests: 3, sessions: 1 }),
        monthStops: [stop('2026-11', 'tool_use', { requests: 3, costUsd: 1 })],
      }),
      NOV_ONLY
    );
    expect(figures.count).toEqual({
      kind: 'counted',
      turns: 0,
      unrecorded: 0,
      unrecordedShare: 0,
    });
    expect(figures.requestsPerTurn).toBeNull();
    expect(figures.costPerTurn).toBeNull();
    expect(figures.turnsPerThread).toBe(0);
  });

  test('failed requests without a stop reason do not count as unrecorded replies', () => {
    const figures = buildTurnFigures(
      source({
        total: group({}, { requests: 5, failed: 2, turns: 3, sessions: 1 }),
        monthStops: [
          stop('2026-11', 'end_turn', { requests: 3, turns: 3 }),
          stop('2026-11', '', { requests: 2, failed: 2 }),
        ],
      }),
      NOV_ONLY
    );
    expect(figures.count).toEqual({
      kind: 'counted',
      turns: 3,
      unrecorded: 0,
      unrecordedShare: 0,
    });
    expect(figures.requestsPerTurn).toBe(1);
  });

  test('splits threads into main and subagent sessions', () => {
    const figures = buildTurnFigures(
      source({
        total: group({}, { requests: 9, sessions: 5 }),
        main: group({}, { requests: 6, sessions: 3 }),
      }),
      NOV_ONLY
    );
    expect([figures.mainThreads, figures.subagentThreads]).toEqual([3, 2]);
  });

  test('never reports a negative subagent count', () => {
    const figures = buildTurnFigures(
      source({
        total: group({}, { requests: 4, sessions: 2 }),
        main: group({}, { requests: 5, sessions: 3 }),
      }),
      NOV_ONLY
    );
    expect([figures.mainThreads, figures.subagentThreads]).toEqual([2, 0]);
  });

  test('an empty range has no turns, threads, or ratios', () => {
    const figures = buildTurnFigures(source({}), NOV_ONLY);
    expect(figures.count).toEqual({ kind: 'idle' });
    expect(figures.threads).toBe(0);
    expect(figures.costPerThread).toBeNull();
    expect(figures.months).toEqual([]);
  });
});

describe('months', () => {
  test('lists each month the range touches, clipped and marked partial', () => {
    const months = listRangeMonths(OCT_NOV);
    expect(months.map((month) => [month.key, month.partial])).toEqual([
      ['2026-10', true],
      ['2026-11', true],
    ]);
    expect(months[0].from).toBe(new Date(2026, 9, 16).getTime());
    expect(months[0].to).toBe(new Date(2026, 10, 1).getTime());
    expect(months[1].from).toBe(new Date(2026, 10, 1).getTime());
    expect(months[1].to).toBe(OCT_NOV.to);
  });

  test('a whole calendar month inside the range is not partial', () => {
    const months = listRangeMonths(range(new Date(2026, 8, 20), new Date(2026, 10, 2)));
    expect(months.map((month) => [month.key, month.partial])).toEqual([
      ['2026-09', true],
      ['2026-10', false],
      ['2026-11', true],
    ]);
  });

  test('starts at the first month with requests and keeps a quiet month after it', () => {
    const figures = buildTurnFigures(
      source({
        total: group({}, { requests: 4, turns: 2, sessions: 2 }),
        months: [
          group({ month: '2026-09' }, { requests: 2, turns: 1, sessions: 1 }),
          group({ month: '2026-11' }, { requests: 2, turns: 1, sessions: 1 }),
        ],
        monthStops: [
          stop('2026-09', 'end_turn', { requests: 2, turns: 1 }),
          stop('2026-11', 'end_turn', { requests: 2, turns: 1 }),
        ],
      }),
      range(new Date(2026, 7, 17), new Date(2026, 10, 14))
    );
    expect(figures.months.map((month) => [month.key, month.count.kind])).toEqual([
      ['2026-09', 'counted'],
      ['2026-10', 'idle'],
      ['2026-11', 'counted'],
    ]);
  });

  test('marks a month whose replies recorded no stop reason', () => {
    const figures = buildTurnFigures(
      source({
        total: group({}, { requests: 5, turns: 1, sessions: 2 }),
        months: [
          group({ month: '2026-10' }, { requests: 3, sessions: 1 }),
          group({ month: '2026-11' }, { requests: 2, turns: 1, sessions: 1 }),
        ],
        monthStops: [
          stop('2026-10', '', { requests: 3 }),
          stop('2026-11', 'end_turn', { requests: 2, turns: 1 }),
        ],
      }),
      OCT_NOV
    );
    expect(figures.months.map((month) => month.count.kind)).toEqual(['unrecorded', 'counted']);
  });

  test('a range inside one month lists no months: the totals already are that month', () => {
    const figures = buildTurnFigures(
      source({
        total: group({}, { requests: 2, turns: 1, sessions: 1 }),
        months: [group({ month: '2026-11' }, { requests: 2, turns: 1, sessions: 1 })],
        monthStops: [stop('2026-11', 'end_turn', { requests: 2, turns: 1 })],
      }),
      NOV_ONLY
    );
    expect(figures.months).toEqual([]);
  });
});
