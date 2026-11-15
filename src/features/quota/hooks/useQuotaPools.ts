import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import { quotaSamplesApi, type QuotaSampleHistory } from '@/services/api/quotaSamples';
import { isUsageStatsDisabledError, usageStatsApi } from '@/services/api/usageStats';
import { useConfigStore, useNotificationStore } from '@/stores';
import type { AuthFileItem, ClaudeQuotaState, CodexQuotaState } from '@/types';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { POOL_RANGE_MS, type PoolRangeId } from '../constants';
import type { LedgerCredential, LedgerMetric } from '../ledger/model';
import type { QuotaFileEntry } from '../logic';
import type { QuotaCardState } from '../providers';
import {
  POOL_PROVIDERS,
  buildQuotaPools,
  isPoolProvider,
  ledgerReadings,
  recordedLedgerMetrics,
  windowLabelKey,
  type PoolCredential,
  type PoolProvider,
  type QuotaPoolGroup,
} from '../quotaPoolModel';

export type QuotaSamplesStatus = 'loading' | 'ready' | 'disabled' | 'error';

interface SamplesState {
  status: QuotaSamplesStatus;
  history: QuotaSampleHistory | null;
  error: string;
  /** The connection the result belongs to; a result of another one is never shown. */
  session: number | null;
}

const LOADING: SamplesState = { status: 'loading', history: null, error: '', session: null };

export interface UseQuotaPoolsInput {
  /** The tab's credentials; Claude and Codex ones form the pools. */
  entries: readonly QuotaFileEntry[];
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  credentialFor: (entry: QuotaFileEntry) => LedgerCredential | null;
  displayNameFor: (entry: QuotaFileEntry) => string;
  connected: boolean;
  session: number;
}

const poolKeyOf = (file: AuthFileItem): string | null =>
  normalizeAuthIndex(file['auth_index'] ?? file.authIndex);

/**
 * Quota pools of the tab's Claude and Codex credentials: loads the recorded
 * quota samples for the selected range and joins them with each credential's
 * ledger read. While a new range loads, the previous result stays on screen.
 */
export function useQuotaPools(input: UseQuotaPoolsInput) {
  const { entries, quotaFor, credentialFor, displayNameFor, connected, session } = input;
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const [rangeId, setRangeId] = useState<PoolRangeId>('3d');
  const [samples, setSamples] = useState<SamplesState>(LOADING);
  const [enabling, setEnabling] = useState(false);
  const requestRef = useRef(0);

  const credentials = useMemo(() => {
    const byProvider: Partial<Record<PoolProvider, PoolCredential[]>> = {};
    entries.forEach((entry) => {
      const key = poolKeyOf(entry.file);
      if (!isPoolProvider(entry.type) || key === null) return;
      const quota = quotaFor(entry) as ClaudeQuotaState | CodexQuotaState | undefined;
      const credential = credentialFor(entry);
      (byProvider[entry.type] ??= []).push({
        key,
        label: displayNameFor(entry),
        ledger: credential
          ? ledgerReadings(entry.type, credential.metrics, quota?.fetchedAtMs)
          : {},
      });
    });
    return byProvider;
  }, [entries, quotaFor, credentialFor, displayNameFor]);

  const enabled = connected && Object.keys(credentials).length > 0;
  const nowMs = useNow(enabled);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    const to = Date.now();
    try {
      const history = await quotaSamplesApi.list({ from: to - POOL_RANGE_MS[rangeId], to });
      if (request !== requestRef.current) return;
      setSamples({ status: 'ready', history, error: '', session });
    } catch (loadError) {
      if (request !== requestRef.current) return;
      setSamples(
        isUsageStatsDisabledError(loadError)
          ? { status: 'disabled', history: null, error: '', session }
          : {
              status: 'error',
              history: null,
              error: loadError instanceof Error ? loadError.message : String(loadError),
              session,
            }
      );
    }
  }, [rangeId, session]);

  useEffect(() => {
    if (!enabled) return undefined;
    void load();
    return () => {
      requestRef.current += 1;
    };
  }, [enabled, load]);

  const current = samples.session === session ? samples : LOADING;

  const groups = useMemo<QuotaPoolGroup[]>(
    () =>
      POOL_PROVIDERS.flatMap((provider) => {
        const list = credentials[provider] ?? [];
        if (list.length === 0) return [];
        const pools = buildQuotaPools(provider, list, current.history?.series ?? []);
        return [{ provider, accountCount: list.length, pools }];
      }),
    [credentials, current.history]
  );

  /** A credential's newest recorded state, as the ledger columns that read the same limits. */
  const recordedMetricsFor = useCallback(
    (entry: QuotaFileEntry): LedgerMetric[] => {
      const key = poolKeyOf(entry.file);
      const pools = groups.find((group) => group.provider === entry.type)?.pools;
      if (key === null || !pools) return [];
      return recordedLedgerMetrics(pools, key, nowMs, (pool) => {
        const labelKey = windowLabelKey(pool.provider, pool.window);
        return labelKey ? t(labelKey) : pool.window;
      });
    },
    [groups, nowMs, t]
  );

  const refresh = useCallback(async () => {
    if (enabled) await load();
  }, [enabled, load]);

  const enableRecording = useCallback(async () => {
    setEnabling(true);
    try {
      await usageStatsApi.enableRecording();
      // The config page caches the full config; make it pick up the new flag.
      void fetchConfig(true).catch(() => undefined);
      await load();
    } catch (enableError) {
      showNotification(
        enableError instanceof Error ? enableError.message : String(enableError),
        'error'
      );
    } finally {
      setEnabling(false);
    }
  }, [fetchConfig, load, showNotification]);

  return {
    groups,
    status: current.status,
    error: current.error,
    rangeId,
    setRangeId,
    enabling,
    refresh,
    enableRecording,
    recordedMetricsFor,
  };
}
