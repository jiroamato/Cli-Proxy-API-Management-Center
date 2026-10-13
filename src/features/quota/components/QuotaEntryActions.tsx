/**
 * The three per-credential actions, styled by the host through class names.
 * Rendered by the card footer and by every ledger row.
 */

import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import type { QuotaFileEntry } from '../logic';
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
          onClick={claudeReset.confirm}
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
