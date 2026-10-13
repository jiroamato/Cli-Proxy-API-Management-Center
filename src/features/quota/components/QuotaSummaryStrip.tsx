/**
 * Provider summary strip: one tile per provider with the headline window
 * summed across its credentials ("409% of 500%"), a segmented bar with one
 * segment per credential, and the soonest reset. Other day-or-longer windows
 * collapse under a Show/Hide toggle so the strip stays one row tall.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResolvedTheme } from '@/types';
import { useNow } from '@/hooks/useNow';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import { describeLedgerReset, type ProviderSummary, type SummaryMetric } from '../ledger/model';
import { QUOTA_PROGRESS_HIGH_THRESHOLD, QUOTA_PROGRESS_MEDIUM_THRESHOLD } from './QuotaMeter';
import styles from './QuotaSummaryStrip.module.scss';

export type QuotaSummaryStripProps = {
  summaries: ProviderSummary[];
  resolvedTheme: ResolvedTheme;
};

const fillClassFor = (percent: number): string =>
  percent >= QUOTA_PROGRESS_HIGH_THRESHOLD
    ? styles.fillHigh
    : percent >= QUOTA_PROGRESS_MEDIUM_THRESHOLD
      ? styles.fillMedium
      : styles.fillLow;

function SegmentedBar({ segments }: { segments: (number | null)[] }) {
  return (
    <div className={styles.segments} aria-hidden="true">
      {segments.map((segment, index) => (
        <span key={index} className={styles.segment}>
          {segment !== null && (
            <span
              className={`${styles.fill} ${fillClassFor(segment)}`}
              style={{ width: `${Math.round(segment * 100) / 100}%` }}
            />
          )}
        </span>
      ))}
    </div>
  );
}

function ResetLine({ metric, nowMs }: { metric: SummaryMetric; nowMs: number }) {
  const { t, i18n } = useTranslation();
  const reset = describeLedgerReset(
    { resetAtMs: metric.soonestResetMs, resetLabel: null },
    nowMs,
    i18n.resolvedLanguage
  );
  if (!reset) return <p className={styles.resetMuted}>{t('quota_management.reset_none')}</p>;
  return (
    <p className={styles.reset}>
      <span className={styles.resetRelative}>{reset.relative}</span>
      <span className={styles.resetDot} aria-hidden="true">
        ·
      </span>
      <span>{reset.absolute}</span>
    </p>
  );
}

const formatTotal = (metric: SummaryMetric): string =>
  metric.totalRemaining === null ? '--' : `${Math.round(metric.totalRemaining)}%`;

function SummaryTile({
  summary,
  resolvedTheme,
}: {
  summary: ProviderSummary;
  resolvedTheme: ResolvedTheme;
}) {
  const { t } = useTranslation();
  const nowMs = useNow();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const iconSrc = getAuthFileIcon(summary.provider, resolvedTheme);
  const typeLabel = getTypeLabel(t, summary.provider);
  const headline = summary.headline;
  const capacity = summary.count * 100;

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <article className={styles.tile}>
      <header className={styles.head}>
        <span
          className={styles.iconWrap}
          style={
            isThemeSurfaceIconProvider(summary.provider)
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
          {t('quota_management.meta_credentials', { count: summary.count })}
        </span>
      </header>

      <div className={styles.headline}>
        <p className={styles.label}>
          {headline ? headline.label : t('quota_management.summary_no_windows')}
        </p>
        <p className={styles.value}>
          <span className={styles.valueNumber}>{headline ? formatTotal(headline) : '--'}</span>
          <span className={styles.valueCapacity}>
            {t('quota_management.summary_capacity', {
              percent: headline ? headline.capacity : capacity,
            })}
          </span>
        </p>
        <SegmentedBar
          segments={
            headline ? headline.segments : Array.from({ length: summary.count }, () => null)
          }
        />
        {headline && <ResetLine metric={headline} nowMs={nowMs} />}
      </div>

      {summary.secondary.length > 0 && (
        <div className={styles.secondary}>
          {summary.secondary.map((metric) => {
            const open = expanded.has(metric.id);
            return (
              <div key={metric.id} className={styles.secondaryItem}>
                <div className={styles.secondaryRow}>
                  <span className={styles.secondaryLabel}>{metric.label}</span>
                  <span className={styles.secondaryValue}>{formatTotal(metric)}</span>
                  <button
                    type="button"
                    className={styles.toggle}
                    aria-expanded={open}
                    onClick={() => toggle(metric.id)}
                  >
                    {t(open ? 'quota_management.summary_hide' : 'quota_management.summary_show')}
                  </button>
                </div>
                {open && (
                  <div className={styles.secondaryDetail}>
                    <SegmentedBar segments={metric.segments} />
                    <ResetLine metric={metric} nowMs={nowMs} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}

export function QuotaSummaryStrip({ summaries, resolvedTheme }: QuotaSummaryStripProps) {
  const { t } = useTranslation();
  const visible = summaries.filter((summary) => summary.count > 0);
  if (visible.length === 0) return null;
  return (
    <section className={styles.strip} aria-label={t('quota_management.summary_aria')}>
      {visible.map((summary) => (
        <SummaryTile
          key={`${summary.type}:${summary.provider}`}
          summary={summary}
          resolvedTheme={resolvedTheme}
        />
      ))}
    </section>
  );
}
