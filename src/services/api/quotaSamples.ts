/**
 * Quota window history (`/observability/usage/quota-samples`).
 *
 * The backend stores one sample each time a subscription window's state
 * changes. Fields are normalized to camelCase here, and an unknown reset
 * (`resets_at_ms: 0`) becomes null.
 */

import { apiClient } from './client';
import { USAGE_STATS_TIMEOUT_MS } from './usageStats';
import { isRecord } from '@/utils/helpers';

export interface QuotaSamplePoint {
  tsMs: number;
  /** Used share of the window, 0 to 100. */
  usedPercent: number;
  resetsAtMs: number | null;
}

export interface QuotaSampleSeries {
  provider: string;
  authIndex: string;
  account: string;
  /** Window id such as `5h`, `7d` or the model-scoped `7d_oi`. */
  window: string;
  /** Newest sample before the range: the state the window held when the range began. */
  carryIn: QuotaSamplePoint | null;
  /** Samples in the range, oldest first. */
  points: QuotaSamplePoint[];
  /** True when the server kept only the highest and last sample of each bucket. */
  thinned: boolean;
}

export interface QuotaSampleHistory {
  from: number;
  to: number;
  series: QuotaSampleSeries[];
}

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const normalizePoint = (raw: unknown): QuotaSamplePoint | null => {
  if (!isRecord(raw)) return null;
  const tsMs = finiteNumber(raw.ts_ms);
  const usedPercent = finiteNumber(raw.used_percent);
  if (tsMs === null || usedPercent === null) return null;
  const resetsAtMs = finiteNumber(raw.resets_at_ms);
  return { tsMs, usedPercent, resetsAtMs: resetsAtMs && resetsAtMs > 0 ? resetsAtMs : null };
};

const normalizeSeries = (raw: unknown): QuotaSampleSeries | null => {
  if (!isRecord(raw)) return null;
  const points = Array.isArray(raw.points) ? raw.points : [];
  return {
    provider: text(raw.provider),
    authIndex: text(raw.auth_index),
    account: text(raw.account),
    window: text(raw.window),
    carryIn: normalizePoint(raw.carry_in),
    points: points.map(normalizePoint).filter((point): point is QuotaSamplePoint => point !== null),
    thinned: raw.thinned === true,
  };
};

export const normalizeQuotaSampleHistory = (raw: unknown): QuotaSampleHistory => {
  const record = isRecord(raw) ? raw : {};
  const series = Array.isArray(record.series) ? record.series : [];
  return {
    from: finiteNumber(record.from) ?? 0,
    to: finiteNumber(record.to) ?? 0,
    series: series
      .map(normalizeSeries)
      .filter((entry): entry is QuotaSampleSeries => entry !== null),
  };
};

export const quotaSamplesApi = {
  list: async (range: { from: number; to: number }): Promise<QuotaSampleHistory> =>
    normalizeQuotaSampleHistory(
      await apiClient.get('/observability/usage/quota-samples', {
        params: { from: String(Math.round(range.from)), to: String(Math.round(range.to)) },
        timeout: USAGE_STATS_TIMEOUT_MS,
      })
    ),
};
