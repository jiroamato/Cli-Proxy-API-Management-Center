/**
 * Persistent usage statistics API (`/observability/usage/*`).
 *
 * The backend returns snake_case aggregates over one row per upstream request;
 * everything is normalized to camelCase here so UI code never sees raw fields.
 */

import { apiClient } from './client';
import { isRecord } from '@/utils/helpers';

const USAGE_STATS_TIMEOUT_MS = 30 * 1000;
const USAGE_DISABLED_API_CODE = 'usage_statistics_disabled';

export interface UsageMetrics {
  requests: number;
  failed: number;
  /** Uncached input. The token buckets are mutually exclusive and sum to totalTokens. */
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Non-reasoning output. */
  outputTokens: number;
  reasoningTokens: number;
  unclassifiedTokens: number;
  totalTokens: number;
  webSearchRequests: number;
  /** API-equivalent cost at list prices. */
  costUsd: number;
  /** Tokens the cost does not cover (unknown model price or unclassified tokens). */
  unpricedTokens: number;
}

export interface UsageGroup extends UsageMetrics {
  dimensions: Record<string, string>;
}

export interface UsageStatsResult {
  from: number;
  to: number;
  groups: UsageGroup[];
  truncated: boolean;
  unpricedModels: string[];
}

export interface UsageSpeed {
  value: string;
  requests: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  ttftP50Ms: number;
  ttftP95Ms: number;
  outputTokensPerSecond: number;
}

/** USD per one million tokens. Optional buckets fall back to a broader price. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite5m?: number;
  cacheWrite1h?: number;
}

export interface AccountPlan {
  provider: string;
  account: string;
  monthlyUsd: number;
}

export interface UsageSettings {
  modelPrices: Record<string, ModelPrice>;
  accountPlans: AccountPlan[];
}

export interface UsageSettingsResult {
  settings: UsageSettings;
  defaultPrices: Record<string, ModelPrice>;
}

export interface UsageStatsQuery {
  from: number;
  to: number;
  utcOffsetMinutes: number;
  groupBy: readonly string[];
  filters?: Record<string, string>;
  limit?: number;
}

const toNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const toOptionalNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const toStringRecord = (value: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!isRecord(value)) return out;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') out[key] = entry;
  }
  return out;
};

const normalizeGroup = (raw: unknown): UsageGroup | null => {
  if (!isRecord(raw)) return null;
  return {
    dimensions: toStringRecord(raw.dimensions),
    requests: toNumber(raw.requests),
    failed: toNumber(raw.failed),
    inputTokens: toNumber(raw.input_tokens),
    cacheReadTokens: toNumber(raw.cache_read_tokens),
    cacheWriteTokens: toNumber(raw.cache_write_tokens),
    outputTokens: toNumber(raw.output_tokens),
    reasoningTokens: toNumber(raw.reasoning_tokens),
    unclassifiedTokens: toNumber(raw.unclassified_tokens),
    totalTokens: toNumber(raw.total_tokens),
    webSearchRequests: toNumber(raw.web_search_requests),
    costUsd: toNumber(raw.cost_usd),
    unpricedTokens: toNumber(raw.unpriced_tokens),
  };
};

export const normalizeUsageStats = (raw: unknown): UsageStatsResult => {
  const record = isRecord(raw) ? raw : {};
  const groups = Array.isArray(record.groups) ? record.groups : [];
  const unpriced = Array.isArray(record.unpriced_models) ? record.unpriced_models : [];
  return {
    from: toNumber(record.from),
    to: toNumber(record.to),
    groups: groups.map(normalizeGroup).filter((group): group is UsageGroup => group !== null),
    truncated: record.truncated === true,
    unpricedModels: unpriced.filter((model): model is string => typeof model === 'string'),
  };
};

export const normalizeUsageSpeed = (raw: unknown): UsageSpeed[] => {
  const groups = isRecord(raw) && Array.isArray(raw.groups) ? raw.groups : [];
  return groups.filter(isRecord).map((group) => ({
    value: typeof group.value === 'string' ? group.value : '',
    requests: toNumber(group.requests),
    latencyP50Ms: toNumber(group.latency_p50_ms),
    latencyP95Ms: toNumber(group.latency_p95_ms),
    ttftP50Ms: toNumber(group.ttft_p50_ms),
    ttftP95Ms: toNumber(group.ttft_p95_ms),
    outputTokensPerSecond: toNumber(group.output_tokens_per_second),
  }));
};

const normalizePrice = (raw: unknown): ModelPrice | null => {
  if (!isRecord(raw)) return null;
  const price: ModelPrice = { input: toNumber(raw.input), output: toNumber(raw.output) };
  const cacheRead = toOptionalNumber(raw.cache_read);
  const cacheWrite5m = toOptionalNumber(raw.cache_write_5m);
  const cacheWrite1h = toOptionalNumber(raw.cache_write_1h);
  if (cacheRead !== undefined) price.cacheRead = cacheRead;
  if (cacheWrite5m !== undefined) price.cacheWrite5m = cacheWrite5m;
  if (cacheWrite1h !== undefined) price.cacheWrite1h = cacheWrite1h;
  return price;
};

const normalizePrices = (raw: unknown): Record<string, ModelPrice> => {
  const out: Record<string, ModelPrice> = {};
  if (!isRecord(raw)) return out;
  for (const [model, value] of Object.entries(raw)) {
    const price = normalizePrice(value);
    if (price) out[model] = price;
  }
  return out;
};

export const normalizeUsageSettings = (raw: unknown): UsageSettings => {
  const record = isRecord(raw) ? raw : {};
  const plans = Array.isArray(record.account_plans) ? record.account_plans : [];
  return {
    modelPrices: normalizePrices(record.model_prices),
    accountPlans: plans.filter(isRecord).map((plan) => ({
      provider: typeof plan.provider === 'string' ? plan.provider : '',
      account: typeof plan.account === 'string' ? plan.account : '',
      monthlyUsd: toNumber(plan.monthly_usd),
    })),
  };
};

const serializePrice = (price: ModelPrice): Record<string, number> => {
  const out: Record<string, number> = { input: price.input, output: price.output };
  if (price.cacheRead !== undefined) out.cache_read = price.cacheRead;
  if (price.cacheWrite5m !== undefined) out.cache_write_5m = price.cacheWrite5m;
  if (price.cacheWrite1h !== undefined) out.cache_write_1h = price.cacheWrite1h;
  return out;
};

export const serializeUsageSettings = (settings: UsageSettings): Record<string, unknown> => ({
  model_prices: Object.fromEntries(
    Object.entries(settings.modelPrices).map(([model, price]) => [model, serializePrice(price)])
  ),
  account_plans: settings.accountPlans.map((plan) => ({
    provider: plan.provider,
    account: plan.account,
    monthly_usd: plan.monthlyUsd,
  })),
});

export const buildUsageQueryParams = (query: UsageStatsQuery): Record<string, string> => {
  const params: Record<string, string> = {
    from: String(Math.round(query.from)),
    to: String(Math.round(query.to)),
    utc_offset_minutes: String(Math.round(query.utcOffsetMinutes)),
    group_by: query.groupBy.join(','),
  };
  if (query.limit !== undefined) params.limit = String(query.limit);
  for (const [name, value] of Object.entries(query.filters ?? {})) {
    params[`filter.${name}`] = value;
  }
  return params;
};

/** The backend answers 409 with this code while usage recording is switched off. */
export const isUsageStatsDisabledError = (error: unknown): boolean =>
  isRecord(error) && error.status === 409 && error.apiCode === USAGE_DISABLED_API_CODE;

