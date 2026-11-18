/**
 * The three per-credential actions, styled by the host through class names,
 * and the dialogs they open. Rendered by the card and by every ledger row.
 */

import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import type { QuotaFileEntry } from '../logic';
import { ClaudeResetGrantDialog } from '../providers/claude/ClaudeResetGrantDialog';
import type { QuotaEntryActionState } from '../hooks/useQuotaEntryActions';

export type QuotaEntryActionsProps = {
  entry: QuotaFileEntry;
  actions: QuotaEntryActionState;
  canRefresh: boolean;
  resetting: boolean;
  onRefresh: () => void;
  onReset: () => void;
  pillClassName: string;
  spinningClassName: string;
};

export function QuotaEntryActions(props: QuotaEntryActionsProps) {
  const { entry, actions, canRefresh, resetting, onRefresh, onReset, pillClassName } = props;
  const { spinningClassName } = props;
  const { t } = useTranslation();
  const { claudeReset, showReset, loading, refreshDisabled } = actions;

  return (
    <>
      {entry.type === 'claude' && (
        <button
          type="button"
          className={pillClassName}
          disabled={claudeReset.blocked}
          onClick={claudeReset.openDialog}
          aria-haspopup="dialog"
          title={t(`claude_reset.${claudeReset.buttonLabel}`)}
        >
          <IconRefreshCw size={13} className={claudeReset.busy ? spinningClassName : undefined} />
          {t(`claude_reset.${claudeReset.buttonLabel}`)}
        </button>
      )}
      {showReset && (
        <button
          type="button"
          className={pillClassName}
          onClick={onReset}
          disabled={!canRefresh || loading || resetting}
          title={t('codex_quota.reset_button')}
        >
          <IconRefreshCw size={13} className={resetting ? spinningClassName : undefined} />
          {t('codex_quota.reset_button')}
        </button>
      )}
      <button
        type="button"
        className={pillClassName}
        onClick={onRefresh}
        disabled={refreshDisabled}
        title={t('auth_files.quota_refresh_hint')}
      >
        <IconRefreshCw size={13} className={loading ? spinningClassName : undefined} />
        {t('auth_files.quota_refresh_single')}
      </button>
    </>
  );
}

type QuotaEntryDialogsProps = {
  entry: QuotaFileEntry;
  actions: QuotaEntryActionState;
  name: string;
};

/** Kept outside the action row so a dialog survives the host hiding its actions. */
export function QuotaEntryDialogs({ entry, actions, name }: QuotaEntryDialogsProps) {
  const { claudeReset } = actions;
  if (entry.type !== 'claude') return null;
  return (
    <ClaudeResetGrantDialog
      open={claudeReset.open}
      grants={claudeReset.grants}
      selected={claudeReset.selected}
      canRedeemGrant={claudeReset.canRedeemGrant}
      onSelect={claudeReset.selectGrant}
      busy={claudeReset.busy}
      loading={claudeReset.loading}
      pendingGrantId={claudeReset.pendingGrantId}
      soonestGrantId={claudeReset.soonestGrantId}
      message={claudeReset.message}
      name={name}
      onConfirm={() => void claudeReset.confirm()}
      onClose={claudeReset.closeDialog}
    />
  );
}
