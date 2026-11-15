import { useId, useMemo, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { DAY_MS } from '@/utils/time/durations';
import { lineValueAt, type PoolPoint } from '../quotaPoolModel';
import styles from './QuotaPool.module.scss';

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 240;
/** Room above the full-pool line so the stroke is not clipped. */
const TOP_PADDING = 6;

interface QuotaPoolChartProps {
  recorded: readonly PoolPoint[];
  projected: readonly PoolPoint[];
  capacity: number;
  startMs: number;
  nowMs: number;
  endMs: number;
  accent: string;
  ariaLabel: string;
}

interface Tick {
  atMs: number;
  dayStart: boolean;
}

/** Local-time ticks: every 6 hours on short spans, every day or two otherwise. */
function timeTicks(startMs: number, endMs: number): Tick[] {
  const span = endMs - startMs;
  const stepHours = span <= 2 * DAY_MS ? 6 : span <= 10 * DAY_MS ? 24 : 48;
  const cursor = new Date(startMs);
  cursor.setMinutes(0, 0, 0);
  if (stepHours === 6) {
    cursor.setHours(Math.ceil(cursor.getHours() / 6) * 6);
  } else {
    cursor.setHours(24, 0, 0, 0);
  }
  // Labels this close to an edge would overflow the plot.
  const margin = span * 0.03;
  const ticks: Tick[] = [];
  while (cursor.getTime() < endMs - margin && ticks.length < 40) {
    if (cursor.getTime() > startMs + margin) {
      ticks.push({ atMs: cursor.getTime(), dayStart: cursor.getHours() === 0 });
    }
    if (stepHours === 6) cursor.setHours(cursor.getHours() + 6);
    else cursor.setDate(cursor.getDate() + stepHours / 24);
  }
  return ticks;
}

const formatPercent = (value: number): string => `${Math.round(value)}%`;

export function QuotaPoolChart({
  recorded,
  projected,
  capacity,
  startMs,
  nowMs,
  endMs,
  accent,
  ariaLabel,
}: QuotaPoolChartProps) {
  const { t, i18n } = useTranslation();
  const gradientId = useId();
  const clipId = useId();
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const span = endMs - startMs;
  const xPercent = (atMs: number) => ((atMs - startMs) / span) * 100;
  const yOf = (remaining: number) =>
    TOP_PADDING + (1 - remaining / capacity) * (VIEW_HEIGHT - TOP_PADDING);

  const paths = useMemo(() => {
    const x = (atMs: number) => (((atMs - startMs) / span) * VIEW_WIDTH).toFixed(2);
    const y = (remaining: number) =>
      (TOP_PADDING + (1 - remaining / capacity) * (VIEW_HEIGHT - TOP_PADDING)).toFixed(2);
    const toPath = (points: readonly PoolPoint[]) =>
      points
        .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.atMs)} ${y(point.remaining)}`)
        .join(' ');
    const line = toPath(recorded);
    const first = recorded[0];
    const last = recorded[recorded.length - 1];
    const area =
      first && last
        ? `${line} L${x(last.atMs)} ${VIEW_HEIGHT} L${x(first.atMs)} ${VIEW_HEIGHT} Z`
        : '';
    return { recorded: line, area, projected: toPath(projected) };
  }, [recorded, projected, startMs, span, capacity]);

  const ticks = useMemo(() => timeTicks(startMs, endMs), [startMs, endMs]);
  const dayFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric' }),
    [i18n.language]
  );
  const hourFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { hour: 'numeric', minute: '2-digit' }),
    [i18n.language]
  );
  const hoverFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
      }),
    [i18n.language]
  );

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setHoverMs(startMs + ratio * span);
  };

  const hover = (() => {
    if (hoverMs === null) return null;
    const isRecorded = hoverMs <= nowMs;
    const value = lineValueAt(isRecorded ? recorded : projected, hoverMs);
    if (value === null) return null;
    return { atMs: hoverMs, value, isRecorded };
  })();
  const nowPercent = xPercent(nowMs);
  const yTicks = [capacity, capacity / 2, 0];

  return (
    <div className={styles.chart}>
      <div className={styles.yAxis} aria-hidden="true">
        {yTicks.map((value) => (
          <span key={value} style={{ top: `${(yOf(value) / VIEW_HEIGHT) * 100}%` }}>
            {formatPercent(value)}
          </span>
        ))}
      </div>
      <div
        className={styles.plot}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverMs(null)}
      >
        {yTicks.map((value) => (
          <span
            key={value}
            className={styles.gridLine}
            style={{ top: `${(yOf(value) / VIEW_HEIGHT) * 100}%` }}
            aria-hidden="true"
          />
        ))}
        <svg
          className={styles.svg}
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={ariaLabel}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={accent} stopOpacity="0.22" />
              <stop offset="100%" stopColor={accent} stopOpacity="0.02" />
            </linearGradient>
            <clipPath id={clipId}>
              <rect x="0" y="0" width={VIEW_WIDTH} height={VIEW_HEIGHT} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clipId})`}>
            {paths.area && <path d={paths.area} fill={`url(#${gradientId})`} stroke="none" />}
            <path
              d={paths.recorded}
              fill="none"
              stroke={accent}
              strokeWidth={2}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={paths.projected}
              fill="none"
              stroke={accent}
              strokeWidth={2}
              strokeDasharray="6 5"
              strokeLinejoin="round"
              strokeOpacity={0.85}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        </svg>
        <span className={styles.nowLine} style={{ left: `${nowPercent}%` }} aria-hidden="true" />
        <span className={styles.nowLabel} style={{ left: `${nowPercent}%` }} aria-hidden="true">
          {t('quota_management.pool_now')}
        </span>
        {hover && (
          <>
            <span
              className={styles.hoverLine}
              style={{ left: `${xPercent(hover.atMs)}%` }}
              aria-hidden="true"
            />
            <span
              className={styles.hoverDot}
              style={{
                left: `${xPercent(hover.atMs)}%`,
                top: `${(yOf(hover.value) / VIEW_HEIGHT) * 100}%`,
                background: accent,
              }}
              aria-hidden="true"
            />
            <div
              className={`${styles.tooltip} ${xPercent(hover.atMs) > 60 ? styles.tooltipLeft : ''}`}
              style={{ left: `${xPercent(hover.atMs)}%` }}
              aria-hidden="true"
            >
              {hoverFormat.format(hover.atMs)}
              {' · '}
              {t(
                hover.isRecorded
                  ? 'quota_management.pool_tooltip_recorded'
                  : 'quota_management.pool_tooltip_projected',
                { percent: Math.round(hover.value) }
              )}
            </div>
          </>
        )}
      </div>
      <div className={styles.xAxis} aria-hidden="true">
        {ticks.map((tick, index) => (
          <span
            key={tick.atMs}
            className={index % 2 === 1 ? styles.xLabelMinor : undefined}
            style={{ left: `${xPercent(tick.atMs)}%` }}
          >
            {tick.dayStart ? dayFormat.format(tick.atMs) : hourFormat.format(tick.atMs)}
          </span>
        ))}
      </div>
    </div>
  );
}
