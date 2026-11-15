import { describe, expect, test } from 'bun:test';
import type { QuotaSamplePoint, QuotaSampleSeries } from '../src/services/api/quotaSamples';
import {
  buildProviderSummary,
  withRecordedMetrics,
  type LedgerCredential,
} from '../src/features/quota/ledger/model';
import {
  buildPoolView,
  buildQuotaPools,
  ledgerReadings,
  lineValueAt,
  recordedLedgerMetrics,
  sampleWindowForLedgerMetric,
  windowPeriodMs,
  type PoolCredential,
  type QuotaPool,
  type WindowReading,
} from '../src/features/quota/quotaPoolModel';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 14, 12);

const sample = (
  hoursAgo: number,
  used: number,
  resetsInHours: number | null
): QuotaSamplePoint => ({
  tsMs: NOW - hoursAgo * HOUR,
  usedPercent: used,
  resetsAtMs: resetsInHours === null ? null : NOW + resetsInHours * HOUR,
});

const series = (
  authIndex: string,
  window: string,
  points: QuotaSamplePoint[],
  extra: Partial<QuotaSampleSeries> = {}
): QuotaSampleSeries => ({
  provider: 'claude',
  authIndex,
  account: `${authIndex}@example.com`,
  window,
  carryIn: null,
  points,
  thinned: false,
  ...extra,
});

const credential = (
  key: string,
  ledger: Partial<Record<string, WindowReading>> = {}
): PoolCredential => ({ key, label: `account ${key}`, ledger });

const weeklyPool = (credentials: PoolCredential[], all: QuotaSampleSeries[]): QuotaPool => {
  const pool = buildQuotaPools('claude', credentials, all).find((entry) => entry.window === '7d');
  if (!pool) throw new Error('no weekly pool');
  return pool;
};

const view = (pool: QuotaPool, fromHoursAgo = 72) =>
  buildPoolView(pool, NOW - fromHoursAgo * HOUR, NOW);

describe('buildQuotaPools', () => {
  test('offers weekly first, then 5-hour, then model-scoped windows as their own pools', () => {
    const pools = buildQuotaPools(
      'claude',
      [credential('a')],
      [
        series('a', '7d_oi', [sample(1, 30, 50)]),
        series('a', '5h', [sample(1, 10, 2)]),
        series('a', '7d', [sample(1, 20, 50)]),
      ]
    );
    expect(pools.map((pool) => pool.window)).toEqual(['7d', '5h', '7d_oi']);
    const weekly = view(pools[0]);
    const fable = view(pools[2]);
    expect(weekly.remaining).toBe(80);
    expect(fable.remaining).toBe(70);
  });

  test('counts only credentials the page lists, of the pool provider', () => {
    const pools = buildQuotaPools(
      'claude',
      [credential('a'), credential('b')],
      [
        series('a', '7d', [sample(1, 20, 50)]),
        series('deleted', '7d', [sample(1, 90, 50)]),
        series('a', '7d', [sample(1, 70, 50)], { provider: 'codex' }),
      ]
    );
    expect(pools).toHaveLength(1);
    const result = view(pools[0]);
    expect(result.remaining).toBe(80);
    expect(result.capacity).toBe(200);
    expect(result.unknownCount).toBe(1);
  });

  test('reports a thinned window', () => {
    const pool = weeklyPool(
      [credential('a')],
      [series('a', '7d', [sample(2, 10, 50), sample(1, 12, 50)], { thinned: true })]
    );
    expect(pool.thinned).toBe(true);
  });
});

