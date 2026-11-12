/**
 * Usage dashboard: tokens and API-equivalent cost over time, what each
 * subscription delivered against its price, and breakdowns by project, model,
 * client key, and more.
 *
 * Data comes from the backend's persistent usage store, one row per upstream
 * request. Every figure is derived from those rows at query time, including
 * cost, so editing a price re-prices history.
 */

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconDollarSign, IconEye, IconEyeOff, IconRefreshCw } from '@/components/ui/icons';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { maskEmails } from '@/features/quota/ledger/model';
import { readQuotaUiState, writeQuotaUiState } from '@/features/quota/uiState';
import { useRevealGroup } from '@/hooks/motion';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useConfigStore, useNotificationStore } from '@/stores';
import { formatCompactNumber, formatPercent } from '@/utils/format';
import { ModelPricesModal } from './components/ModelPricesModal';
import { UsageChart } from './components/UsageChart';
import {
  AccountValueTable,
  BreakdownPanel,
  SpeedPanel,
  StatusPanel,
} from './components/UsagePanels';
import { useUsageDashboard } from './hooks/useUsageDashboard';
import {
  EMPTY_VALUE,
  USAGE_RANGE_IDS,
  buildAccountRows,
  buildSeries,
  cacheHitRate,
  errorRate,
  formatMultiple,
  formatUsd,
  listBucketKeys,
  recordedWindowDays,
  subscriptionValue,
  sumMetrics,
  topModelsByCost,
  withAccountPlan,
  type UsageRangeId,
} from './logic';
import styles from './usage.module.scss';

const DEFAULT_RANGE: UsageRangeId = '30d';
const CHART_MODEL_LIMIT = 5;
const UNPRICED_NAMES_SHOWN = 4;

const isRangeId = (value: string): value is UsageRangeId =>
  (USAGE_RANGE_IDS as readonly string[]).includes(value);

