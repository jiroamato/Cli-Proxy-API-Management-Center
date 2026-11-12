import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatCompactNumber } from '@/utils/format';
import {
  axisCeil,
  formatBucketLabel,
  formatUsd,
  formatUsdTick,
  type SeriesPoint,
  type UsageBucket,
} from '../logic';
import styles from '../usage.module.scss';

type ChartMode = 'tokens' | 'cost';

const CHART_MODES: readonly ChartMode[] = ['tokens', 'cost'];
const AXIS_INTERVALS = 4;
const MAX_X_LABELS = 8;
const MODEL_COLORS = [
  'var(--usage-c1)',
  'var(--usage-c2)',
  'var(--usage-c3)',
  'var(--usage-c4)',
  'var(--usage-c5)',
  'var(--usage-c6)',
] as const;
const REST_COLOR = 'var(--usage-c-rest)';

interface Segment {
  id: string;
  label: string;
  color: string;
  valueOf: (point: SeriesPoint) => number;
}

interface UsageChartProps {
  series: readonly SeriesPoint[];
  bucket: UsageBucket;
  /** Models to give their own colour in cost mode, most expensive first. */
  topModels: readonly string[];
}

/**
 * Stacked bars over time: tokens split by type, or API-equivalent cost split
 * by model. Bars are plain flex boxes, so the chart needs no chart library.
 */