describe('buildPoolView: state now', () => {
  test('a carry-in-only series holds its state across the whole range', () => {
    const pool = weeklyPool(
      [credential('a')],
      [series('a', '7d', [], { carryIn: sample(240, 40, 48) })]
    );
    const result = view(pool);
    expect(result.remaining).toBe(60);
    expect(result.capacity).toBe(100);
    expect(result.recorded).toEqual([
      { atMs: NOW - 72 * HOUR, remaining: 60 },
      { atMs: NOW, remaining: 60 },
    ]);
    expect(result.burnPerHour).toBe(0);
    expect(result.nextReset).toEqual({ atMs: NOW + 48 * HOUR, accountKey: 'a', gainPercent: 40 });
  });

  test('a window whose reset already passed reads as reset, with its next reset unknown', () => {
    const pool = weeklyPool(
      [credential('a')],
      [series('a', '7d', [], { carryIn: sample(100, 95, -2) })]
    );
    const result = view(pool);
    expect(result.accounts[0]).toMatchObject({ usedPercent: 0, resetsAtMs: null });
    expect(result.remaining).toBe(100);
    expect(result.recorded).toEqual([
      { atMs: NOW - 72 * HOUR, remaining: 5 },
      { atMs: NOW - 2 * HOUR, remaining: 5 },
      { atMs: NOW - 2 * HOUR, remaining: 100 },
      { atMs: NOW, remaining: 100 },
    ]);
    expect(result.nextReset).toBeNull();
  });

  test('accounts without any reading add capacity but nothing remaining, and are counted apart', () => {
    const pool = weeklyPool(
      [credential('a'), credential('b'), credential('c')],
      [series('a', '7d', [sample(1, 25, 50)]), series('b', '7d', [sample(1, 50, 60)])]
    );
    const result = view(pool);
    expect(result.remaining).toBe(125);
    expect(result.capacity).toBe(300);
    expect(result.unknownCount).toBe(1);
  });

  test('of two samples sharing a timestamp, the later one in order wins', () => {
    const pool = weeklyPool(
      [credential('a')],
      [series('a', '7d', [sample(1, 50, 50), sample(1, 52, 50)], { thinned: true })]
    );
    expect(view(pool).remaining).toBe(48);
  });

  test('a ledger read newer than every sample sets the state now', () => {
    const ledgerRead = { atMs: NOW - HOUR, usedPercent: 60, resetsAtMs: NOW + 50 * HOUR };
    const pool = weeklyPool(
      [credential('a', { '7d': ledgerRead })],
      [series('a', '7d', [sample(2, 50, 50)])]
    );
    expect(view(pool).remaining).toBe(40);
  });

  test('a sample newer than the ledger read sets the state now', () => {
    const ledgerRead = { atMs: NOW - 3 * HOUR, usedPercent: 40, resetsAtMs: NOW + 50 * HOUR };
    const pool = weeklyPool(
      [credential('a', { '7d': ledgerRead })],
      [series('a', '7d', [sample(2, 50, 50)])]
    );
    expect(view(pool).remaining).toBe(50);
  });

  test('a loaded ledger row becomes readings of the windows it covers', () => {
    const readings = ledgerReadings(
      'claude',
      [
        { id: 'seven-day', remainingPercent: 45, resetAtMs: NOW + 30 * HOUR },
        { id: 'seven-day-fable', remainingPercent: 80, resetAtMs: NOW + 30 * HOUR },
        { id: 'seven-day-cowork', remainingPercent: 10, resetAtMs: null },
      ],
      NOW - HOUR
    );
    expect(readings).toEqual({
      '7d': { atMs: NOW - HOUR, usedPercent: 55, resetsAtMs: NOW + 30 * HOUR },
      '7d_oi': { atMs: NOW - HOUR, usedPercent: 20, resetsAtMs: NOW + 30 * HOUR },
    });
    const pool = weeklyPool([credential('a', readings)], [series('a', '7d', [sample(2, 50, 30)])]);
    expect(view(pool).remaining).toBe(45);
  });

  test('a ledger read alone makes an account known', () => {
    const ledgerRead = { atMs: NOW, usedPercent: 30, resetsAtMs: NOW + 50 * HOUR };
    const pool = weeklyPool(
      [credential('a'), credential('b', { '7d': ledgerRead })],
      [series('a', '7d', [sample(1, 10, 50)])]
    );
    const result = view(pool);
    expect(result.remaining).toBe(160);
    expect(result.unknownCount).toBe(0);
  });
});