/** The first few model names, with a count of the rest. */
const summarizeModels = (models: readonly string[]): string => {
  const shown = models.slice(0, UNPRICED_NAMES_SHOWN).join(', ');
  const rest = models.length - UNPRICED_NAMES_SHOWN;
  return rest > 0 ? `${shown} +${rest}` : shown;
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function UsagePage() {
  const { t, i18n } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const revealRef = useRevealGroup<HTMLDivElement>();

  const [rangeId, setRangeId] = useState<UsageRangeId>(DEFAULT_RANGE);
  // Shared with the quota page, so emails are masked or shown consistently.
  const [showEmails, setShowEmails] = useState(() => readQuotaUiState()?.showEmails ?? false);
  const [pricesOpen, setPricesOpen] = useState(false);
  const [pricesKey, setPricesKey] = useState(0);
  const [pendingPlanSaves, setPendingPlanSaves] = useState(0);
  const [enabling, setEnabling] = useState(false);

  const { status, data, error, refreshing, refresh, updateSettings, enableRecording } =
    useUsageDashboard(rangeId);
  useHeaderRefresh(refresh);

  const view = useMemo(() => {
    if (!data) return null;
    const series = buildSeries(data.seriesGroups, data.range.bucket, listBucketKeys(data.range));
    const windowDays = recordedWindowDays(data.range, series);
    const accounts = buildAccountRows(data.accountGroups, data.settings.accountPlans, windowDays);
    return {
      series,
      windowDays,
      accounts,
      totals: sumMetrics(data.seriesGroups),
      value: subscriptionValue(accounts),
      topModels: topModelsByCost(data.seriesGroups, CHART_MODEL_LIMIT),
    };
  }, [data]);

  const displayAccount = useCallback(
    (account: string) => (showEmails ? account : maskEmails(account)),
    [showEmails]
  );

  const handleToggleEmails = () => {
    setShowEmails((prev) => {
      writeQuotaUiState({ showEmails: !prev });
      return !prev;
    });
  };

  const handleSavePlan = async (provider: string, account: string, monthlyUsd: number) => {
    setPendingPlanSaves((count) => count + 1);
    try {
      await updateSettings((current) => ({
        ...current,
        accountPlans: withAccountPlan(current.accountPlans, provider, account, monthlyUsd),
      }));
    } catch (saveError) {
      showNotification(messageOf(saveError), 'error');
    } finally {
      setPendingPlanSaves((count) => count - 1);
    }
  };

  const handleEnable = async () => {
    setEnabling(true);
    try {
      await enableRecording();
      // The config page caches the full config; make it pick up the new flag.
      void fetchConfig(true).catch(() => undefined);
    } catch (enableError) {
      showNotification(messageOf(enableError), 'error');
    } finally {
      setEnabling(false);
    }
  };

  const openPrices = () => {
    setPricesKey((key) => key + 1);
    setPricesOpen(true);
  };

  const rangeOptions = USAGE_RANGE_IDS.map((id) => ({ value: id, label: t(`usage.range.${id}`) }));
  const totals = view?.totals;
  const hasData = Boolean(totals && totals.requests > 0);
  const cacheRate = totals ? cacheHitRate(totals) : null;
  const failureRate = totals ? errorRate(totals) : null;
  const unpricedModels = data?.unpricedModels ?? [];

  return (
    <div className={styles.page} ref={revealRef}>
      <header className={styles.header}>
        <div className={styles.copy}>
          <h1 className={styles.title} data-reveal>
            {t('usage.title')}
          </h1>
          <p className={styles.meta} data-reveal>
            {totals && hasData ? (
              <>
                <span>
                  {t('usage.meta_requests', {
                    value: totals.requests.toLocaleString(i18n.language),
                  })}
                </span>
                <span className={styles.metaDot} aria-hidden="true">
                  ·
                </span>
                <span>
                  {t('usage.meta_tokens', { value: formatCompactNumber(totals.totalTokens) })}
                </span>
                <span className={styles.metaDot} aria-hidden="true">
                  ·
                </span>
                <span className={styles.metaStrong}>
                  {t('usage.meta_cost', { value: formatUsd(totals.costUsd) })}
                </span>
              </>
            ) : (
              <span className={styles.metaMuted}>{t(`usage.meta_status.${status}`)}</span>
            )}
          </p>
        </div>
        <div className={styles.actions} data-reveal>
          <div className={styles.rangeSelect}>
            <Select
              value={rangeId}
              options={rangeOptions}
              onChange={(value) => {
                if (isRangeId(value)) setRangeId(value);
              }}
              ariaLabel={t('usage.range_label')}
              size="sm"
            />
          </div>
          <button
            type="button"
            className={styles.secondaryAction}
            onClick={handleToggleEmails}
            aria-pressed={showEmails}
          >
            {showEmails ? <IconEyeOff size={14} /> : <IconEye size={14} />}
            {t(showEmails ? 'quota_management.hide_emails' : 'quota_management.show_emails')}
          </button>
          <button
            type="button"
            className={styles.secondaryAction}
            onClick={openPrices}
            disabled={!data}
          >
            <IconDollarSign size={14} />
            {t('usage.prices.button')}
          </button>
          <button
            type="button"
            className={styles.primaryAction}
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            <IconRefreshCw size={14} className={refreshing ? styles.spinning : undefined} />
            {t('common.refresh')}
          </button>
        </div>
      </header>

      {status === 'loading' && (
        <>
          <Skeleton className={styles.skeletonStrip} />
          <Skeleton className={styles.skeletonPanel} />
        </>
      )}

      {status === 'disabled' && (
        <EmptyState
          title={t('usage.disabled.title')}
          description={t('usage.disabled.description')}
          action={
            <button
              type="button"
              className={styles.primaryAction}
              onClick={() => void handleEnable()}
              disabled={enabling}
            >
              {t('usage.disabled.action')}
            </button>
          }
        />
      )}

      {status === 'error' && (
        <EmptyState
          title={t('usage.error_title')}
          description={error}
          action={
            <button type="button" className={styles.secondaryAction} onClick={() => void refresh()}>
              {t('common.refresh')}
            </button>
          }
        />
      )}

      {status === 'ready' && data && view && totals && !hasData && (
        <EmptyState title={t('usage.empty.title')} description={t('usage.empty.description')} />
      )}

      {status === 'ready' && data && view && totals && hasData && (
        <>
          <section className={styles.strip} aria-label={t('usage.summary.label')}>
            <div className={styles.tile}>
              <p className={styles.tileLabel}>{t('usage.summary.cost')}</p>
              <p className={styles.tileValue}>{formatUsd(totals.costUsd)}</p>
              <p className={styles.tileSub}>
                {t('usage.summary.cost_sub', {
                  value: formatUsd(totals.costUsd / view.windowDays),
                })}
              </p>
            </div>
            <div className={styles.tile}>
              <p className={styles.tileLabel}>{t('usage.summary.value')}</p>
              <p
                className={`${styles.tileValue} ${
                  !view.value
                    ? styles.tileValueMuted
                    : view.value.multiple >= 1
                      ? styles.tileValueAccent
                      : ''
                }`}
              >
                {view.value ? formatMultiple(view.value.multiple) : EMPTY_VALUE}
              </p>
              <p className={styles.tileSub}>
                {view.value
                  ? t('usage.summary.value_sub', {
                      cost: formatUsd(view.value.costUsd),
                      plan: formatUsd(view.value.planWindowUsd),
                    })
                  : t('usage.summary.value_empty')}
              </p>
            </div>
            <div className={styles.tile}>
              <p className={styles.tileLabel}>{t('usage.summary.tokens')}</p>
              <p className={styles.tileValue}>{formatCompactNumber(totals.totalTokens)}</p>
              <p className={styles.tileSub}>
                {t('usage.summary.tokens_sub', {
                  input: formatCompactNumber(
                    totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens
                  ),
                  output: formatCompactNumber(totals.outputTokens + totals.reasoningTokens),
                })}
              </p>
            </div>
            <div className={styles.tile}>
              <p className={styles.tileLabel}>{t('usage.summary.cache')}</p>
              <p className={styles.tileValue}>
                {cacheRate === null ? EMPTY_VALUE : formatPercent(cacheRate)}
              </p>
              <p className={styles.tileSub}>
                {t('usage.summary.cache_sub', {
                  value: formatCompactNumber(totals.cacheReadTokens),
                })}
              </p>
            </div>
            <div className={styles.tile}>
              <p className={styles.tileLabel}>{t('usage.summary.requests')}</p>
              <p className={styles.tileValue}>{totals.requests.toLocaleString(i18n.language)}</p>
              <p className={styles.tileSub}>
                {t('usage.summary.requests_sub', {
                  value: failureRate === null ? EMPTY_VALUE : formatPercent(failureRate),
                })}
              </p>
            </div>
          </section>

          {unpricedModels.length > 0 && (
            <div className={styles.notice} role="status">
              <p className={styles.noticeText}>
                {t('usage.unpriced.notice', { models: summarizeModels(unpricedModels) })}
              </p>
              <button type="button" className={styles.linkButton} onClick={openPrices}>
                {t('usage.unpriced.action')}
              </button>
            </div>
          )}

          <UsageChart series={view.series} bucket={data.range.bucket} topModels={view.topModels} />

          <AccountValueTable
            rows={view.accounts}
            windowDays={view.windowDays}
            saving={pendingPlanSaves > 0}
            displayAccount={displayAccount}
            onSavePlan={(provider, account, monthlyUsd) =>
              void handleSavePlan(provider, account, monthlyUsd)
            }
          />

          <BreakdownPanel range={data.range} />

          <div className={styles.split}>
            <SpeedPanel speed={data.speed} />
            <StatusPanel groups={data.statusGroups} />
          </div>
        </>
      )}

      {data && (
        <ModelPricesModal
          key={pricesKey}
          open={pricesOpen}
          settings={data.settings}
          unpricedModels={unpricedModels}
          builtInCount={Object.keys(data.defaultPrices).length}
          onClose={() => setPricesOpen(false)}
          onSave={(modelPrices) => updateSettings((current) => ({ ...current, modelPrices }))}
        />
      )}
    </div>
  );
}
