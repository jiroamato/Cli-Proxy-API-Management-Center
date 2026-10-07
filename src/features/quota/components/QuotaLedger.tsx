/**
 * Ledger view: credentials grouped by provider, one row each.
 *
 * A row reads left to right: identity (masked filename + plan line), the
 * window columns (label, remaining %, bar, reset), any provider-specific
 * block (Codex manual resets, xAI monthly credits), then the actions.
 * idle / loading / error rows keep the same frame so the list never jumps.
 */

import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import type { ResolvedTheme } from '@/types';
import { useNow } from '@/hooks/useNow';
import { getTypeLabel } from '@/features/authFiles/constants';
import type { QuotaCardState } from '../providers';
import type { QuotaProviderType } from '../providers/types';
import type { QuotaFileEntry } from '../logic';
import {
  describeLedgerReset,
  type LedgerCredential,
  type LedgerExtra,
  type LedgerMetric,
} from '../ledger/model';
import { useQuotaEntryActions } from '../hooks/useQuotaEntryActions';
import { QuotaEntryActions } from './QuotaEntryActions';
import { QUOTA_PROGRESS_HIGH_THRESHOLD, QUOTA_PROGRESS_MEDIUM_THRESHOLD } from './QuotaMeter';
import styles from './QuotaLedger.module.scss';

export interface QuotaLedgerGroup {
  type: QuotaProviderType;
  entries: QuotaFileEntry[];
}

export type QuotaLedgerProps = {
  groups: QuotaLedgerGroup[];
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  credentialFor: (entry: QuotaFileEntry) => LedgerCredential | null;
  displayNameFor: (entry: QuotaFileEntry) => string;
  resolvedTheme: ResolvedTheme;
  canUseActions: boolean;
  resettingKey: string | null;
  cacheKeyFor: (entry: QuotaFileEntry) => string;
  onRefresh: (entry: QuotaFileEntry) => void;
  onReset: (entry: QuotaFileEntry) => void;
};

const fillClassFor = (percent: number): string =>
  percent >= QUOTA_PROGRESS_HIGH_THRESHOLD
    ? styles.fillHigh
    : percent >= QUOTA_PROGRESS_MEDIUM_THRESHOLD
      ? styles.fillMedium
      : styles.fillLow;

function Countdown({ atMs, nowMs }: { atMs: number; nowMs: number }) {
  const { i18n } = useTranslation();
  const reset = describeLedgerReset(
    { resetAtMs: atMs, resetLabel: null },
    nowMs,
    i18n.resolvedLanguage
  );
  if (!reset) return null;
  return (
    <>
      <span className={styles.resetRelative}>{reset.relative}</span>
      <span className={styles.dot} aria-hidden="true">
        ·
      </span>
      <span>{reset.absolute}</span>
    </>
  );
}

function MetricCell({ metric, nowMs }: { metric: LedgerMetric; nowMs: number }) {
  const { t, i18n } = useTranslation();
  const remaining = metric.remainingPercent;
  const reset = describeLedgerReset(metric, nowMs, i18n.resolvedLanguage);
  return (
    <div className={styles.metric}>
      <div className={styles.metricHead}>
        <span className={styles.metricLabel} title={metric.label}>
          {metric.label}
        </span>
        <span className={styles.metricPercent}>
          {remaining === null ? '--' : `${Math.round(remaining)}%`}
        </span>
      </div>
      <div
        className={styles.track}
        role={remaining === null ? undefined : 'meter'}
        aria-label={remaining === null ? undefined : metric.label}
        aria-valuemin={remaining === null ? undefined : 0}
        aria-valuemax={remaining === null ? undefined : 100}
        aria-valuenow={remaining ?? undefined}
      >
        {remaining !== null && (
          <span
            className={`${styles.fill} ${fillClassFor(remaining)}`}
            style={{ width: `${Math.round(remaining * 100) / 100}%` }}
          />
        )}
      </div>
      <p className={styles.reset}>
        {reset ? (
          reset.relative ? (
            <>
              <span className={styles.resetRelative}>{reset.relative}</span>
              <span className={styles.dot} aria-hidden="true">
                ·
              </span>
              <span>{reset.absolute}</span>
            </>
          ) : (
            <span>{reset.absolute}</span>
          )
        ) : (
          <span className={styles.resetMuted}>{t('quota_management.reset_none')}</span>
        )}
      </p>
    </div>
  );
}

function ExtraCell({ extra, nowMs }: { extra: LedgerExtra; nowMs: number }) {
  return (
    <div className={styles.extra}>
      <p className={styles.extraTitle}>{extra.title}</p>
      <p className={styles.extraValue}>
        <span className={styles.extraNumber}>{extra.value}</span>
        {extra.valueSuffix && <span className={styles.extraSuffix}>{extra.valueSuffix}</span>}
      </p>
      {extra.lines.map((line) => (
        <p key={line.id} className={styles.extraLine}>
          <span>{line.text}</span>
          {line.atMs !== null && (
            <>
              <span className={styles.dot} aria-hidden="true">
                ·
              </span>
              <Countdown atMs={line.atMs} nowMs={nowMs} />
            </>
          )}
        </p>
      ))}
    </div>
  );
}