describe('buildPoolView: burn', () => {
  test('sums rises over the last three hours and skips the drop of a reset', () => {
    const pool = weeklyPool(
      [credential('a')],
      [
        series('a', '7d', [
          sample(5, 60, 240),
          sample(2, 70, 240),
          sample(1, 5, 408),
          sample(0.5, 8, 408),
        ]),
      ]
    );
    const result = view(pool);
    // 60 -> 70 is +10 and 5 -> 8 is +3; the drop to 5 is a reset. 13 points over 3 hours.
    expect(result.burnPerHour).toBeCloseTo(13 / 3, 10);
    expect(result.remaining).toBe(92);
  });

  test('a rise after an unreported reset counts from zero', () => {
    const pool = weeklyPool(
      [credential('a')],
      [series('a', '7d', [sample(4, 90, -2), sample(1, 6, 165)])]
    );
    const result = view(pool);
    expect(result.burnPerHour).toBeCloseTo(2, 10);
  });

  test('zero burn projects no empty pool and no empty account', () => {
    const pool = weeklyPool(
      [credential('a'), credential('b')],
      [series('a', '7d', [sample(10, 30, 20)]), series('b', '7d', [sample(10, 60, 40)])]
    );
    const result = view(pool);
    expect(result.burnPerHour).toBe(0);
    expect(result.poolEmpty).toEqual({ kind: 'none', untilMs: NOW + 14 * DAY });
    expect(result.firstEmpty).toEqual({ kind: 'none', untilMs: NOW + 14 * DAY });
    expect(result.nextReset).toEqual({ atMs: NOW + 20 * HOUR, accountKey: 'a', gainPercent: 30 });
    // Flat until the first reset gives back 30 points, then flat until the second gives back 60.
    expect(lineValueAt(result.projected, NOW + 10 * HOUR)).toBe(110);
    expect(lineValueAt(result.projected, NOW + 30 * HOUR)).toBe(140);
    expect(lineValueAt(result.projected, NOW + 50 * HOUR)).toBe(200);
  });
});

describe('buildPoolView: projection', () => {
  // a burns 2 points an hour (80 -> 86 over the last three hours) and resets in 100h.
  // b is idle at 40 and resets in 10h.
  const pool = () =>
    weeklyPool(
      [credential('a'), credential('b')],
      [
        series('a', '7d', [sample(3, 80, 100), sample(0, 86, 100)]),
        series('b', '7d', [sample(20, 40, 10)]),
      ]
    );

  test('reads the pool now', () => {
    const result = view(pool());
    expect(result.remaining).toBe(74);
    expect(result.capacity).toBe(200);
    expect(result.burnPerHour).toBeCloseTo(2, 10);
  });

  test('the burning account empties first, after its 14 remaining points at 2 an hour', () => {
    expect(view(pool()).firstEmpty).toEqual({ kind: 'at', atMs: NOW + 7 * HOUR, accountKey: 'a' });
  });

  test('demand moves to b, whose reset in 10h gives back what it used by then', () => {
    const result = view(pool());
    // b serves the 2 points an hour from 7h to 10h: 40 + 6 = 46 used when it resets.
    expect(result.nextReset).toEqual({ atMs: NOW + 10 * HOUR, accountKey: 'b', gainPercent: 46 });
    expect(lineValueAt(result.projected, NOW + 7 * HOUR)).toBeCloseTo(60, 10);
    expect(lineValueAt(result.projected, NOW + 10 * HOUR)).toBe(100);
  });

  test('the pool empties when b has also served its fresh 100 points', () => {
    const result = view(pool());
    // From 10h, b alone serves 2 points an hour: 100 points last 50 hours.
    expect(result.poolEmpty).toEqual({ kind: 'at', atMs: NOW + 60 * HOUR });
    expect(lineValueAt(result.projected, NOW + 80 * HOUR)).toBe(0);
    // a's reset at 100h gives its full window back.
    expect(lineValueAt(result.projected, NOW + 100 * HOUR)).toBe(100);
  });

  test('an account already used up is empty now', () => {
    const result = view(
      weeklyPool(
        [credential('a'), credential('b')],
        [series('a', '7d', [sample(1, 100, 30)]), series('b', '7d', [sample(1, 20, 30)])]
      )
    );
    expect(result.firstEmpty).toEqual({ kind: 'now', accountKey: 'a' });
    expect(result.poolEmpty.kind).toBe('none');
  });

  test('a single account is its own pool', () => {
    const result = view(
      weeklyPool([credential('a')], [series('a', '7d', [sample(3, 40, 50), sample(0, 46, 50)])])
    );
    expect(result.remaining).toBe(54);
    expect(result.capacity).toBe(100);
    expect(result.poolEmpty).toEqual({ kind: 'at', atMs: NOW + 27 * HOUR });
    expect(result.firstEmpty).toEqual({ kind: 'at', atMs: NOW + 27 * HOUR, accountKey: 'a' });
  });
});

