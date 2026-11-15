import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { AccountPlan } from '@/services/api/usageStats';
import { providerLabel } from '@/features/dashboard/utils';
import { formatCompactNumber, formatPercent } from '@/utils/format';
import { useLimitValue } from '../hooks/useUsageDashboard';
import {
  THIN_EVIDENCE_PERCENT,
  buildLimitValueCards,
  type LimitFigures,
  type LimitValueCard,
} from '../limitValue';
import { EMPTY_VALUE, formatMultiple, formatUsd, formatUsdTick, type UsageRange } from '../logic';
import styles from '../usage.module.scss';

const UNPRICED_NAMES_SHOWN = 4;

const cls = (...names: (string | false | undefined)[]): string => names.filter(Boolean).join(' ');

const capitalize = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

function windowLabel(card: LimitValueCard, t: TFunction): string {
  const { length } = card;
  const base =
    length === null
      ? card.window
      : card.weekly
        ? t('usage.limit_value.window_weekly')
        : t(`usage.limit_value.window_${length.unit}`, { count: length.count });
  return card.modelScope ? `${base} · ${capitalize(card.modelScope)}` : base;
}

interface LimitValuePanelProps {
  range: UsageRange;
  plans: readonly AccountPlan[];
  displayAccount: (account: string) => string;
}

/** What one percent, and a full quota window, bought at API prices in the selected range. */
export function LimitValuePanel({ range, plans, displayAccount }: LimitValuePanelProps) {
  const { t } = useTranslation();
  const { result, loading, error } = useLimitValue(range);
  const cards = useMemo(
    () => (result ? buildLimitValueCards(result.series, plans) : []),
    [result, plans]
  );
  const unpriced = result?.unpricedModels ?? [];
  const unpricedNames =
    unpriced.slice(0, UNPRICED_NAMES_SHOWN).join(', ') +
    (unpriced.length > UNPRICED_NAMES_SHOWN ? ` +${unpriced.length - UNPRICED_NAMES_SHOWN}` : '');

  return (
    <section className={styles.panel} aria-label={t('usage.limit_value.title')}>
      <div className={styles.panelHead}>
        <div className={styles.panelTitles}>
          <h2 className={styles.panelTitle}>{t('usage.limit_value.title')}</h2>
          <p className={styles.panelHint}>{t('usage.limit_value.hint')}</p>
        </div>
      </div>
      {error ? (
        <p className={styles.inlineState}>{error}</p>
      ) : cards.length === 0 ? (
        <p className={styles.inlineState}>
          {loading ? t('common.loading') : t('usage.limit_value.empty')}
        </p>
      ) : (
        <div className={styles.limitCards}>
          {cards.map((card) => (
            <LimitCard key={card.key} card={card} displayAccount={displayAccount} />
          ))}
        </div>
      )}
      {unpriced.length > 0 && (
        <p className={styles.footnote}>
          {t('usage.limit_value.unpriced', { models: unpricedNames })}
        </p>
      )}
      <p className={styles.footnote}>
        {t('usage.limit_value.footnote', { percent: THIN_EVIDENCE_PERCENT })}
      </p>
    </section>
  );
}

const usdOrNoData = (value: number | null, t: TFunction): string =>
  value === null ? t('usage.limit_value.no_data') : formatUsd(value);

const tokensOrNoData = (value: number | null, t: TFunction): string =>
  value === null ? t('usage.limit_value.no_data') : formatCompactNumber(value);

function ThinTag() {
  const { t } = useTranslation();
  return (
    <span
      className={styles.thinTag}
      title={t('usage.limit_value.thin_hint', { percent: THIN_EVIDENCE_PERCENT })}
    >
      {t('usage.limit_value.thin')}
    </span>
  );
}

function Evidence({ figures }: { figures: LimitFigures }) {
  const { t } = useTranslation();
  return (
    <span className={styles.limitEvidenceCell}>
      {t('usage.limit_value.evidence', {
        percent: formatPercent(figures.percentUsed),
        intervals: figures.intervals,
      })}
      {figures.thin && <ThinTag />}
    </span>
  );
}

