/**
 * What one percent of each quota window bought (`/observability/usage/limit-value`).
 *
 * Fields are normalized to camelCase here. A ratio the backend could not
 * compute (no rise in the window) stays null rather than becoming 0.
 */

import { apiClient } from './client';
import { USAGE_STATS_TIMEOUT_MS, normalizeUsageMetrics, type UsageMetrics } from './usageStats';
import { isRecord } from '@/utils/helpers';

export interface LimitSpend extends UsageMetrics {
  /** Intervals between samples in which the window rose. */
  intervals: number;
  /** Percentage points the window rose over those intervals. */
  percentUsed: number;
  usdPerPercent: number | null;
  outputTokensPerPercent: number | null;
}

export interface LimitModelSpend extends LimitSpend {
  model: string;
}

export interface LimitSeries extends LimitSpend {
  provider: string;
  authIndex: string;
  account: string;
  window: string;
  /** The one model family that moves the window, or empty when every model does. */
  modelScope: string;
  /** Models from the intervals each one dominated. */
  models: LimitModelSpend[];
}

export interface LimitValueResult {
  from: number;
  to: number;
  unpricedModels: string[];
  series: LimitSeries[];
}

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const normalizeSpend = (raw: Record<string, unknown>): LimitSpend => ({
  ...normalizeUsageMetrics(raw),
  intervals: finiteNumber(raw.intervals) ?? 0,
  percentUsed: finiteNumber(raw.percent_used) ?? 0,
  usdPerPercent: finiteNumber(raw.usd_per_percent),
  outputTokensPerPercent: finiteNumber(raw.output_tokens_per_percent),
});

const normalizeSeries = (raw: Record<string, unknown>): LimitSeries => ({
  ...normalizeSpend(raw),
  provider: text(raw.provider),
  authIndex: text(raw.auth_index),
  account: text(raw.account),
  window: text(raw.window),
  modelScope: text(raw.model_scope),
  models: (Array.isArray(raw.models) ? raw.models : [])
    .filter(isRecord)
    .map((model) => ({ ...normalizeSpend(model), model: text(model.model) })),
});

export const normalizeLimitValue = (raw: unknown): LimitValueResult => {
  const record = isRecord(raw) ? raw : {};
  const unpriced = Array.isArray(record.unpriced_models) ? record.unpriced_models : [];
  return {
    from: finiteNumber(record.from) ?? 0,
    to: finiteNumber(record.to) ?? 0,
    unpricedModels: unpriced.filter((model): model is string => typeof model === 'string'),
    series: (Array.isArray(record.series) ? record.series : [])
      .filter(isRecord)
      .map(normalizeSeries),
  };
};

export const limitValueApi = {
  get: async (range: { from: number; to: number }): Promise<LimitValueResult> =>
    normalizeLimitValue(
      await apiClient.get('/observability/usage/limit-value', {
        params: { from: String(Math.round(range.from)), to: String(Math.round(range.to)) },
        timeout: USAGE_STATS_TIMEOUT_MS,
      })
    ),
};
