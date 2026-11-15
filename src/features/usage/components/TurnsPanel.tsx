import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { formatCompactNumber, formatPercent } from '@/utils/format';
import { useTurns } from '../hooks/useUsageDashboard';
import { EMPTY_VALUE, formatUsd, type UsageRange } from '../logic';
import type { MonthTurns, TurnFigures } from '../turns';
import styles from '../usage.module.scss';

/** Above this share of unrecorded requests, turn figures run low enough to warn about. */
const MATERIAL_SHARE = 10;

const cls = (...names: (string | false | undefined)[]): string => names.filter(Boolean).join(' ');

/** A ratio with one decimal below 10, written like the page's other figures: 3.4, 14, 1,250. */
const formatRatio = (value: number): string =>
  value.toLocaleString('en-US', { maximumFractionDigits: value < 10 ? 1 : 0 });

const formatShare = (value: number): string =>
  value > 0 && value < 0.05 ? '<0.1%' : formatPercent(value);

const usdOrNoData = (value: number | null, t: TFunction): ReactNode =>
  value === null ? (
    <span className={styles.turnFigureState}>{t('usage.turns.no_data')}</span>
  ) : (
    formatUsd(value)
  );

export function TurnsPanel({ range }: { range: UsageRange }) {
  const { t } = useTranslation();
  const { figures, error } = useTurns(range);

  return (
    <section className={styles.panel} aria-label={t('usage.turns.title')}>
      <div className={styles.panelHead}>
        <div className={styles.panelTitles}>
          <h2 className={styles.panelTitle}>{t('usage.turns.title')}</h2>
          <p className={styles.panelHint}>{t('usage.turns.hint')}</p>
        </div>
      </div>
      {error ? (
        <p className={styles.inlineState}>{error}</p>
      ) : figures ? (
        <TurnsFigures figures={figures} />
      ) : (
        <p className={styles.inlineState}>{t('common.loading')}</p>
      )}
      <p className={styles.footnote}>{t('usage.turns.footnote')}</p>
    </section>
  );
}

export function TurnsFigures({ figures }: { figures: TurnFigures }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { count } = figures;
  const note =
    count.kind === 'unrecorded'
      ? { text: t('usage.turns.unrecorded_notice'), loud: true }
      : count.kind === 'counted' && count.unrecorded > 0
        ? {
            text: t('usage.turns.partial_notice', {
              value: count.unrecorded.toLocaleString(locale),
              share: formatShare(count.unrecordedShare),
            }),
            loud: count.unrecordedShare >= MATERIAL_SHARE,
          }
        : null;

  return (
    <>
      <dl className={styles.turnFigures}>
        <div>
          <dt>{t('usage.turns.turns')}</dt>
          <dd className={styles.turnFigureMain}>
            {count.kind === 'counted' ? (
              count.turns.toLocaleString(locale)
            ) : count.kind === 'unrecorded' ? (
              <span className={styles.turnFigureState}>{t('usage.turns.not_recorded')}</span>
            ) : (
              EMPTY_VALUE
            )}
          </dd>
          {figures.requestsPerTurn !== null && (
            <dd className={styles.turnFigureSub}>
              {t('usage.turns.requests_per_turn', {
                value: formatRatio(figures.requestsPerTurn),
              })}
            </dd>
          )}
        </div>
        <div>
          <dt>{t('usage.turns.threads')}</dt>
          <dd className={styles.turnFigureMain}>{figures.threads.toLocaleString(locale)}</dd>
          {figures.threads > 0 && (
            <dd className={styles.turnFigureSub}>
              {t('usage.turns.thread_split', {
                main: figures.mainThreads.toLocaleString(locale),
                subagent: figures.subagentThreads.toLocaleString(locale),
              })}
            </dd>
          )}
        </div>
        <div>
          <dt>{t('usage.turns.per_turn')}</dt>
          <dd className={styles.turnFigureMain}>{usdOrNoData(figures.costPerTurn, t)}</dd>
          {figures.tokensPerTurn !== null && (
            <dd className={styles.turnFigureSub}>
              {t('usage.turns.tokens_per_turn', {
                value: formatCompactNumber(figures.tokensPerTurn),
              })}
            </dd>
          )}
        </div>
        <div>
          <dt>{t('usage.turns.per_thread')}</dt>
          <dd className={styles.turnFigureMain}>{usdOrNoData(figures.costPerThread, t)}</dd>
          {figures.turnsPerThread !== null && (
            <dd className={styles.turnFigureSub}>
              {t('usage.turns.turns_per_thread', {
                value: formatRatio(figures.turnsPerThread),
              })}
            </dd>
          )}
        </div>
      </dl>

      {note &&
        (note.loud ? (
          <div className={styles.notice} role="status">
            <p className={styles.noticeText}>{note.text}</p>
          </div>
        ) : (
          <p className={styles.footnote} role="status">
            {note.text}
          </p>
        ))}

      {figures.months.length > 0 && <MonthTable months={figures.months} />}
    </>
  );
}