describe('summary strip', () => {
  test('sums the same state now as the pool header, also for rows not loaded yet', () => {
    const loaded: LedgerCredential = {
      plan: null,
      planTier: 'standard',
      renewsAtMs: null,
      extras: [],
      message: null,
      metrics: [
        {
          id: 'seven-day',
          label: '7-day limit',
          remainingPercent: 35,
          resetAtMs: NOW + 50 * HOUR,
          resetLabel: null,
          periodHours: 168,
        },
      ],
    };
    const credentials = [
      credential('a', {
        '7d': { atMs: NOW - HOUR, usedPercent: 65, resetsAtMs: NOW + 50 * HOUR },
      }),
      credential('b'),
      credential('c'),
    ];
    const pools = buildQuotaPools('claude', credentials, [
      series('a', '7d', [sample(2, 60, 50)]),
      series('b', '7d', [], { carryIn: sample(100, 90, -5) }),
    ]);
    const ledgerRows: Record<string, LedgerCredential | null> = { a: loaded, b: null, c: null };
    const summary = buildProviderSummary(
      'claude',
      credentials.map((entry) =>
        withRecordedMetrics(
          'claude',
          ledgerRows[entry.key],
          recordedLedgerMetrics(pools, entry.key, NOW, () => '7-day limit')
        )
      )
    );

    const header = view(pools[0]);
    // a reads 35 left from its ledger row, b's window reset since its last sample, c has nothing.
    expect(header.remaining).toBe(135);
    expect(header.capacity).toBe(300);
    expect(summary.headline).toMatchObject({ id: 'seven-day', totalRemaining: 135, capacity: 300 });
    expect(summary.headline?.segments).toEqual([35, 100, null]);
  });
});

describe('window helpers', () => {
  test('derive the period from the window id', () => {
    expect(windowPeriodMs('5h')).toBe(5 * HOUR);
    expect(windowPeriodMs('7d')).toBe(7 * DAY);
    expect(windowPeriodMs('7d_oi')).toBe(7 * DAY);
    expect(windowPeriodMs('30m')).toBe(30 * 60_000);
    expect(windowPeriodMs('primary')).toBe(5 * HOUR);
    expect(windowPeriodMs('secondary')).toBe(7 * DAY);
  });

  test('map ledger columns to the sample window that reads the same limit', () => {
    expect(sampleWindowForLedgerMetric('claude', 'seven-day')).toBe('7d');
    expect(sampleWindowForLedgerMetric('claude', 'seven-day-fable')).toBe('7d_oi');
    expect(sampleWindowForLedgerMetric('codex', 'weekly')).toBe('7d');
    expect(sampleWindowForLedgerMetric('codex', 'code-review-weekly')).toBeNull();
  });
});
