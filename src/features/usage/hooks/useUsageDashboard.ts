import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isUsageStatsDisabledError,
  usageStatsApi,
  type ModelPrice,
  type UsageGroup,
  type UsageSettings,
  type UsageSpeed,
  type UsageStatsQuery,
} from '@/services/api/usageStats';
import {
  resolveRange,
  utcOffsetMinutes,
  type BreakdownDimension,
  type UsageRange,
  type UsageRangeId,
} from '../logic';

/** Enough groups for any breakdown tab; the UI folds the tail itself. */
const BREAKDOWN_GROUP_LIMIT = 200;

export type UsageDashboardStatus = 'loading' | 'ready' | 'disabled' | 'error';

export interface UsageDashboardData {
  range: UsageRange;
  /** Groups by (time bucket, model). */
  seriesGroups: UsageGroup[];
  /** Groups by (provider, account, model). */
  accountGroups: UsageGroup[];
  /** Groups by status code. */
  statusGroups: UsageGroup[];
  speed: UsageSpeed[];
  unpricedModels: string[];
  settings: UsageSettings;
  defaultPrices: Record<string, ModelPrice>;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const baseQuery = (range: UsageRange): Omit<UsageStatsQuery, 'groupBy'> => ({
  from: range.from,
  to: range.to,
  utcOffsetMinutes: utcOffsetMinutes(new Date(range.to)),
});

async function loadDashboard(rangeId: UsageRangeId): Promise<UsageDashboardData> {
  const range = resolveRange(rangeId, new Date());
  const query = baseQuery(range);
  const [series, accounts, statuses, speed, settings] = await Promise.all([
    usageStatsApi.getStats({ ...query, groupBy: [range.bucket, 'model'] }),
    usageStatsApi.getStats({ ...query, groupBy: ['provider', 'account', 'model'] }),
    usageStatsApi.getStats({ ...query, groupBy: ['status_code'] }),
    usageStatsApi.getSpeed({ ...query, groupBy: ['model'] }),
    usageStatsApi.getSettings(),
  ]);
  return {
    range,
    seriesGroups: series.groups,
    accountGroups: accounts.groups,
    statusGroups: statuses.groups,
    speed,
    unpricedModels: series.unpricedModels,
    settings: settings.settings,
    defaultPrices: settings.defaultPrices,
  };
}

/**
 * Loads everything the usage dashboard shows for a range. A newer load always
 * wins: responses from a superseded range or refresh are dropped.
 */
export function useUsageDashboard(rangeId: UsageRangeId) {
  const [status, setStatus] = useState<UsageDashboardStatus>('loading');
  const [data, setData] = useState<UsageDashboardData | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setRefreshing(true);
    try {
      const next = await loadDashboard(rangeId);
      if (request !== requestRef.current) return;
      setData(next);
      setError('');
      setStatus('ready');
    } catch (loadError) {
      if (request !== requestRef.current) return;
      if (isUsageStatsDisabledError(loadError)) {
        setData(null);
        setStatus('disabled');
      } else {
        setError(errorMessage(loadError));
        setStatus('error');
      }
    } finally {
      if (request === requestRef.current) setRefreshing(false);
    }
  }, [rangeId]);

  useEffect(() => {
    void load();
    return () => {
      // Invalidate in-flight responses when the range changes or the page unmounts.
      requestRef.current += 1;
    };
  }, [load]);

  /** Saves settings, then reloads so every cost reflects the new prices. */
  const saveSettings = useCallback(
    async (settings: UsageSettings) => {
      await usageStatsApi.saveSettings(settings);
      await load();
    },
    [load]
  );

  const enableRecording = useCallback(async () => {
    await usageStatsApi.enableRecording();
    await load();
  }, [load]);

  return { status, data, error, refreshing, refresh: load, saveSettings, enableRecording };
}

export interface UsageBreakdownState {
  groups: UsageGroup[];
  loading: boolean;
  error: string;
}

/**
 * Loads one breakdown dimension for the dashboard's current range. It reloads
 * when the range object changes, which happens on every dashboard load.
 */
export function useUsageBreakdown(
  range: UsageRange | null,
  dimension: BreakdownDimension
): UsageBreakdownState {
  const [state, setState] = useState<UsageBreakdownState>({
    groups: [],
    loading: true,
    error: '',
  });

  useEffect(() => {
    if (!range) return undefined;
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    usageStatsApi
      .getStats({ ...baseQuery(range), groupBy: [dimension], limit: BREAKDOWN_GROUP_LIMIT })
      .then((result) => {
        if (!cancelled) setState({ groups: result.groups, loading: false, error: '' });
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setState({ groups: [], loading: false, error: errorMessage(loadError) });
      });
    return () => {
      cancelled = true;
    };
  }, [range, dimension]);

  return state;
}
