import type { TFunction } from 'i18next';
import type { AnthropicResetGrantStatus } from '@/services/api/claudeResetGrants';
import { parseIsoToMs } from '@/utils/quota';
import { ResetChoicePicker } from '../../components/ResetChoicePicker';
import { sortResetGrants } from './selectResetGrant';

/**
 * Confirmation content for spending a Claude reset grant: the usable grants,
 * soonest expiry first and preselected. `grantId()` reads the choice at
 * confirm time.
 */
export function buildClaudeResetConfirmation(
  t: TFunction,
  name: string,
  status: AnthropicResetGrantStatus,
  now: number
) {
  const grants = sortResetGrants(status, now);
  // Number unlabeled grants as the card's expiry list does, so "Grant 2" here
  // is the same grant as "Grant 2" on the card.
  const listed = status.grants
    .filter((grant) => grant.resetsLeft > 0)
    .sort((a, b) => (parseIsoToMs(a.endsAt) ?? Infinity) - (parseIsoToMs(b.endsAt) ?? Infinity));
  let grantId = grants[0]?.id;
  return {
    message: (
      <ResetChoicePicker
        message={t('claude_reset.choose_message', { name })}
        choices={grants.map((grant) => ({
          id: grant.id,
          expiresAtMs: parseIsoToMs(grant.endsAt),
          label:
            grant.label ||
            t('claude_reset.grant_number', {
              index: listed.findIndex((item) => item.id === grant.id) + 1,
            }),
          details: [t('claude_reset.count', { left: grant.resetsLeft, total: grant.resetsTotal })],
        }))}
        now={now}
        onChange={(id) => {
          grantId = id;
        }}
      />
    ),
    confirmText: t('claude_reset.choose_button'),
    grantId: (): string | undefined => grantId,
  };
}