export const usageStatsApi = {
  getStats: async (query: UsageStatsQuery): Promise<UsageStatsResult> =>
    normalizeUsageStats(
      await apiClient.get('/observability/usage/stats', {
        params: buildUsageQueryParams(query),
        timeout: USAGE_STATS_TIMEOUT_MS,
      })
    ),

  getSpeed: async (query: UsageStatsQuery): Promise<UsageSpeed[]> =>
    normalizeUsageSpeed(
      await apiClient.get('/observability/usage/speed', {
        params: buildUsageQueryParams(query),
        timeout: USAGE_STATS_TIMEOUT_MS,
      })
    ),

  getSettings: async (): Promise<UsageSettingsResult> => {
    const raw = await apiClient.get('/observability/usage/settings', {
      timeout: USAGE_STATS_TIMEOUT_MS,
    });
    const record = isRecord(raw) ? raw : {};
    return {
      settings: normalizeUsageSettings(record.settings),
      defaultPrices: normalizePrices(record.default_prices),
    };
  },

  saveSettings: async (settings: UsageSettings): Promise<UsageSettings> => {
    const raw = await apiClient.put(
      '/observability/usage/settings',
      serializeUsageSettings(settings),
      { timeout: USAGE_STATS_TIMEOUT_MS }
    );
    return normalizeUsageSettings(isRecord(raw) ? raw.settings : undefined);
  },

  /** Turns on usage recording (the `usage-statistics-enabled` config flag). */
  enableRecording: () =>
    apiClient.put('/config/observability/usage/usage-statistics-enabled', true),
};
