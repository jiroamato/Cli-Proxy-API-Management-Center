/**
 * Quota burn: per provider, one window's remaining quota summed across its
 * accounts, recorded from proxied traffic and projected at the recent burn
 * rate. The maths lives in quotaPoolModel.ts; this file is layout only.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { useNow } from '@/hooks/useNow';
import type { ResolvedTheme } from '@/types';
import { TYPE_COLORS } from '@/utils/quota';
import { DAY_MS } from '@/utils/time/durations';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import { POOL_RANGE_IDS, POOL_RANGE_MS, type PoolRangeId } from '../constants';
import type { QuotaSamplesStatus } from '../hooks/useQuotaPools';
import { describeLedgerReset } from '../ledger/model';
import {
  buildPoolView,
  windowLabelKey,
  type PoolProvider,
  type PoolView,
  type QuotaPool,
  type QuotaPoolGroup,
} from '../quotaPoolModel';
import { QuotaPoolChart } from './QuotaPoolChart';
import styles from './QuotaPool.module.scss';

export interface QuotaPoolSectionProps {
  groups: QuotaPoolGroup[];
  status: QuotaSamplesStatus;
  error: string;
  rangeId: PoolRangeId;
  resolvedTheme: ResolvedTheme;
  enabling: boolean;
  onRangeChange: (range: PoolRangeId) => void;
  onRetry: () => void;
  onEnableRecording: () => void;
}

export function QuotaPoolSection(props: QuotaPoolSectionProps) {
  const { groups, status, error, rangeId, resolvedTheme } = props;
  const { t } = useTranslation();
  if (groups.length === 0) return null;

  return (
    <section className={styles.section} aria-label={t('quota_management.pool_title')}>
      <header className={styles.sectionHead}>
        <div className={styles.sectionCopy}>
          <h2 className={styles.title}>{t('quota_management.pool_title')}</h2>
          <p className={styles.subtitle}>{t('quota_management.pool_description')}</p>
        </div>
        {status !== 'disabled' && (
          <div
            className={styles.modes}
            role="group"
            aria-label={t('quota_management.pool_range_label')}
          >
            {POOL_RANGE_IDS.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={rangeId === id}
                onClick={() => props.onRangeChange(id)}
              >
                {t(`quota_management.pool_range_${id}`)}
              </button>
            ))}
          </div>
        )}
      </header>

      {status === 'loading' ? (
        <Skeleton height={360} rounded={14} />
      ) : status === 'disabled' ? (
        <div className={styles.notice}>
          <p>{t('quota_management.pool_disabled')}</p>
          <Button size="sm" onClick={props.onEnableRecording} disabled={props.enabling}>
            {t('usage.disabled.action')}
          </Button>
        </div>
      ) : status === 'error' ? (
        <div className={styles.notice} role="alert">
          <p>{t('quota_management.pool_error', { message: error })}</p>
          <Button variant="secondary" size="sm" onClick={props.onRetry}>
            {t('common.refresh')}
          </Button>
        </div>
      ) : (
        groups.map((group) => (
          <QuotaPoolPanel
            key={group.provider}
            provider={group.provider}
            accountCount={group.accountCount}
            pools={group.pools}
            rangeMs={POOL_RANGE_MS[rangeId]}
            resolvedTheme={resolvedTheme}
          />
        ))
      )}
    </section>
  );
}

interface QuotaPoolPanelProps {
  provider: PoolProvider;
  accountCount: number;
  pools: QuotaPool[];
  rangeMs: number;
  resolvedTheme: ResolvedTheme;
}

function QuotaPoolPanel({
  provider,
  accountCount,
  pools,
  rangeMs,
  resolvedTheme,
}: QuotaPoolPanelProps) {
  const { t } = useTranslation();
  const nowMs = useNow();
  const [selectedWindow, setSelectedWindow] = useState<string | null>(null);
  const pool = pools.find((entry) => entry.window === selectedWindow) ?? pools[0] ?? null;
  const view = useMemo(
    () => (pool ? buildPoolView(pool, nowMs - rangeMs, nowMs) : null),
    [pool, nowMs, rangeMs]
  );
  const iconSrc = getAuthFileIcon(provider, resolvedTheme);
  const typeLabel = getTypeLabel(t, provider);
  const colors = TYPE_COLORS[provider];
  const accent = resolvedTheme === 'dark' && colors.dark ? colors.dark.text : colors.light.text;
  const labelOf = (window: string) => {
    const key = windowLabelKey(provider, window);
    return key ? t(key) : window;
  };

  return (
    <article className={styles.panel}>
      <header className={styles.panelHead}>
        <span
          className={styles.iconWrap}
          style={
            isThemeSurfaceIconProvider(provider)
              ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
              : undefined
          }
        >
          {iconSrc ? (
            <img src={iconSrc} alt="" className={styles.icon} />
          ) : (
            <span className={styles.iconFallback}>{typeLabel.slice(0, 1).toUpperCase()}</span>
          )}
        </span>
        <span className={styles.name}>{typeLabel}</span>
        <span className={styles.count}>
          {t('quota_management.meta_credentials', { count: accountCount })}
        </span>
        {pools.length > 1 && (
          <div
            className={`${styles.modes} ${styles.windowModes}`}
            role="group"
            aria-label={t('quota_management.pool_window_label')}
          >
            {pools.map((entry) => (
              <button
                key={entry.window}
                type="button"
                aria-pressed={entry === pool}
                onClick={() => setSelectedWindow(entry.window)}
              >
                {labelOf(entry.window)}
              </button>
            ))}
          </div>
        )}
      </header>

      {pool && view && view.accounts.length > 0 ? (
        <>
          <div className={styles.summary}>
            <div className={styles.headline}>
              <p className={styles.label}>{labelOf(pool.window)}</p>
              <p className={styles.value}>
                <span className={styles.valueNumber}>{Math.round(view.remaining)}%</span>
                <span className={styles.valueCapacity}>
                  {t('quota_management.summary_capacity', { percent: view.capacity })}
                </span>
              </p>
              {view.unknownCount > 0 && (
                <p className={styles.muted}>
                  {t('quota_management.pool_unknown', { count: view.unknownCount })}
                </p>
              )}
            </div>
            <PoolStats view={view} nowMs={nowMs} />
          </div>
          <QuotaPoolChart
            recorded={view.recorded}
            projected={view.projected}
            capacity={view.capacity}
            startMs={nowMs - rangeMs}
            nowMs={nowMs}
            endMs={nowMs + Math.min(pool.periodMs, rangeMs)}
            accent={accent}
            ariaLabel={t('quota_management.pool_chart_aria', {
              provider: typeLabel,
              window: labelOf(pool.window),
              remaining: Math.round(view.remaining),
              capacity: view.capacity,
            })}
          />
          <footer className={styles.legend}>
            <span className={styles.legendItem}>
              <span className={styles.swatchSolid} style={{ background: accent }} />
              {t('quota_management.pool_legend_recorded')}
            </span>
            <span className={styles.legendItem}>
              <span className={styles.swatchDashed} style={{ color: accent }} />
              {t('quota_management.pool_legend_projected')}
            </span>
            <span className={styles.legendNote}>
              {t('quota_management.pool_note')}
              {pool.thinned && ` ${t('quota_management.pool_thinned')}`}
            </span>
          </footer>
        </>
      ) : (
        <p className={styles.empty}>{t('quota_management.pool_no_samples')}</p>
      )}
    </article>
  );
}

function PoolStats({ view, nowMs }: { view: PoolView; nowMs: number }) {
  const { t, i18n } = useTranslation();
  const labelFor = (key: string) =>
    view.accounts.find((account) => account.key === key)?.label ?? key;
  const instant = (atMs: number) =>
    describeLedgerReset({ resetAtMs: atMs, resetLabel: null }, nowMs, i18n.resolvedLanguage);
  // A forecast horizon under two days away needs its time of day to mean anything.
  const notBefore = (untilMs: number) =>
    t('quota_management.pool_not_before', {
      date: new Intl.DateTimeFormat(
        i18n.language,
        untilMs - nowMs < 2 * DAY_MS
          ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
          : { month: 'short', day: 'numeric' }
      ).format(untilMs),
    });

  const poolEmpty = view.poolEmpty;
  const firstEmpty = view.firstEmpty;
  const nextReset = view.nextReset;

  return (
    <dl className={styles.stats}>
      <Stat
        label={t('quota_management.pool_stat_empty')}
        primary={
          poolEmpty.kind === 'now'
            ? t('quota_management.pool_empty_now')
            : poolEmpty.kind === 'at'
              ? (instant(poolEmpty.atMs)?.relative ?? '')
              : notBefore(poolEmpty.untilMs)
        }
        secondary={poolEmpty.kind === 'at' ? (instant(poolEmpty.atMs)?.absolute ?? null) : null}
      />
      <Stat
        label={t('quota_management.pool_stat_first_empty')}
        primary={
          firstEmpty.kind === 'now'
            ? t('quota_management.pool_empty_now')
            : firstEmpty.kind === 'at'
              ? (instant(firstEmpty.atMs)?.relative ?? '')
              : notBefore(firstEmpty.untilMs)
        }
        secondary={firstEmpty.kind === 'none' ? null : labelFor(firstEmpty.accountKey)}
      />
      <Stat
        label={t('quota_management.pool_stat_next_reset')}
        primary={
          nextReset
            ? `${t('quota_management.pool_reset_gain', {
                percent: Math.round(nextReset.gainPercent),
              })} · ${instant(nextReset.atMs)?.relative ?? ''}`
            : t('quota_management.pool_reset_unknown')
        }
        secondary={
          nextReset
            ? `${instant(nextReset.atMs)?.absolute ?? ''} · ${labelFor(nextReset.accountKey)}`
            : null
        }
      />
      <Stat
        label={t('quota_management.pool_stat_burn')}
        primary={t('quota_management.pool_burn_value', { value: view.burnPerHour.toFixed(1) })}
        secondary={null}
      />
    </dl>
  );
}

function Stat({
  label,
  primary,
  secondary,
}: {
  label: string;
  primary: string;
  secondary: string | null;
}) {
  return (
    <div className={styles.stat}>
      <dt>{label}</dt>
      <dd>
        <span className={styles.statPrimary}>{primary}</span>
        {secondary && (
          <span className={styles.statSecondary} title={secondary}>
            {secondary}
          </span>
        )}
      </dd>
    </div>
  );
}