export function LimitCard({
  card,
  displayAccount,
}: {
  card: LimitValueCard;
  displayAccount: (account: string) => string;
}) {
  const { t } = useTranslation();
  const [showAccounts, setShowAccounts] = useState(false);
  const { figures } = card;
  const title = `${providerLabel(card.provider, t('usage.unknown'))} · ${windowLabel(card, t)}`;
  const monthly = card.monthlyUsd;

  return (
    <article className={cls(styles.limitCard, figures.thin && styles.limitCardThin)}>
      <header className={styles.limitHead}>
        <h3 className={styles.limitTitle}>{title}</h3>
        <span className={styles.limitSub}>
          {t('usage.limit_value.card_evidence', {
            percent: formatPercent(figures.percentUsed),
            intervals: figures.intervals,
          })}
        </span>
        {figures.thin && <ThinTag />}
      </header>

      <dl className={styles.limitFigures}>
        <div>
          <dt>{t('usage.limit_value.per_percent')}</dt>
          <dd className={styles.limitFigureMain}>{usdOrNoData(figures.usdPerPercent, t)}</dd>
        </div>
        <div>
          <dt>{t('usage.limit_value.full_limit')}</dt>
          <dd className={styles.limitFigureMain}>{usdOrNoData(figures.fullLimitUsd, t)}</dd>
        </div>
        {card.weekly && (
          <div>
            <dt>{t('usage.limit_value.per_month')}</dt>
            <dd className={styles.limitFigureMain}>{usdOrNoData(monthly, t)}</dd>
            {monthly !== null && card.planMonthlyUsd !== null && (
              <dd className={styles.limitFigureSub}>
                {t('usage.limit_value.plan_multiple', {
                  multiple: formatMultiple(monthly / card.planMonthlyUsd),
                  plan: formatUsdTick(card.planMonthlyUsd),
                })}
              </dd>
            )}
          </div>
        )}
        <div>
          <dt>{t('usage.limit_value.output_per_limit')}</dt>
          <dd className={styles.limitFigureMain}>
            {tokensOrNoData(figures.outputTokensPerLimit, t)}
          </dd>
        </div>
      </dl>

      {card.models.length > 0 && (
        <div className={styles.tableScroll}>
          <div
            className={styles.table}
            role="table"
            aria-label={t('usage.limit_value.models_label', { limit: title })}
          >
            <div className={cls(styles.row, styles.rowHead, styles.limitRow)} role="row">
              <span role="columnheader">{t('usage.breakdown.dimension.model')}</span>
              <span role="columnheader" className={styles.num}>
                {t('usage.limit_value.per_percent')}
              </span>
              <span role="columnheader" className={styles.num}>
                {t('usage.limit_value.full_limit')}
              </span>
              <span role="columnheader" className={styles.num}>
                {t('usage.limit_value.output_per_limit')}
              </span>
              <span role="columnheader">{t('usage.limit_value.evidence_column')}</span>
            </div>
            {card.models.map((row) => (
              <div
                key={row.model}
                className={cls(styles.row, styles.limitRow, row.thin && styles.rowThin)}
                role="row"
              >
                <span role="cell" className={cls(styles.mono, styles.cellTitle)} title={row.model}>
                  {row.model || t('usage.unknown')}
                </span>
                <span role="cell" className={styles.num}>
                  {usdOrNoData(row.usdPerPercent, t)}
                </span>
                <span role="cell" className={styles.num}>
                  {usdOrNoData(row.fullLimitUsd, t)}
                </span>
                <span role="cell" className={styles.num}>
                  {tokensOrNoData(row.outputTokensPerLimit, t)}
                </span>
                <span role="cell">
                  <Evidence figures={row} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        className={cls(styles.linkButton, styles.limitToggle)}
        aria-expanded={showAccounts}
        onClick={() => setShowAccounts((open) => !open)}
      >
        {t(showAccounts ? 'usage.limit_value.hide_accounts' : 'usage.limit_value.show_accounts', {
          count: card.accounts.length,
        })}
      </button>

      {showAccounts && (
        <div className={styles.tableScroll}>
          <div
            className={styles.table}
            role="table"
            aria-label={t('usage.limit_value.accounts_label', { limit: title })}
          >
            <div className={cls(styles.row, styles.rowHead, styles.limitRow)} role="row">
              <span role="columnheader">{t('usage.columns.account')}</span>
              <span role="columnheader" className={styles.num}>
                {t('usage.limit_value.per_percent')}
              </span>
              <span role="columnheader" className={styles.num}>
                {t('usage.limit_value.full_limit')}
              </span>
              <span role="columnheader" className={styles.num}>
                {t('usage.limit_value.per_month')}
              </span>
              <span role="columnheader">{t('usage.limit_value.evidence_column')}</span>
            </div>
            {card.accounts.map((row) => {
              const name = displayAccount(row.account) || t('usage.unknown');
              return (
                <div
                  key={row.account}
                  className={cls(styles.row, styles.limitRow, row.thin && styles.rowThin)}
                  role="row"
                >
                  <span role="cell" className={styles.cellTitle} title={name}>
                    {name}
                  </span>
                  <span role="cell" className={styles.num}>
                    {usdOrNoData(row.usdPerPercent, t)}
                  </span>
                  <span role="cell" className={styles.num}>
                    {usdOrNoData(row.fullLimitUsd, t)}
                  </span>
                  <span role="cell" className={styles.num}>
                    {row.monthlyUsd === null
                      ? EMPTY_VALUE
                      : row.planMonthlyUsd === null
                        ? formatUsd(row.monthlyUsd)
                        : `${formatUsd(row.monthlyUsd)} · ${formatMultiple(
                            row.monthlyUsd / row.planMonthlyUsd
                          )}`}
                  </span>
                  <span role="cell">
                    <Evidence figures={row} />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </article>
  );
}
