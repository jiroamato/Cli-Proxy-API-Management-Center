import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UsageGroup, UsageMetrics } from '@/services/api/usageStats';
import { formatCompactNumber } from '@/utils/format';
import { BREAKDOWN_GROUP_LIMIT } from '../hooks/useUsageDashboard';
import {
  EMPTY_VALUE,
  MODEL_PARTS,
  buildModelRows,
  costPerMillion,
  formatShare,
  formatUsd,
  hasCostSplit,
  isUnpriced,
  partTokens,
  partValue,
  sumMetrics,
  type ModelPart,
  type ModelView,
} from '../logic';
import styles from '../usage.module.scss';

const MODEL_ROW_LIMIT = 12;
const MODEL_VIEWS: readonly ModelView[] = ['tokens', 'cost'];
const PART_COLORS: Record<ModelPart, string> = {
  input: 'var(--usage-input)',
  cache_write: 'var(--usage-cache-write)',
  cache_read: 'var(--usage-cache-read)',
  output: 'var(--usage-output)',
};
/** Tokens reported only as a total, so a tokens bar still adds up to its row. */
const UNCLASSIFIED_COLOR = 'var(--usage-c-rest)';

const cls = (...names: (string | false | undefined)[]): string => names.filter(Boolean).join(' ');

interface ModelsPanelProps {
  groups: readonly UsageGroup[];
  truncated: boolean;
  /** The view shown first; cost unless a caller asks otherwise. */
  initialView?: ModelView;
}

interface MixBarProps {
  metrics: UsageMetrics;
  view: ModelView;
  /** Bar length as a percentage of the track. */
  width: number;
}

/** A share bar whose fill is split into the parts that make it up. */
function MixBar({ metrics, view, width }: MixBarProps) {
  const parts: { id: string; value: number; color: string }[] = MODEL_PARTS.map((part) => ({
    id: part,
    value: partValue(metrics, part, view),
    color: PART_COLORS[part],
  }));
  if (view === 'tokens' && metrics.unclassifiedTokens > 0) {
    parts.push({
      id: 'unclassified',
      value: metrics.unclassifiedTokens,
      color: UNCLASSIFIED_COLOR,
    });
  }
  const split = view === 'tokens' || hasCostSplit(metrics);
  return (
    <span className={styles.track}>
      <span className={styles.mixFill} style={{ width: `${width}%` }}>
        {split ? (
          parts
            .filter((part) => part.value > 0)
            .map((part) => (
              <span
                key={part.id}
                className={styles.mixPart}
                style={{ flexGrow: part.value, background: part.color }}
              />
            ))
        ) : (
          <span className={styles.mixPart} style={{ flexGrow: 1 }} />
        )}
      </span>
    </span>
  );
}

/**
 * Every model across every account, with its tokens or its API-equivalent
 * cost split into input, cache writes, cache reads, and output.
 */
