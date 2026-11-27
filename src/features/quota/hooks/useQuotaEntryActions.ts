/**
 * Per-credential action state shared by the card grid and the ledger rows.
 *
 * Both hosts render the same three actions (Claude reset grant, provider
 * reset, refresh) with the same enablement rules, so the rules live here once
 * and the hosts only decide where the buttons go.
 */

import { QUOTA_ADAPTERS, type QuotaAdapter, type QuotaCardState } from '../providers';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import { useClaudeResetGrants } from '../providers/claude/ClaudeResetGrants';

export interface QuotaEntryActionState {
  adapter: QuotaAdapter;
  status: QuotaCardState['status'];
  loading: boolean;
  claudeReset: ReturnType<typeof useClaudeResetGrants>;
  showReset: boolean;
  refreshDisabled: boolean;
}

export function useQuotaEntryActions(
  entry: QuotaFileEntry,
  quota: QuotaCardState | undefined,
  canRefresh: boolean,
  resetting: boolean,
  onRefresh: () => void
): QuotaEntryActionState {
  const adapter = QUOTA_ADAPTERS[entry.type];
  const status = quota?.status ?? 'idle';
  const loading = status === 'loading';
  const claudeReset = useClaudeResetGrants(
    entry.file,
    entry.type === 'claude' && status !== 'idle',
    !canRefresh || loading || resetting,
    quota,
    onRefresh
  );
  const showReset =
    status === 'success' &&
    Boolean(adapter.resetQuota) &&
    quota !== undefined &&
    Boolean(adapter.canResetQuota?.(quota));
  const refreshDisabled = isQuotaRefreshDisabled(
    canRefresh,
    loading,
    resetting || claudeReset.busy
  );

  return { adapter, status, loading, claudeReset, showReset, refreshDisabled };
}
