import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import type {
  ClaudeQuotaState,
  CodexQuotaState,
  KimiQuotaState,
  PluginQuotaState,
  XaiQuotaState,
} from '@/types';
import type { AnthropicResetGrant } from '@/services/api/claudeResetGrants';
import {
  buildClaudeResetExtra,
  buildLedgerCredential,
  buildProviderSummary,
  describeLedgerReset,
  maskEmails,
  orderLedgerMetrics,
  type LedgerCredential,
  type LedgerMetric,
} from '@/features/quota/ledger/model';

// Identity translator: labels come back as their keys so assertions stay readable.
const t = ((key: string, params?: Record<string, unknown>) =>
  params && 'index' in params ? `${key}:${String(params.index)}` : key) as unknown as TFunction;

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-11T20:00:00Z');

const metric = (overrides: Partial<LedgerMetric> & { id: string }): LedgerMetric => ({
  label: overrides.id,
  remainingPercent: 100,
  resetAtMs: null,
  resetLabel: null,
  periodHours: 168,
  ...overrides,
});

const credential = (metrics: LedgerMetric[]): LedgerCredential => ({
  plan: null,
  planTier: 'standard',
  renewsAtMs: null,
  metrics,
  extras: [],
  message: null,
});

describe('maskEmails', () => {
  test('keeps provider/hash prefixes and the TLD, hides the account', () => {
    expect(maskEmails('claude-ab12-tom@lab.dev.json')).toBe('claude-ab12-t•••@l•••.dev.json');
    expect(maskEmails('codex-67720ea8-amato.miguel@gmail.com-pro.json')).toBe(
      'codex-67720ea8-a•••@g•••.com-pro.json'
    );
  });

  test('leaves names without an email untouched', () => {
    expect(maskEmails('gemini-project.json')).toBe('gemini-project.json');
  });
});

describe('orderLedgerMetrics', () => {
  test('puts the Claude model-scoped weekly window first, keeps the rest stable', () => {
    const ordered = orderLedgerMetrics('claude', [
      metric({ id: 'five-hour', periodHours: 5 }),
      metric({ id: 'seven-day' }),
      metric({ id: 'seven-day-fable' }),
    ]);
    expect(ordered.map((item) => item.id)).toEqual(['seven-day-fable', 'five-hour', 'seven-day']);
  });

  test('is a no-op for providers without a leading window', () => {
    const input = [metric({ id: 'b' }), metric({ id: 'a' })];
    expect(orderLedgerMetrics('codex', input).map((item) => item.id)).toEqual(['b', 'a']);
  });
});

