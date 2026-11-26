import { QuotaErrorMessage } from '@/features/quota/components/QuotaErrorMessage';
import { ProviderArtwork } from '@/components/common/ProviderArtwork';
/**
 * Provider quota card: identity, loading/error state, quota body, and actions.
 * Claude observations remain visible while refreshing or after a failed read.
 */

import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown, IconRefreshCw } from '@/components/ui/icons';
import type { ClaudeQuotaState, CodexQuotaState, ResolvedTheme } from '@/types';
import { getQuotaDisplayName } from '@/utils/quota/identity';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import { bindQuotaClasses } from '../types';
import type { QuotaCardState } from '../providers';
import { getQuotaProviderKey, type QuotaFileEntry } from '../logic';
import { useQuotaEntryActions } from '../hooks/useQuotaEntryActions';
import { ClaudeResetGrantDetails } from '../providers/claude/ClaudeResetGrantDetails';
import { hasClaudeUsageData } from '../providers/claude/data';
import { CodexCreditOverageDialog } from '../providers/codex/CodexCreditOverageDialog';
import { CodexCreditOverageRow } from '../providers/codex/CodexCreditOverageRow';
import { useCodexCreditOverage } from '../providers/codex/useCodexCreditOverage';
import { QuotaEntryActions, QuotaEntryDialogs } from './QuotaEntryActions';
import bodyStyles from './QuotaBody.module.scss';
import styles from './QuotaCard.module.scss';

/** Bind the quota-page styles to the shared rendering contract. */
const quotaClasses = bindQuotaClasses(bodyStyles, 'QuotaBody.module.scss');

export type QuotaCardProps = {
  entry: QuotaFileEntry;
  quota?: QuotaCardState;
  resolvedTheme: ResolvedTheme;
  canRefresh: boolean;
  resetting: boolean;
  /** Name shown on the card; defaults to the identity-aware display name. */
  displayName?: string;
  /** Initial cascade delay; null disables entrance motion for later mounts. */
  entranceDelayMs?: number | null;
  /**
   * Compact layout only: true shows the glance card (name, plan, one line per limit),
   * false the full card. Undefined (other layouts) shows the full card with no toggle.
   */
  glance?: boolean;
  onToggleGlance?: () => void;
  /** Codex only: credentials in the panel sharing this account user's credit setting. */
  creditOverageSharedCount?: number;
  onRefresh: () => void;
  onReset: () => void;
};

