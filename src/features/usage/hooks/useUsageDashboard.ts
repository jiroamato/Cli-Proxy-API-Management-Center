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
export const BREAKDOWN_GROUP_LIMIT = 200;

export type UsageDashboardStatus = 'loading' | 'ready' | 'disabled' | 'error';

/** Derives the settings to save from the latest saved ones. */
export type UsageSettingsUpdate = (current: UsageSettings) => UsageSettings;

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
  // The selected range, read by reloads that outlive the render that started them.
  const rangeRef = useRef(rangeId);
  // The settings last read from or written to the server.
  const settingsRef = useRef<UsageSettings | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const load = useCallback(async (id: UsageRangeId) => {
    const request = ++requestRef.current;
    setRefreshing(true);
    try {
      const next = await loadDashboard(id);
      if (request !== requestRef.current) return;
      settingsRef.current = next.settings;
      setData(next);
      setError('');
      setStatus('ready');
    } catch (loadError) {
      if (request !== requestRef.current) return;
      // Figures from an earlier load may belong to another range; drop them
      // rather than show them beside this failure.
      setData(null);
      if (isUsageStatsDisabledError(loadError)) {
        setStatus('disabled');
      } else {
        setError(errorMessage(loadError));
        setStatus('error');
      }
    } finally {
      if (request === requestRef.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    rangeRef.current = rangeId;
    void load(rangeId);
    return () => {
      // Invalidate in-flight responses when the range changes or the page unmounts.
      requestRef.current += 1;
    };
  }, [load, rangeId]);

  /** Reloads the range that is selected now, not the one selected when an action began. */
  const refresh = useCallback(() => load(rangeRef.current), [load]);

  /**
   * Saves settings, then reloads so every cost reflects the new prices. The
   * server stores settings as one document, so saves run one at a time and
   * each is derived from the latest saved settings: concurrent edits of
   * different parts never overwrite each other.
   */
  const updateSettings = useCallback(
    (update: UsageSettingsUpdate): Promise<void> => {
      const run = saveQueueRef.current.then(async () => {
        const current = settingsRef.current;
        if (!current) throw new Error('usage settings are not loaded');
        const next = update(current);
        await usageStatsApi.saveSettings(next);
        settingsRef.current = next;
        await refresh();
      });
      saveQueueRef.current = run.catch(() => undefined);
      return run;
    },
    [refresh]
  );

  const enableRecording = useCallback(async () => {
    await usageStatsApi.enableRecording();
    await refresh();
  }, [refresh]);

  return { status, data, error, refreshing, refresh, updateSettings, enableRecording };
}

export interface UsageBreakdownState {
  groups: UsageGroup[];
  /** True when the server left smaller groups out of `groups`. */
  truncated: boolean;
  loading: boolean;
  error: string;
}

const LOADING_BREAKDOWN: UsageBreakdownState = {
  groups: [],
  truncated: false,
  loading: true,
  error: '',
};

/**
 * Loads one breakdown dimension for the dashboard's current range. It reloads
 * when the range object changes, which happens on every dashboard load.
 */
export function useUsageBreakdown(
  range: UsageRange | null,
  dimension: BreakdownDimension
): UsageBreakdownState {
  // The dimension is stored with its groups, so rows of the previous dimension
  // are never shown under the newly selected one while it loads.
  const [state, setState] = useState({ ...LOADING_BREAKDOWN, dimension });

  useEffect(() => {
    if (!range) return undefined;
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    usageStatsApi
      .getStats({ ...baseQuery(range), groupBy: [dimension], limit: BREAKDOWN_GROUP_LIMIT })
      .then((result) => {
        if (cancelled) return;
        setState({
          dimension,
          groups: result.groups,
          truncated: result.truncated,
          loading: false,
          error: '',
        });
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setState({ ...LOADING_BREAKDOWN, dimension, loading: false, error: errorMessage(loadError) });
      });
    return () => {
      cancelled = true;
    };
  }, [range, dimension]);

  return state.dimension === dimension ? state : LOADING_BREAKDOWN;
}