describe('buildLedgerCredential', () => {
  test('returns null unless the quota loaded successfully', () => {
    expect(buildLedgerCredential('claude', undefined, t)).toBeNull();
    expect(buildLedgerCredential('claude', { status: 'loading' }, t)).toBeNull();
    expect(buildLedgerCredential('claude', { status: 'error', error: 'x' }, t)).toBeNull();
  });

  test('Claude: remaining = 100 - used, plan from planType, fable window leads', () => {
    const quota: ClaudeQuotaState = {
      status: 'success',
      planType: 'plan_max',
      windows: [
        {
          id: 'five-hour',
          label: '',
          labelKey: 'claude_quota.five_hour',
          usedPercent: 7,
          resetLabel: '09-11 23:50',
          resetAtMs: NOW + 3 * 60 * 60 * 1000,
          periodHours: 5,
        },
        {
          id: 'seven-day-fable',
          label: '',
          labelKey: 'claude_quota.seven_day_fable',
          usedPercent: 42,
          resetLabel: '09-12 23:00',
          resetAtMs: NOW + DAY,
          periodHours: 168,
        },
      ],
    };
    const result = buildLedgerCredential('claude', quota, t);
    expect(result?.plan).toBe('claude_quota.plan_max');
    expect(result?.metrics.map((item) => item.id)).toEqual(['seven-day-fable', 'five-hour']);
    expect(result?.metrics[0].remainingPercent).toBe(58);
    expect(result?.metrics[1].remainingPercent).toBe(93);
  });

  test('Codex: manual resets become an extra block with expiry countdown lines', () => {
    const quota: CodexQuotaState = {
      status: 'success',
      planType: 'pro',
      subscriptionActiveUntil: '2026-10-03T17:02:00Z',
      windows: [
        {
          id: 'secondary',
          label: '',
          labelKey: 'codex_quota.secondary_window',
          usedPercent: 83,
          resetLabel: '',
          resetAtMs: NOW + 2 * DAY,
          periodHours: 168,
        },
      ],
      rateLimitResetCreditsAvailableCount: 2,
      rateLimitResetCredits: [
        { id: 'c1', status: 'available', grantedAt: '', expiresAt: '2026-10-03T00:00:00Z' },
      ],
    };
    const result = buildLedgerCredential('codex', quota, t);
    expect(result?.plan).toBe('codex_quota.plan_pro');
    expect(result?.planTier).toBe('elite');
    expect(result?.renewsAtMs).toBe(Date.parse('2026-10-03T17:02:00Z'));
    expect(result?.metrics[0].remainingPercent).toBe(17);
    expect(result?.extras).toHaveLength(1);
    expect(result?.extras[0].value).toBe('2');
    expect(result?.extras[0].lines[0].text).toBe('codex_quota.reset_credit_number:1');
    expect(result?.extras[0].lines[0].atMs).toBe(Date.parse('2026-10-03T00:00:00Z'));
  });

  test('xAI: weekly limit is the only window, monthly credits sit in an extra block', () => {
    const quota: XaiQuotaState = {
      status: 'success',
      billing: {
        mode: 'billing',
        periodType: 'weekly',
        usagePercent: null,
        periodEnd: '2026-09-17T17:29:00Z',
        productUsage: [],
        monthlyLimitCents: 0,
        usedCents: 0,
        includedUsedCents: 0,
        onDemandCapCents: 0,
        onDemandUsedCents: 0,
        onDemandUsedPercent: null,
        usedPercent: null,
        resetAtMs: Date.parse('2026-09-17T17:29:00Z'),
        periodHours: 168,
        billingPeriodEnd: '2026-10-01T00:00:00Z',
      },
    };
    const result = buildLedgerCredential('xai', quota, t);
    expect(result?.metrics.map((item) => item.id)).toEqual(['xai:weekly']);
    expect(result?.metrics[0].remainingPercent).toBeNull();
    expect(result?.extras[0].title).toBe('xai_quota.monthly_credits');
    expect(result?.extras[0].lines[0].text).toContain('xai_quota.pay_as_you_go_disabled');
  });

  test('xAI: product usage is a text breakdown of the shared weekly pool, not extra meters', () => {
    const quota: XaiQuotaState = {
      status: 'success',
      billing: {
        mode: 'billing',
        periodType: 'weekly',
        usagePercent: 16,
        periodEnd: '2026-09-17T17:29:00Z',
        productUsage: [
          { product: 'GrokBuild', usagePercent: 14 },
          { product: 'GrokChat', usagePercent: null },
        ],
        monthlyLimitCents: null,
        usedCents: null,
        includedUsedCents: null,
        onDemandCapCents: 0,
        onDemandUsedCents: 0,
        onDemandUsedPercent: null,
        usedPercent: 16,
        resetAtMs: Date.parse('2026-09-17T17:29:00Z'),
        periodHours: 168,
        billingPeriodEnd: null,
      },
    };
    const result = buildLedgerCredential('xai', quota, t);
    expect(result?.metrics.map((item) => item.id)).toEqual(['xai:weekly']);
    expect(result?.metrics[0].remainingPercent).toBe(84);
    const breakdown = result?.extras.find((extra) => extra.id === 'xai:usage-breakdown');
    expect(breakdown?.title).toBe('xai_quota.usage_breakdown');
    expect(breakdown?.value).toBeNull();
    expect(breakdown?.lines.map((line) => line.text)).toEqual([
      'xai_quota.product_usage: 14%',
      'xai_quota.product_usage: xai_quota.usage_unavailable',
    ]);
  });

  test('plugin: a successful load keeps plan, summary values and bucket windows', () => {
    const quota: PluginQuotaState = {
      status: 'success',
      subscription: { plan: 'pro', tierName: 'Pro Max', tierId: null },
      summary: [{ key: 'balance', label: 'Balance', value: 12.5 }],
      groups: [
        {
          id: 'daily',
          label: 'Daily',
          buckets: [
            {
              id: 'requests',
              label: 'Requests',
              remainingFraction: 0.4,
              resetTime: '2026-09-12T00:00:00Z',
            },
          ],
        },
      ],
    };
    const result = buildLedgerCredential('plugin', quota, t);
    expect(result?.plan).toBe('Pro Max');
    expect(result?.metrics).toHaveLength(1);
    expect(result?.metrics[0].id).toBe('daily:requests');
    expect(result?.metrics[0].remainingPercent).toBe(40);
    expect(result?.metrics[0].resetAtMs).toBe(Date.parse('2026-09-12T00:00:00Z'));
    expect(result?.extras.map((extra) => [extra.title, extra.value])).toEqual([
      ['Balance', '12.5'],
    ]);
  });

  test('Claude reset grants: count plus one expiring line per grant with resets left', () => {
    const grant = (overrides: Partial<AnthropicResetGrant> & { id: string }) =>
      ({
        label: '',
        resetsTotal: 2,
        resetsLeft: 1,
        startsAt: null,
        endsAt: null,
        clears: [],
        paused: false,
        usableNow: true,
        useRequiresLimit: false,
        ...overrides,
      }) as AnthropicResetGrant;
    const extra = buildClaudeResetExtra(
      3,
      [
        grant({ id: 'late', resetsLeft: 2, endsAt: '2026-10-20T00:00:00Z' }),
        grant({ id: 'spent', resetsLeft: 0, endsAt: '2026-09-20T00:00:00Z' }),
        grant({ id: 'soon', label: 'Promo', endsAt: '2026-09-30T00:00:00Z' }),
      ],
      t
    );
    expect(extra?.title).toBe('claude_reset.remaining');
    expect(extra?.value).toBe('3');
    expect(extra?.lines.map((line) => line.id)).toEqual(['soon', 'late']);
    expect(extra?.lines[0].text).toBe('Promo · claude_reset.count');
    expect(extra?.lines[1].text).toBe('claude_reset.grant_number:2 · claude_reset.count');
    expect(extra?.lines[0].atMs).toBe(Date.parse('2026-09-30T00:00:00Z'));
    expect(buildClaudeResetExtra(null, [], t)).toBeNull();
  });

  test('Kimi: remaining is derived from used/limit', () => {
    const quota: KimiQuotaState = {
      status: 'success',
      rows: [{ id: 'weekly', labelKey: 'kimi_quota.weekly_limit', used: 25, limit: 100 }],
    };
    expect(buildLedgerCredential('kimi', quota, t)?.metrics[0].remainingPercent).toBe(75);
  });
});