type RowProps = {
  entry: QuotaFileEntry;
  quota: QuotaCardState | undefined;
  credential: LedgerCredential | null;
  displayName: string;
  canRefresh: boolean;
  resetting: boolean;
  onRefresh: () => void;
  onReset: () => void;
};

function QuotaLedgerRow(props: RowProps) {
  const { entry, quota, credential, displayName, canRefresh, resetting, onRefresh, onReset } =
    props;
  const { t } = useTranslation();
  const nowMs = useNow();
  const actions = useQuotaEntryActions(entry, quota, canRefresh, resetting, onRefresh);
  const { adapter, status, loading, errorMessage, claudeReset } = actions;
  const planLabel = credential?.plan ?? getTypeLabel(t, entry.type);
  const planClass =
    credential?.planTier === 'elite'
      ? styles.planElite
      : credential?.planTier === 'premium'
        ? styles.planPremium
        : styles.plan;

  return (
    <div className={styles.row}>
      <div className={styles.identity}>
        <span className={styles.fileName} title={displayName}>
          {displayName}
        </span>
        <p className={styles.planLine}>
          <span className={planClass}>{planLabel}</span>
          {credential?.renewsAtMs !== null && credential?.renewsAtMs !== undefined && (
            <>
              <span className={styles.dot} aria-hidden="true">
                ·
              </span>
              <span>{t('quota_management.ledger_renews')}</span>{' '}
              <Countdown atMs={credential.renewsAtMs} nowMs={nowMs} />
            </>
          )}
        </p>
        {entry.type === 'claude' && status === 'success' && claudeReset.message && (
          <p role="status" className={styles.notice}>
            {t(`claude_reset.${claudeReset.message}`)}
          </p>
        )}
      </div>

      <div className={styles.metrics}>
        {status === 'idle' ? (
          <button type="button" className={styles.idle} onClick={onRefresh} disabled={!canRefresh}>
            <IconRefreshCw size={14} aria-hidden="true" />
            <span>{t(`${adapter.i18nPrefix}.idle`)}</span>
          </button>
        ) : loading ? (
          <div className={styles.skeleton} aria-busy="true">
            <span className={styles.srOnly}>{t(`${adapter.i18nPrefix}.loading`)}</span>
            {[0, 1].map((column) => (
              <div key={column} className={styles.skeletonCell} aria-hidden="true">
                <span className={styles.skeletonLabel} />
                <span className={styles.skeletonTrack} />
              </div>
            ))}
          </div>
        ) : status === 'error' ? (
          <div className={styles.errorStrip} role="alert">
            {t(`${adapter.i18nPrefix}.load_failed`, { message: errorMessage })}
          </div>
        ) : credential ? (
          <>
            {credential.message && <p className={styles.message}>{credential.message}</p>}
            {credential.metrics.map((metric) => (
              <MetricCell key={metric.id} metric={metric} nowMs={nowMs} />
            ))}
            {credential.extras.map((extra) => (
              <ExtraCell key={extra.id} extra={extra} nowMs={nowMs} />
            ))}
            {!credential.message &&
              credential.metrics.length === 0 &&
              credential.extras.length === 0 && (
                <p className={styles.message}>{t(`${adapter.i18nPrefix}.empty_windows`)}</p>
              )}
          </>
        ) : (
          <p className={styles.message}>{t(`${adapter.i18nPrefix}.idle`)}</p>
        )}
      </div>

      <div className={styles.actions}>
        {status !== 'idle' && (
          <QuotaEntryActions
            entry={entry}
            actions={actions}
            canRefresh={canRefresh}
            resetting={resetting}
            onRefresh={onRefresh}
            onReset={onReset}
            pillClassName={styles.action}
            spinningClassName={styles.spinning}
          />
        )}
      </div>
    </div>
  );
}

export function QuotaLedger(props: QuotaLedgerProps) {
  const {
    groups,
    quotaFor,
    credentialFor,
    displayNameFor,
    canUseActions,
    resettingKey,
    cacheKeyFor,
    onRefresh,
    onReset,
  } = props;
  const { t } = useTranslation();

  return (
    <div className={styles.ledger} role="list" aria-label={t('quota_management.ledger_aria')}>
      {groups.map((group) => (
        <section key={group.type} className={styles.group}>
          <h2 className={styles.groupTitle}>
            <span>{getTypeLabel(t, group.type)}</span>
            <span className={styles.groupCount}>{group.entries.length}</span>
          </h2>
          <div className={styles.rows}>
            {group.entries.map((entry) => {
              const key = cacheKeyFor(entry);
              return (
                <div key={`${entry.type}:${key}`} role="listitem">
                  <QuotaLedgerRow
                    entry={entry}
                    quota={quotaFor(entry)}
                    credential={credentialFor(entry)}
                    displayName={displayNameFor(entry)}
                    canRefresh={canUseActions && !entry.file.disabled}
                    resetting={resettingKey === key}
                    onRefresh={() => onRefresh(entry)}
                    onReset={() => onReset(entry)}
                  />
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
