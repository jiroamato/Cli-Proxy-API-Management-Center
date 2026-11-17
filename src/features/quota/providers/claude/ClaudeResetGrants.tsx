import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import { useAuthStore } from '@/stores/useAuthStore';
import { useNotificationStore } from '@/stores';
import { apiClient } from '@/services/api/client';
import {
  readClaudeResetGrants,
  type AnthropicResetGrantStatus,
} from '@/services/api/claudeResetGrants';
import type { AuthFileItem } from '@/types';
import { normalizeAuthIndex } from '@/utils/quota';
import { resetGrantOperations, RETRY_WINDOW_MS } from './resetGrantOperations';
import { selectResetGrant } from './selectResetGrant';
import { buildClaudeResetConfirmation } from './claudeResetConfirmation';

/** Card-owned reads; the session-scoped journal owns spending and ambiguous retries. */
export function useClaudeResetGrants(
  file: AuthFileItem,
  enabled: boolean,
  disabled: boolean,
  refreshToken: unknown,
  onRefresh: () => void
) {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const [session] = useState(() => apiClient.getConnectionRevision());
  const sessionActive =
    connectionStatus === 'connected' && session === apiClient.getConnectionRevision();
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const now = useNow();
  const authIndex = normalizeAuthIndex(file.auth_index ?? file.authIndex);
  const key = JSON.stringify([file.name, authIndex]);
  const [status, setStatus] = useState<AnthropicResetGrantStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  const lock = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    const version = ++generation.current;
    setStatus(null);
    if (!enabled || disabled || !sessionActive || !authIndex) return;
    let cancelled = false;
    const current = () =>
      !cancelled && version === generation.current && session === apiClient.getConnectionRevision();
    void readClaudeResetGrants(authIndex).then(
      (result) => {
        if (current()) {
          setStatus(result);
          setMessage('');
        }
      },
      () => {
        if (current()) setMessage('read_error');
      }
    );
    return () => {
      cancelled = true;
      generation.current += 1;
    };
  }, [authIndex, key, enabled, disabled, sessionActive, session, refreshToken, reload]);

  const operation = resetGrantOperations.inspect(key);
  const pending = operation && !operation.code ? operation : undefined;
  const expired = Boolean(pending && now - pending.createdAt >= RETRY_WINDOW_MS);
  const selected = pending?.grantId ?? (status ? selectResetGrant(status, now)?.id : undefined);
  const blocked = disabled || !sessionActive || !authIndex || busy || expired || !selected;
  const confirm = () => {
    if (blocked || lock.current || !selected || !authIndex) return;
    const version = generation.current;
    const current = () =>
      session === apiClient.getConnectionRevision() && version === generation.current;
    // A retry must reuse the ambiguous claim's grant, so only a fresh claim offers a choice.
    const confirmation = pending
      ? {
          message: t('claude_reset.retry_confirm', { name: file.name }),
          confirmText: t('claude_reset.retry'),
          grantId: (): string | undefined => pending.grantId,
        }
      : status && buildClaudeResetConfirmation(t, file.name, status, now);
    if (!confirmation) return;
    showConfirmation({
      title: t('claude_reset.title'),
      message: confirmation.message,
      confirmText: confirmation.confirmText,
      variant: 'primary',
      onConfirm: async () => {
        if (!current() || lock.current || useAuthStore.getState().connectionStatus !== 'connected')
          return;
        const grantId = confirmation.grantId();
        if (!grantId) return;
        lock.current = true;
        setBusy(true);
        try {
          const answer = await resetGrantOperations.run(key, authIndex, grantId);
          if (!current()) return;
          showNotification(
            t(`claude_reset.${answer.unresolved ? 'unknown' : answer.code}`),
            !answer.unresolved && (answer.code === 'reset' || answer.code === 'already_used')
              ? 'success'
              : 'error'
          );
        } catch {
          if (!current()) return;
          const unresolved = resetGrantOperations.inspect(key);
          showNotification(
            t(`claude_reset.${unresolved && !unresolved.code ? 'unknown' : 'blocked'}`),
            'error'
          );
        } finally {
          lock.current = false;
          // A concurrent page-wide refresh can invalidate this read generation.
          // Release the local lock regardless, but never refresh a replacement account.
          setBusy(false);
          setReload((value) => value + 1);
          if (current()) onRefresh();
        }
      },
    });
  };
  return {
    count: status?.grants.reduce((sum, grant) => sum + grant.resetsLeft, 0) ?? null,
    grants: status?.grants ?? [],
    busy,
    blocked,
    confirm,
    message: pending ? (expired ? 'expired' : 'unknown') : message,
    buttonLabel: pending ? 'retry' : 'use',
  };
}
