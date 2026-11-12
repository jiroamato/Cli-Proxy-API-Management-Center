import { describe, expect, test } from 'bun:test';
import {
  buildUsageQueryParams,
  isUsageStatsDisabledError,
  normalizeUsageSettings,
  normalizeUsageSpeed,
  normalizeUsageStats,
  serializeUsageSettings,
} from '../src/services/api/usageStats';

describe('normalizeUsageStats', () => {
  test('maps backend fields to camelCase metrics', () => {
    const result = normalizeUsageStats({
      from: 1,
      to: 2,
      truncated: true,
      unpriced_models: ['mystery', 7],
      groups: [
        {
          dimensions: { day: '2026-11-12', model: 'claude-opus-5-5', bogus: 3 },
          requests: 4,
          failed: 1,
          input_tokens: 10,
          cache_read_tokens: 20,
          cache_write_tokens: 30,
          output_tokens: 40,
          reasoning_tokens: 5,
          unclassified_tokens: 1,
          total_tokens: 106,
          web_search_requests: 2,
          cost_usd: 1.25,
          unpriced_tokens: 1,
        },
        'not a group',
      ],
    });

    expect(result).toEqual({
      from: 1,
      to: 2,
      truncated: true,
      unpricedModels: ['mystery'],
      groups: [
        {
          dimensions: { day: '2026-11-12', model: 'claude-opus-5-5' },
          requests: 4,
          failed: 1,
          inputTokens: 10,
          cacheReadTokens: 20,
          cacheWriteTokens: 30,
          outputTokens: 40,
          reasoningTokens: 5,
          unclassifiedTokens: 1,
          totalTokens: 106,
          webSearchRequests: 2,
          costUsd: 1.25,
          unpricedTokens: 1,
        },
      ],
    });
  });

  test('survives a malformed response', () => {
    expect(normalizeUsageStats(null).groups).toEqual([]);
    expect(normalizeUsageStats({ groups: 'nope' }).groups).toEqual([]);
    expect(normalizeUsageSpeed(undefined)).toEqual([]);
  });
});

test('normalizeUsageSpeed maps percentile fields', () => {
  const [speed] = normalizeUsageSpeed({
    groups: [
      {
        value: 'claude-opus-5-5',
        requests: 12,
        latency_p50_ms: 4000,
        latency_p95_ms: 9000,
        ttft_p50_ms: 700,
        ttft_p95_ms: 1500,
        output_tokens_per_second: 61.5,
      },
    ],
  });
  expect(speed).toEqual({
    value: 'claude-opus-5-5',
    requests: 12,
    latencyP50Ms: 4000,
    latencyP95Ms: 9000,
    ttftP50Ms: 700,
    ttftP95Ms: 1500,
    outputTokensPerSecond: 61.5,
  });
});

describe('usage settings', () => {
  const settings = {
    modelPrices: {
      'my-model': { input: 1.5, output: 6, cacheRead: 0.15 },
      'flat-model': { input: 1, output: 2 },
    },
    accountPlans: [{ provider: 'claude', account: 'me@example.com', monthlyUsd: 200 }],
  };

  test('serializes to the backend contract and omits unset optional prices', () => {
    expect(serializeUsageSettings(settings)).toEqual({
      model_prices: {
        'my-model': { input: 1.5, output: 6, cache_read: 0.15 },
        'flat-model': { input: 1, output: 2 },
      },
      account_plans: [{ provider: 'claude', account: 'me@example.com', monthly_usd: 200 }],
    });
  });

  test('round-trips through serialize and normalize', () => {
    expect(normalizeUsageSettings(serializeUsageSettings(settings))).toEqual(settings);
  });

  test('normalizes a missing settings document to empty settings', () => {
    expect(normalizeUsageSettings(undefined)).toEqual({ modelPrices: {}, accountPlans: [] });
  });
});

test('buildUsageQueryParams encodes range, grouping, and filters', () => {
  expect(
    buildUsageQueryParams({
      from: 1000.4,
      to: 2000,
      utcOffsetMinutes: -480,
      groupBy: ['day', 'model'],
      filters: { project: 'CLIProxyAPI' },
      limit: 50,
    })
  ).toEqual({
    from: '1000',
    to: '2000',
    utc_offset_minutes: '-480',
    group_by: 'day,model',
    limit: '50',
    'filter.project': 'CLIProxyAPI',
  });
});

test('isUsageStatsDisabledError matches only the disabled-recording conflict', () => {
  expect(isUsageStatsDisabledError({ status: 409, apiCode: 'usage_statistics_disabled' })).toBe(
    true
  );
  expect(isUsageStatsDisabledError({ status: 409, apiCode: 'other' })).toBe(false);
  expect(isUsageStatsDisabledError({ status: 404, apiCode: 'usage_statistics_disabled' })).toBe(
    false
  );
  expect(isUsageStatsDisabledError(new Error('boom'))).toBe(false);
});