export function ModelsPanel({ groups, truncated, initialView = 'cost' }: ModelsPanelProps) {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<ModelView>(initialView);
  const { rows, basis } = buildModelRows(groups, view, MODEL_ROW_LIMIT);
  const totals = sumMetrics(groups);
  const hasUnclassified = view === 'tokens' && totals.unclassifiedTokens > 0;
  // Bars are scaled to the largest row, so the split of every row stays readable.
  const peakShare = Math.max(0, ...rows.map((row) => row.share));
  const barWidth = (share: number): number => (peakShare > 0 ? (share / peakShare) * 100 : 0);

  const partCell = (metrics: UsageMetrics, part: ModelPart): string => {
    // A part with no tokens reads as a dash in both views, not as 0 or $0.
    if (partTokens(metrics, part) === 0) return EMPTY_VALUE;
    if (view === 'tokens') return formatCompactNumber(partValue(metrics, part, view));
    if (isUnpriced(metrics) || !hasCostSplit(metrics)) return EMPTY_VALUE;
    return formatUsd(partValue(metrics, part, view));
  };

  const totalCell = (metrics: UsageMetrics) => {
    if (view === 'tokens') return formatCompactNumber(metrics.totalTokens);
    if (isUnpriced(metrics)) {
      return <span className={styles.muted}>{t('usage.models.no_price')}</span>;
    }
    return formatUsd(metrics.costUsd);
  };

  const lastCell = (metrics: UsageMetrics): string => {
    if (view === 'tokens') return metrics.requests.toLocaleString(i18n.language);
    const rate = costPerMillion(metrics);
    return rate === null ? EMPTY_VALUE : formatUsd(rate);
  };

  const renderRow = (
    key: string,
    label: string,
    metrics: UsageMetrics,
    share: number,
    options: { mono?: boolean; muted?: boolean; total?: boolean }
  ) => (
    <div
      key={key}
      className={cls(styles.row, styles.modelsRow, options.total && styles.rowTotal)}
      role="row"
    >
      <span
        role="cell"
        className={cls(
          styles.cellTitle,
          options.mono && styles.mono,
          options.muted && styles.muted
        )}
        title={label}
      >
        {label}
      </span>
      <span role="cell" className={styles.valueCell}>
        <MixBar metrics={metrics} view={view} width={options.total ? 100 : barWidth(share)} />
        <span className={cls(styles.num, styles.numMuted, styles.sharePercent)}>
          {formatShare(share)}
        </span>
      </span>
      {MODEL_PARTS.map((part) => (
        <span key={part} role="cell" className={cls(styles.num, styles.numMuted)}>
          {partCell(metrics, part)}
        </span>
      ))}
      <span role="cell" className={cls(styles.num, styles.numStrong)}>
        {totalCell(metrics)}
      </span>
      <span role="cell" className={cls(styles.num, styles.numMuted)}>
        {lastCell(metrics)}
      </span>
    </div>
  );

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div className={styles.panelTitles}>
          <h2 className={styles.panelTitle}>{t('usage.models.title')}</h2>
          <p className={styles.panelHint}>{t(`usage.models.hint_${view}`)}</p>
        </div>
        <div className={styles.segmented} role="group" aria-label={t('usage.models.view_label')}>
          {MODEL_VIEWS.map((option) => (
            <button
              key={option}
              type="button"
              className={cls(styles.segment, view === option && styles.segmentActive)}
              aria-pressed={view === option}
              onClick={() => setView(option)}
            >
              {t(`usage.models.view_${option}`)}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className={styles.inlineState}>{t('usage.breakdown.empty')}</p>
      ) : (
        <>
          <ul className={styles.legend}>
            {MODEL_PARTS.map((part) => (
              <li key={part} className={styles.legendItem}>
                <span className={styles.swatch} style={{ background: PART_COLORS[part] }} />
                <span className={styles.legendLabel}>{t(`usage.models.part.${part}`)}</span>
              </li>
            ))}
            {hasUnclassified && (
              <li className={styles.legendItem}>
                <span className={styles.swatch} style={{ background: UNCLASSIFIED_COLOR }} />
                <span className={styles.legendLabel}>{t('usage.tokens.unclassified')}</span>
              </li>
            )}
          </ul>
          <div className={styles.tableScroll}>
            <div className={styles.table} role="table" aria-label={t('usage.models.title')}>
              <div className={cls(styles.row, styles.rowHead, styles.modelsRow)} role="row">
                <span role="columnheader">{t('usage.breakdown.dimension.model')}</span>
                <span role="columnheader">
                  {t(basis === 'cost' ? 'usage.columns.cost_share' : 'usage.columns.token_share')}
                </span>
                {MODEL_PARTS.map((part) => (
                  <span key={part} role="columnheader" className={styles.num}>
                    {t(`usage.models.part.${part}`)}
                  </span>
                ))}
                <span role="columnheader" className={styles.num}>
                  {t(view === 'tokens' ? 'usage.models.total_tokens' : 'usage.models.total_cost')}
                </span>
                <span role="columnheader" className={styles.num}>
                  {t(view === 'tokens' ? 'usage.columns.requests' : 'usage.models.per_million')}
                </span>
              </div>
              {rows.map((row, index) => {
                const label = row.remainder
                  ? t('usage.breakdown.others', { count: row.folded })
                  : row.value || t('usage.unknown');
                return renderRow(
                  row.remainder ? 'remainder' : `${index}:${row.value}`,
                  label,
                  row.metrics,
                  row.share,
                  {
                    mono: !row.remainder && row.value !== '',
                    muted: row.remainder || row.value === '',
                  }
                );
              })}
              {rows.length > 1 &&
                renderRow('total', t('usage.models.all'), totals, 100, { total: true })}
            </div>
          </div>
        </>
      )}
      {rows.length > 0 && (
        <p className={styles.footnote}>
          {t(view === 'tokens' ? 'usage.models.footnote_tokens' : 'usage.models.footnote_cost')}
          {truncated && ` ${t('usage.breakdown.truncated', { count: BREAKDOWN_GROUP_LIMIT })}`}
        </p>
      )}
    </section>
  );
}
