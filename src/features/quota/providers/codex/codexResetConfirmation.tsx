import type { TFunction } from 'i18next';
import type { CodexRateLimitResetCredit } from '@/types';
import { sortCodexResetCredits } from '@/utils/quota';
import { ResetChoicePicker } from '../../components/ResetChoicePicker';
import type { QuotaCardState } from '../index';

/**
 * Confirmation content for a Codex reset. With known credits it lists them,
 * soonest expiry first and preselected; `creditId()` reads the choice at
 * confirm time. Without them it keeps the plain message, and the reset falls
 * back to the soonest-expiring credit it can read.
 */
export function buildCodexResetConfirmation(
  t: TFunction,
  name: string,
  quota: QuotaCardState | undefined,
  now: number
) {
  const stored =
    quota && 'rateLimitResetCredits' in quota
      ? (quota.rateLimitResetCredits as CodexRateLimitResetCredit[] | undefined)
      : undefined;
  const credits = sortCodexResetCredits(stored ?? [], now);
  if (credits.length === 0) {
    return {
      message: t('codex_quota.reset_confirm_message', { name }),
      confirmText: t('codex_quota.reset_confirm_button'),
      creditId: (): string | undefined => undefined,
    };
  }
  let creditId = credits[0].id;
  return {
    message: (
      <ResetChoicePicker
        message={t('codex_quota.reset_choose_message', { name })}
        choices={credits.map((credit) => ({ id: credit.id, expiresAtMs: credit.expiresAtMs }))}
        now={now}
        onChange={(id) => {
          creditId = id;
        }}
      />
    ),
    confirmText: t('codex_quota.reset_choose_button'),
    creditId: (): string | undefined => creditId,
  };
}