describe('describeLedgerReset', () => {
  test('countdown leads, instant follows', () => {
    const display = describeLedgerReset({ resetAtMs: NOW + DAY, resetLabel: null }, NOW, 'en');
    expect(display?.relative).toBe('in 1 day');
    expect(display?.absolute).toMatch(/\d{2}/);
  });

  test('falls back to the baked label, then to nothing', () => {
    expect(describeLedgerReset({ resetAtMs: null, resetLabel: 'soon' }, NOW)).toEqual({
      relative: null,
      absolute: 'soon',
    });
    expect(describeLedgerReset({ resetAtMs: null, resetLabel: null }, NOW)).toBeNull();
  });
});

describe('buildProviderSummary', () => {
  test('sums remaining across loaded credentials against count × 100', () => {
    const summary = buildProviderSummary('claude', [
      credential([
        metric({ id: 'seven-day-fable', remainingPercent: 58, resetAtMs: NOW + 2 * DAY }),
        metric({ id: 'five-hour', periodHours: 5 }),
        metric({ id: 'seven-day', remainingPercent: 79 }),
      ]),
      credential([
        metric({ id: 'seven-day-fable', remainingPercent: 100, resetAtMs: NOW + DAY }),
        metric({ id: 'five-hour', periodHours: 5 }),
        metric({ id: 'seven-day', remainingPercent: 100 }),
      ]),
      null,
    ]);
    expect(summary.count).toBe(3);
    expect(summary.loadedCount).toBe(2);
    expect(summary.headline?.id).toBe('seven-day-fable');
    expect(summary.headline?.totalRemaining).toBe(158);
    expect(summary.headline?.capacity).toBe(300);
    expect(summary.headline?.segments).toEqual([58, 100, null]);
    expect(summary.headline?.soonestResetMs).toBe(NOW + DAY);
    // The 5-hour window never reaches the strip; the weekly limit collapses underneath.
    expect(summary.secondary.map((item) => item.id)).toEqual(['seven-day']);
    expect(summary.secondary[0].totalRemaining).toBe(179);
  });

  test('unknown percentages leave the total null rather than counting as zero', () => {
    const summary = buildProviderSummary('xai', [
      credential([metric({ id: 'xai:weekly', remainingPercent: null })]),
    ]);
    expect(summary.headline?.totalRemaining).toBeNull();
    expect(summary.headline?.capacity).toBe(100);
    expect(summary.headline?.segments).toEqual([null]);
  });

  test('nothing loaded yields no headline but keeps the credential count', () => {
    const summary = buildProviderSummary('codex', [null, null]);
    expect(summary.headline).toBeNull();
    expect(summary.count).toBe(2);
  });
});
