import type { TFunction } from 'i18next';
import type {
  AnthropicResetGrantStatus,
  AnthropicResetWindow,
} from '@/services/api/claudeResetGrants';
import { parseIsoToMs } from '@/utils/quota';
import { ResetChoicePicker } from '../../components/ResetChoicePicker';
import { sortResetGrants } from './selectResetGrant';

/** The quota card's names for the limits a grant clears. */
const WINDOW_LABEL_KEYS: Record<AnthropicResetWindow, string> = {
  five_hour: 'claude_quota.five_hour',
  seven_day: 'claude_quota.seven_day',
  seven_day_overage_included: 'claude_quota.seven_day_fable',
};

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
          details: [
            ...(grant.clears.length > 0
              ? [
                  t('claude_reset.clears', {
                    windows: grant.clears.map((window) => t(WINDOW_LABEL_KEYS[window])).join(' + '),
                  }),
                ]
              : []),
            // Every listed grant has a reset left, so the count only helps multi-use grants.
            ...(grant.resetsTotal > 1
              ? [t('claude_reset.count', { left: grant.resetsLeft, total: grant.resetsTotal })]
              : []),
          ],
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
