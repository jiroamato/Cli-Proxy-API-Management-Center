import { Fragment, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown } from '@/components/ui/icons';
import type { UsageGroup, UsageSpeed } from '@/services/api/usageStats';
import { providerLabel } from '@/features/dashboard/utils';
import { formatCompactNumber, formatPercent } from '@/utils/format';
import { useUsageBreakdown } from '../hooks/useUsageDashboard';
import {
  BREAKDOWN_DIMENSIONS,
  EMPTY_VALUE,
  accountPlanKey,
  buildBreakdownRows,
  foldAccountModels,
  formatDurationMs,
  formatMultiple,
  formatUsd,
  sumMetrics,
  type AccountRow,
  type BreakdownDimension,
  type UsageRange,
} from '../logic';
import styles from '../usage.module.scss';

const BREAKDOWN_ROW_LIMIT = 12;
/** Models listed per account before the rest fold into one row. */
const ACCOUNT_MODEL_LIMIT = 6;
/** With more accounts than this, model rows start collapsed to keep the table short. */
const ACCOUNTS_EXPANDED_BY_DEFAULT = 6;
/** Dimensions whose values are identifiers, shown in the mono face. */
const MONO_DIMENSIONS: ReadonlySet<BreakdownDimension> = new Set([
  'model',
  'client_key',
  'user_agent',
  'session_id',
]);

const cls = (...names: (string | false | undefined)[]): string => names.filter(Boolean).join(' ');

/* ---------- value per account ---------- */

interface PlanInputProps {
  value: number | null;
  label: string;
  disabled: boolean;
  onCommit: (monthlyUsd: number) => void;
}

/** Monthly plan price. Commits on blur or Enter, and only when it changed. */
function PlanInput({ value, label, disabled, onCommit }: PlanInputProps) {
  const initial = value === null ? '' : String(value);
  const [draft, setDraft] = useState(initial);

  const commit = () => {
    const trimmed = draft.trim();
    const parsed = trimmed === '' ? 0 : Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDraft(initial);
      return;
    }
    if (parsed !== (value ?? 0)) onCommit(parsed);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape') {
      setDraft(initial);
      event.currentTarget.blur();
    }
  };

  return (
    <label className={styles.planInput}>
      <span aria-hidden="true">$</span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        value={draft}
        placeholder="0"
        aria-label={label}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
      />
    </label>
  );
}

interface AccountValueTableProps {
  rows: readonly AccountRow[];
  windowDays: number;
  saving: boolean;
  displayAccount: (account: string) => string;
  onSavePlan: (provider: string, account: string, monthlyUsd: number) => void;
}

