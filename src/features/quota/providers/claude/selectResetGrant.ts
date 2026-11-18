import type { AnthropicResetGrant } from '@/services/api/claudeResetGrants';
import { parseIsoToMs } from '@/utils/quota';

/**
 * Grants in the order the reset dialog lists them: soonest expiry first, so a
 * later-expiring grant is never spent while an earlier one lapses. Grants
 * without an expiry go last; ties prefer the upstream recommendation, then
 * stable ID order.
 */
export function sortResetGrants(
  grants: readonly AnthropicResetGrant[],
  nextGrantId: string | null | undefined
): AnthropicResetGrant[] {
  const expiry = (endsAt: string | null) => parseIsoToMs(endsAt) ?? Infinity;
  const rank = (id: string) => (id === nextGrantId ? 0 : 1);
  return [...grants].sort(
    (a, b) =>
      expiry(a.endsAt) - expiry(b.endsAt) ||
      rank(a.id) - rank(b.id) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** The grant the dialog preselects: the first redeemable one in dialog order. */
export function selectResetGrant(
  grants: readonly AnthropicResetGrant[],
  canRedeemGrant: (id: string) => boolean
): string | null {
  return grants.find((grant) => canRedeemGrant(grant.id))?.id ?? null;
}