export function UsageChart({ series, bucket, topModels }: UsageChartProps) {
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState<ChartMode>('tokens');

  const segments = useMemo<Segment[]>(() => {
    if (mode === 'tokens') {
      return [
        {
          id: 'input',
          label: t('usage.tokens.input'),
          color: 'var(--usage-input)',
          valueOf: (point) => point.metrics.inputTokens,
        },
        {
          id: 'cache_write',
          label: t('usage.tokens.cache_write'),
          color: 'var(--usage-cache-write)',
          valueOf: (point) => point.metrics.cacheWriteTokens,
        },
        {
          id: 'cache_read',
          label: t('usage.tokens.cache_read'),
          color: 'var(--usage-cache-read)',
          valueOf: (point) => point.metrics.cacheReadTokens,
        },
        {
          id: 'output',
          label: t('usage.tokens.output'),
          color: 'var(--usage-output)',
          valueOf: (point) => point.metrics.outputTokens,
        },
        {
          id: 'reasoning',
          label: t('usage.tokens.reasoning'),
          color: 'var(--usage-reasoning)',
          valueOf: (point) => point.metrics.reasoningTokens,
        },
        {
          // Tokens the upstream reported only as a total, so bars add up to it.
          id: 'unclassified',
          label: t('usage.tokens.unclassified'),
          color: REST_COLOR,
          valueOf: (point) => point.metrics.unclassifiedTokens,
        },
      ];
    }
    const named = topModels.slice(0, MODEL_COLORS.length - 1);
    const namedSet = new Set(named);
    const modelSegments: Segment[] = named.map((model, index) => ({
      id: `model:${model}`,
      label: model || t('usage.unknown'),
      color: MODEL_COLORS[index],
      valueOf: (point) => point.costByModel[model] ?? 0,
    }));
    return [
      ...modelSegments,
      {
        id: 'rest',
        label: t('usage.chart.other_models'),
        color: REST_COLOR,
        valueOf: (point) =>
          Object.entries(point.costByModel).reduce(
            (sum, [model, cost]) => (namedSet.has(model) ? sum : sum + cost),
            0
          ),
      },
    ];
  }, [mode, t, topModels]);

  const format = mode === 'tokens' ? formatCompactNumber : formatUsd;
  const formatTick = mode === 'tokens' ? formatCompactNumber : formatUsdTick;
  const totals = series.map((point) =>
    segments.reduce((sum, segment) => sum + segment.valueOf(point), 0)
  );
  const max = axisCeil(Math.max(0, ...totals));
  // Hide legend entries (such as "Other models") that have nothing to show.
  const visibleSegments = segments.filter((segment) =>
    series.some((point) => segment.valueOf(point) > 0)
  );
  const labelStep = Math.max(1, Math.ceil(series.length / MAX_X_LABELS));

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div className={styles.panelTitles}>
          <h2 className={styles.panelTitle}>
            {t(
              mode === 'tokens'
                ? `usage.chart.title_tokens_${bucket}`
                : `usage.chart.title_cost_${bucket}`
            )}
          </h2>
          <ul className={styles.legend}>
            {visibleSegments.map((segment) => (
              <li key={segment.id} className={styles.legendItem}>
                <span className={styles.swatch} style={{ background: segment.color }} />
                <span className={styles.legendLabel} title={segment.label}>
                  {segment.label}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.segmented} role="group" aria-label={t('usage.chart.mode_label')}>
          {CHART_MODES.map((option) => (
            <button
              key={option}
              type="button"
              className={`${styles.segment} ${mode === option ? styles.segmentActive : ''}`}
              aria-pressed={mode === option}
              onClick={() => setMode(option)}
            >
              {t(`usage.chart.mode_${option}`)}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.chart}>
        <div className={styles.axis} aria-hidden="true">
          {Array.from({ length: AXIS_INTERVALS + 1 }, (_, index) => (
            <span key={index}>{formatTick((max * index) / AXIS_INTERVALS)}</span>
          ))}
        </div>
        <div className={styles.plot}>
          <div className={styles.bars} role="list">
            {series.map((point, index) => {
              const total = totals[index];
              const height = (total / max) * 100;
              const label = formatBucketLabel(point.key, bucket, i18n.language);
              const tooltipSide =
                index < series.length / 4
                  ? styles.tooltipStart
                  : index >= (series.length * 3) / 4
                    ? styles.tooltipEnd
                    : '';
              return (
                <div
                  key={point.key}
                  className={styles.column}
                  role="listitem"
                  tabIndex={0}
                  aria-label={`${label}: ${format(total)}`}
                >
                  <div className={styles.stack} style={{ height: `${height}%` }}>
                    {segments.map((segment) => {
                      const value = segment.valueOf(point);
                      return value > 0 ? (
                        <span
                          key={segment.id}
                          className={styles.stackSegment}
                          style={{ flex: `${value} 1 0`, background: segment.color }}
                        />
                      ) : null;
                    })}
                  </div>
                  <div
                    className={`${styles.tooltip} ${tooltipSide}`}
                    role="tooltip"
                    // Sit just above the bar, not above the full-height hit area.
                    style={{ bottom: `calc(${height}% + 8px)` }}
                  >
                    <div className={styles.tooltipTitle}>
                      <span>{label}</span>
                      <span>{format(total)}</span>
                    </div>
                    {segments.map((segment) => {
                      const value = segment.valueOf(point);
                      return value > 0 ? (
                        <div key={segment.id} className={styles.tooltipRow}>
                          <span className={styles.swatch} style={{ background: segment.color }} />
                          <span className={styles.tooltipName}>{segment.label}</span>
                          <span className={styles.tooltipValue}>{format(value)}</span>
                        </div>
                      ) : null;
                    })}
                    {mode === 'tokens' && (
                      <div className={styles.tooltipRow}>
                        <span className={styles.tooltipName}>{t('usage.columns.requests')}</span>
                        <span className={styles.tooltipValue}>
                          {point.metrics.requests.toLocaleString(i18n.language)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className={styles.xAxis} aria-hidden="true">
          {series.map((point, index) => (
            <div key={point.key} className={styles.xTick}>
              {index % labelStep === 0 && (
                // Every other label is dropped on narrow screens, where they would collide.
                <span className={(index / labelStep) % 2 === 1 ? styles.xLabelMinor : undefined}>
                  {formatBucketLabel(point.key, bucket, i18n.language)}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