/** What each upstream subscription delivered in API-equivalent dollars against its price. */
export function AccountValueTable(props: AccountValueTableProps) {
  const { rows, windowDays, saving, displayAccount, onSavePlan } = props;
  const { t, i18n } = useTranslation();
  const peakMultiple = Math.max(1, ...rows.map((row) => row.multiple ?? 0));
  const days = Number(windowDays.toFixed(windowDays < 10 ? 1 : 0));
  // Only explicit toggles are stored, so the default follows the account count.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const expandedByDefault = rows.length <= ACCOUNTS_EXPANDED_BY_DEFAULT;

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div className={styles.panelTitles}>
          <h2 className={styles.panelTitle}>{t('usage.accounts.title')}</h2>
          <p className={styles.panelHint}>{t('usage.accounts.hint')}</p>
        </div>
      </div>
      <div className={styles.tableScroll}>
        <div className={styles.table} role="table" aria-label={t('usage.accounts.title')}>
          <div className={cls(styles.row, styles.rowHead, styles.accountRow)} role="row">
            <span role="columnheader">{t('usage.columns.account')}</span>
            <span role="columnheader" className={styles.num}>
              {t('usage.columns.requests')}
            </span>
            <span role="columnheader" className={styles.num}>
              {t('usage.columns.tokens')}
            </span>
            <span role="columnheader" className={styles.num}>
              {t('usage.columns.api_cost')}
            </span>
            <span role="columnheader" className={styles.num}>
              {t('usage.columns.plan')}
            </span>
            <span role="columnheader">{t('usage.columns.value')}</span>
          </div>
          {rows.map((row) => {
            const name = displayAccount(row.account) || t('usage.unknown');
            const key = accountPlanKey(row.provider, row.account);
            const expanded = toggled[key] ?? expandedByDefault;
            const models = foldAccountModels(row.models, ACCOUNT_MODEL_LIMIT);
            return (
              <Fragment key={key}>
                <div className={cls(styles.row, styles.accountRow)} role="row">
                  <span role="cell" className={styles.accountCell}>
                    <button
                      type="button"
                      className={cls(styles.expandButton, expanded && styles.expandButtonOpen)}
                      aria-expanded={expanded}
                      aria-label={t(
                        expanded ? 'usage.accounts.hide_models' : 'usage.accounts.show_models',
                        { account: name }
                      )}
                      onClick={() => setToggled((prev) => ({ ...prev, [key]: !expanded }))}
                    >
                      <IconChevronDown size={14} aria-hidden="true" />
                    </button>
                    <span className={styles.cellMain}>
                      <span className={styles.cellTitle} title={name}>
                        {name}
                      </span>
                      <span className={styles.cellSub}>
                        {providerLabel(row.provider, t('usage.unknown'))}
                      </span>
                    </span>
                  </span>
                  <span role="cell" className={styles.num}>
                    {row.metrics.requests.toLocaleString(i18n.language)}
                  </span>
                  <span role="cell" className={styles.num}>
                    {formatCompactNumber(row.metrics.totalTokens)}
                  </span>
                  <span role="cell" className={styles.num}>
                    {formatUsd(row.metrics.costUsd)}
                  </span>
                  <span role="cell">
                    <PlanInput
                      // Remount when the saved value changes so the draft follows it.
                      key={row.planMonthlyUsd ?? 'none'}
                      value={row.planMonthlyUsd}
                      label={t('usage.accounts.plan_label', { account: name })}
                      disabled={saving}
                      onCommit={(monthlyUsd) => onSavePlan(row.provider, row.account, monthlyUsd)}
                    />
                  </span>
                  <span role="cell" className={styles.valueCell}>
                    {row.multiple === null ? (
                      <span className={styles.muted}>{t('usage.accounts.no_plan')}</span>
                    ) : (
                      <>
                        <span
                          className={cls(styles.multiple, row.multiple < 1 && styles.multipleLow)}
                        >
                          {formatMultiple(row.multiple)}
                        </span>
                        <span className={styles.track}>
                          <span
                            className={cls(styles.trackFill, styles.trackFillValue)}
                            style={{
                              width: `${Math.min(100, (row.multiple / peakMultiple) * 100)}%`,
                            }}
                          />
                        </span>
                      </>
                    )}
                  </span>
                </div>
                {expanded &&
                  models.rows.map((model, index) => {
                    const isRemainder = models.folded > 0 && index === models.rows.length - 1;
                    const label = isRemainder
                      ? t('usage.accounts.other_models', { count: models.folded })
                      : model.model || t('usage.unknown');
                    const share = formatPercent(model.share);
                    return (
                      <div
                        key={isRemainder ? 'remainder' : model.model}
                        className={cls(styles.row, styles.accountRow, styles.modelRow)}
                        role="row"
                      >
                        <span
                          role="cell"
                          className={cls(
                            styles.modelName,
                            isRemainder || model.model === '' ? styles.muted : styles.mono
                          )}
                          title={label}
                        >
                          {label}
                        </span>
                        <span role="cell" className={styles.num}>
                          {model.metrics.requests.toLocaleString(i18n.language)}
                        </span>
                        <span role="cell" className={styles.num}>
                          {formatCompactNumber(model.metrics.totalTokens)}
                        </span>
                        <span role="cell" className={styles.num}>
                          {formatUsd(model.metrics.costUsd)}
                        </span>
                        <span role="cell" className={cls(styles.num, styles.numMuted)}>
                          {share}
                        </span>
                        <span
                          role="cell"
                          className={styles.valueCell}
                          title={
                            row.shareBasis === 'cost'
                              ? t('usage.accounts.model_share', { value: share })
                              : undefined
                          }
                        >
                          <span className={styles.track}>
                            <span
                              className={styles.trackFill}
                              style={{ width: `${model.share}%` }}
                            />
                          </span>
                        </span>
                      </div>
                    );
                  })}
              </Fragment>
            );
          })}
        </div>
      </div>
      <p className={styles.footnote}>
        {t('usage.accounts.models_note')} {t('usage.accounts.footnote', { days })}
      </p>
    </section>
  );
}