export function QuotaCard(props: QuotaCardProps) {
  const {
    entry,
    quota,
    resolvedTheme,
    canRefresh,
    resetting,
    entranceDelayMs,
    glance,
    onToggleGlance,
    creditOverageSharedCount = 1,
    onRefresh,
    onReset,
  } = props;
  const { t } = useTranslation();
  const file = entry.file;
  const retainedClaudeUsage =
    entry.type === 'claude' && hasClaudeUsageData(quota as ClaudeQuotaState | undefined);
  const displayName = props.displayName ?? getQuotaDisplayName(file);

  // Capture the entrance delay only at mount, without a render-time ref read.
  const [mountEntranceDelayMs] = useState<number | null>(entranceDelayMs ?? null);
  const entranceStyle =
    mountEntranceDelayMs === null
      ? undefined
      : ({ '--card-delay': `${mountEntranceDelayMs}ms` } as CSSProperties);

  const actions = useQuotaEntryActions(entry, quota, canRefresh, resetting, onRefresh);
  const { adapter, status, loading, claudeReset, errorMessage } = actions;
  const providerType = getQuotaProviderKey(entry);
  const iconSrc = getAuthFileIcon(providerType, resolvedTheme);
  const typeLabel = getTypeLabel(t, providerType);
  // Claude banked resets join the plan chip row; their expiry list follows it.
  const showClaudeReset = entry.type === 'claude' && status === 'success';
  const claudePlanItems = showClaudeReset ? (
    <span className={quotaClasses.codexPlanItem}>
      <span className={quotaClasses.codexPlanLabel}>{t('claude_reset.remaining')}</span>
      <span className={quotaClasses.codexPlanValue}>{claudeReset.count ?? '--'}</span>
    </span>
  ) : undefined;
  const claudeAfterPlan = showClaudeReset ? (
    <>
      <ClaudeResetGrantDetails grants={claudeReset.grants} classes={quotaClasses} />
      {claudeReset.message && (
        <div role="status" className={quotaClasses.codexResetCreditsError}>
          {t(`claude_reset.${claudeReset.message}`)}
        </div>
      )}
    </>
  ) : undefined;
  const creditOverage = useCodexCreditOverage(
    file,
    entry.type === 'codex' ? (quota as CodexQuotaState | undefined) : undefined,
    !canRefresh || loading || resetting
  );
  const codexAfterPlan = creditOverage.visible ? (
    <CodexCreditOverageRow
      entry={creditOverage.entry}
      classes={quotaClasses}
      disabled={creditOverage.blocked}
      name={displayName}
      onManage={creditOverage.openDialog}
    />
  ) : undefined;

  return (
    <article
      className={`${styles.card} ${mountEntranceDelayMs === null ? '' : styles.cardEnter} ${
        glance ? styles.cardGlance : ''
      }`}
      style={entranceStyle}
      data-quota-glance={glance ? '' : undefined}
    >
      <header className={styles.head}>
        <span
          className={styles.iconWrap}
          title={typeLabel}
          style={
            isThemeSurfaceIconProvider(providerType)
              ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
              : undefined
          }
        >
          <ProviderArtwork provider={providerType} src={iconSrc} className={styles.icon}>
            <span className={styles.iconFallback}>{typeLabel.slice(0, 1).toUpperCase()}</span>
          </ProviderArtwork>
        </span>
        <span className={styles.fileName} title={displayName}>
          {displayName}
        </span>
        {glance !== undefined && (
          <button
            type="button"
            className={styles.glanceToggle}
            onClick={onToggleGlance}
            aria-expanded={!glance}
            aria-label={`${t(glance ? 'card_layout.show_details' : 'card_layout.hide_details')}: ${displayName}`}
            title={t(glance ? 'card_layout.show_details' : 'card_layout.hide_details')}
          >
            <IconChevronDown size={14} />
          </button>
        )}
      </header>

      <div className={styles.body}>
        {status === 'idle' ? (
          <button
            type="button"
            className={styles.idleBody}
            onClick={onRefresh}
            disabled={!canRefresh}
          >
            <IconRefreshCw size={15} aria-hidden="true" className={styles.idleGlyph} />
            <span className={styles.idleHint}>{t(`${adapter.i18nPrefix}.idle`)}</span>
          </button>
        ) : loading && !retainedClaudeUsage ? (
          <div className={styles.skeleton} aria-busy="true">
            <span className={styles.srOnly}>{t(`${adapter.i18nPrefix}.loading`)}</span>
            {[0, 1].map((row) => (
              <div key={row} className={styles.skeletonRow} aria-hidden="true">
                <span className={styles.skeletonLabel} />
                <span className={styles.skeletonTrack} />
              </div>
            ))}
          </div>
        ) : status === 'error' && quota ? (
          <div className={styles.errorStrip} role="alert">
            <QuotaErrorMessage quota={quota} i18nPrefix={adapter.i18nPrefix} />
          </div>
        ) : quota && !retainedClaudeUsage ? (
          <adapter.Body
            quota={quota}
            classes={quotaClasses}
            planItems={claudePlanItems}
            afterPlan={entry.type === 'codex' ? codexAfterPlan : claudeAfterPlan}
          />
        ) : !retainedClaudeUsage ? (
          <div className={styles.idleHint}>{t(`${adapter.i18nPrefix}.idle`)}</div>
        ) : null}
        {loading && retainedClaudeUsage && (
          <div role="status" aria-busy="true" className={quotaClasses.quotaMessage}>
            {t(`${adapter.i18nPrefix}.loading`)}
          </div>
        )}
        {retainedClaudeUsage && quota && (
          <adapter.Body
            quota={quota}
            classes={quotaClasses}
            planItems={claudePlanItems}
            afterPlan={claudeAfterPlan}
          />
        )}
      </div>

      {status !== 'idle' && !glance && (
        <footer className={styles.actionRow}>
          <QuotaEntryActions
            entry={entry}
            actions={actions}
            canRefresh={canRefresh}
            resetting={resetting}
            onRefresh={onRefresh}
            onReset={onReset}
            pillClassName={styles.actionPill}
            spinningClassName={styles.spinning}
          />
        </footer>
      )}
      <QuotaEntryDialogs entry={entry} actions={actions} name={displayName} />
      {creditOverage.context && (
        <CodexCreditOverageDialog
          open={creditOverage.open}
          context={creditOverage.context}
          entry={creditOverage.entry}
          operation={creditOverage.operation}
          writeDisabled={creditOverage.writeDisabled}
          contextCurrent={creditOverage.contextCurrent}
          sharedCredentialCount={creditOverageSharedCount}
          selection={creditOverage.selection}
          pendingTarget={creditOverage.pendingTarget}
          feedback={creditOverage.feedback}
          onSelect={creditOverage.selectValue}
          onSave={() => void creditOverage.save()}
          onClose={creditOverage.closeDialog}
        />
      )}
    </article>
  );
}