function MonthTable({ months }: { months: readonly MonthTurns[] }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const monthFormat = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' });
  const dayFormat = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
  // A month's span never leaves the month, so its last day needs no month name.
  const lastDayFormat = new Intl.DateTimeFormat(locale, { day: 'numeric' });
  const peakTurns = Math.max(
    1,
    ...months.map((month) => (month.count.kind === 'counted' ? month.count.turns : 0))
  );
  const peakThreads = Math.max(1, ...months.map((month) => month.threads));

  return (
    <div className={styles.tableScroll}>
      <div className={styles.table} role="table" aria-label={t('usage.turns.months_label')}>
        <div className={cls(styles.row, styles.rowHead, styles.turnsMonthRow)} role="row">
          <span role="columnheader">{t('usage.turns.month')}</span>
          <span role="columnheader">{t('usage.turns.turns')}</span>
          <span role="columnheader">{t('usage.turns.threads')}</span>
        </div>
        {months.map((month) => {
          const { count } = month;
          return (
            <div key={month.key} className={cls(styles.row, styles.turnsMonthRow)} role="row">
              <span role="cell" className={styles.cellMain}>
                <span className={styles.cellTitle}>{monthFormat.format(month.from)}</span>
                {month.partial && (
                  <span className={styles.cellSub}>
                    {t('usage.turns.month_span', {
                      from: dayFormat.format(month.from),
                      to: lastDayFormat.format(month.to - 1),
                    })}
                  </span>
                )}
                {count.kind === 'counted' && count.unrecorded > 0 && (
                  <span className={styles.cellSub}>{t('usage.turns.partly_recorded')}</span>
                )}
              </span>
              <span role="cell" className={styles.valueCell}>
                {count.kind === 'counted' ? (
                  <>
                    <span className={styles.track}>
                      <span
                        className={styles.trackFill}
                        style={{ width: `${(count.turns / peakTurns) * 100}%` }}
                      />
                    </span>
                    <span className={cls(styles.num, styles.turnsCount)}>
                      {count.turns.toLocaleString(locale)}
                    </span>
                  </>
                ) : (
                  <span className={styles.muted}>
                    {t(
                      count.kind === 'unrecorded'
                        ? 'usage.turns.not_recorded'
                        : 'usage.turns.no_requests'
                    )}
                  </span>
                )}
              </span>
              <span role="cell" className={styles.valueCell}>
                {count.kind === 'idle' ? (
                  <span className={styles.muted}>{EMPTY_VALUE}</span>
                ) : (
                  <>
                    <span className={styles.track}>
                      <span
                        className={cls(styles.trackFill, styles.trackFillThreads)}
                        style={{ width: `${(month.threads / peakThreads) * 100}%` }}
                      />
                    </span>
                    <span className={cls(styles.num, styles.turnsCount)}>
                      {month.threads.toLocaleString(locale)}
                    </span>
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