/* ---------- breakdown ---------- */

interface BreakdownPanelProps {
  range: UsageRange;
}

/** Tokens, cost, and requests ranked by one dimension (project, model, ...). */
export function BreakdownPanel({ range }: BreakdownPanelProps) {
  const { t, i18n } = useTranslation();
  const [dimension, setDimension] = useState<BreakdownDimension>('project');
  const { groups, loading, error } = useUsageBreakdown(range, dimension);
  const { rows, basis } = buildBreakdownRows(groups, dimension, BREAKDOWN_ROW_LIMIT);
  const mono = MONO_DIMENSIONS.has(dimension);

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div className={styles.panelTitles}>
          <h2 className={styles.panelTitle}>{t('usage.breakdown.title')}</h2>
          <p className={styles.panelHint}>{t(`usage.breakdown.hint.${dimension}`)}</p>
        </div>
        <div className={styles.segmented} role="group" aria-label={t('usage.breakdown.title')}>
          {BREAKDOWN_DIMENSIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={cls(styles.segment, dimension === option && styles.segmentActive)}
              aria-pressed={dimension === option}
              onClick={() => setDimension(option)}
            >
              {t(`usage.breakdown.dimension.${option}`)}
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <p className={styles.inlineState}>{error}</p>
      ) : rows.length === 0 ? (
        <p className={styles.inlineState}>
          {loading ? t('common.loading') : t('usage.breakdown.empty')}
        </p>
      ) : (
        <div className={styles.tableScroll}>
          <div className={styles.table} role="table" aria-label={t('usage.breakdown.title')}>
            <div className={cls(styles.row, styles.rowHead, styles.breakdownRow)} role="row">
              <span role="columnheader">{t(`usage.breakdown.dimension.${dimension}`)}</span>
              <span role="columnheader">
                {t(basis === 'cost' ? 'usage.columns.cost_share' : 'usage.columns.token_share')}
              </span>
              <span role="columnheader" className={styles.num}>
                {t('usage.columns.tokens')}
              </span>
              <span role="columnheader" className={styles.num}>
                {t('usage.columns.api_cost')}
              </span>
              <span role="columnheader" className={styles.num}>
                {t('usage.columns.requests')}
              </span>
            </div>
            {rows.map((row, index) => {
              const isRemainder = row.folded > 1;
              const label = isRemainder
                ? t('usage.breakdown.others', { count: row.folded })
                : row.value || t('usage.unknown');
              return (
                <div
                  key={isRemainder ? 'remainder' : `${index}:${row.value}`}
                  className={cls(styles.row, styles.breakdownRow)}
                  role="row"
                >
                  <span
                    role="cell"
                    className={cls(
                      styles.cellTitle,
                      mono && !isRemainder && row.value !== '' && styles.mono,
                      (isRemainder || row.value === '') && styles.muted
                    )}
                    title={label}
                  >
                    {label}
                  </span>
                  <span role="cell" className={styles.valueCell}>
                    <span className={styles.track}>
                      <span className={styles.trackFill} style={{ width: `${row.share}%` }} />
                    </span>
                    <span className={cls(styles.num, styles.numMuted, styles.sharePercent)}>
                      {formatPercent(row.share)}
                    </span>
                  </span>
                  <span role="cell" className={styles.num}>
                    {formatCompactNumber(row.metrics.totalTokens)}
                  </span>
                  <span role="cell" className={styles.num}>
                    {formatUsd(row.metrics.costUsd)}
                  </span>
                  <span role="cell" className={styles.num}>
                    {row.metrics.requests.toLocaleString(i18n.language)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------- speed ---------- */

interface SpeedPanelProps {
  speed: readonly UsageSpeed[];
}

const pair = (p50: number, p95: number): string =>
  p50 > 0 ? `${formatDurationMs(p50)} / ${formatDurationMs(p95)}` : EMPTY_VALUE;

/** Latency and time-to-first-token percentiles and output throughput per model. */
export function SpeedPanel({ speed }: SpeedPanelProps) {
  const { t, i18n } = useTranslation();
  const rows = [...speed].sort((a, b) => b.requests - a.requests);

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div className={styles.panelTitles}>
          <h2 className={styles.panelTitle}>{t('usage.speed.title')}</h2>
          <p className={styles.panelHint}>{t('usage.speed.hint')}</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className={styles.inlineState}>{t('usage.speed.empty')}</p>
      ) : (
        <div className={styles.tableScroll}>
          <div className={styles.table} role="table" aria-label={t('usage.speed.title')}>
            <div className={cls(styles.row, styles.rowHead, styles.speedRow)} role="row">
              <span role="columnheader">{t('usage.breakdown.dimension.model')}</span>
              <span role="columnheader" className={styles.num}>
                {t('usage.columns.requests')}
              </span>
              <span role="columnheader" className={styles.num}>
                {t('usage.speed.latency')}
              </span>
              <span role="columnheader" className={styles.num}>
                {t('usage.speed.first_token')}
              </span>
              <span role="columnheader" className={styles.num}>
                {t('usage.speed.throughput')}
              </span>
            </div>
            {rows.map((row) => (
              <div key={row.value} className={cls(styles.row, styles.speedRow)} role="row">
                <span
                  role="cell"
                  className={cls(styles.cellTitle, styles.mono)}
                  title={row.value || t('usage.unknown')}
                >
                  {row.value || t('usage.unknown')}
                </span>
                <span role="cell" className={styles.num}>
                  {row.requests.toLocaleString(i18n.language)}
                </span>
                <span role="cell" className={styles.num}>
                  {pair(row.latencyP50Ms, row.latencyP95Ms)}
                </span>
                <span role="cell" className={styles.num}>
                  {pair(row.ttftP50Ms, row.ttftP95Ms)}
                </span>
                <span role="cell" className={styles.num}>
                  {row.outputTokensPerSecond > 0
                    ? Math.round(row.outputTokensPerSecond).toLocaleString(i18n.language)
                    : EMPTY_VALUE}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------- status codes ---------- */

interface StatusPanelProps {
  groups: readonly UsageGroup[];
}

/** Requests by HTTP status code, busiest first. */
export function StatusPanel({ groups }: StatusPanelProps) {
  const { t, i18n } = useTranslation();
  const total = sumMetrics(groups).requests;
  const rows = [...groups].sort((a, b) => b.requests - a.requests);

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div className={styles.panelTitles}>
          <h2 className={styles.panelTitle}>{t('usage.status.title')}</h2>
          <p className={styles.panelHint}>{t('usage.status.hint')}</p>
        </div>
      </div>
      <div className={styles.table} role="table" aria-label={t('usage.status.title')}>
        <div className={cls(styles.row, styles.rowHead, styles.statusRow)} role="row">
          <span role="columnheader">{t('usage.status.code')}</span>
          <span role="columnheader" className={styles.num}>
            {t('usage.columns.requests')}
          </span>
          <span role="columnheader" className={styles.num}>
            {t('usage.columns.share')}
          </span>
        </div>
        {rows.map((group) => {
          const code = group.dimensions.status_code ?? '';
          const failed = Number(code) >= 400;
          return (
            <div key={code} className={cls(styles.row, styles.statusRow)} role="row">
              <span role="cell" className={styles.mono}>
                <span
                  className={cls(styles.statusDot, failed && styles.statusDotFailed)}
                  aria-hidden="true"
                />
                {code || t('usage.unknown')}
              </span>
              <span role="cell" className={styles.num}>
                {group.requests.toLocaleString(i18n.language)}
              </span>
              <span role="cell" className={cls(styles.num, styles.numMuted)}>
                {formatPercent(total > 0 ? (group.requests / total) * 100 : 0)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
