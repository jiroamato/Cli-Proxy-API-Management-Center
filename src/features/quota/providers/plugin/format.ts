import type { PluginQuotaMetric, PluginQuotaState } from '@/types';

/** Plan text a plugin reports, most specific field first; null when none. */
export const getPluginPlanLabel = (quota: PluginQuotaState): string | null =>
  quota.subscription?.tierName || quota.subscription?.plan || quota.subscription?.tierId || null;

export const formatPluginMetric = (metric: PluginQuotaMetric): string => {
  const value =
    metric.format === 'currency' && metric.currency
      ? new Intl.NumberFormat(undefined, { style: 'currency', currency: metric.currency }).format(
          metric.value
        )
      : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(metric.value);
  return metric.unit ? `${value} ${metric.unit}` : value;
};
