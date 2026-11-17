import {
  anthropicResetGrantBlocker,
  type AnthropicResetGrantStatus,
} from '@/services/api/claudeResetGrants';
import { parseIsoToMs } from '@/utils/quota';

/**
 * Grants that can be spent now, soonest expiry first so a later-expiring grant
 * is never spent while an earlier one lapses. Grants without an expiry go last;
 * ties prefer the upstream recommendation, then stable ID order.
 */
export function sortResetGrants(status: AnthropicResetGrantStatus, now: number) {
  if (status.cooldownUntil && Date.parse(status.cooldownUntil) > now) return [];
  const expiry = (endsAt: string | null) => parseIsoToMs(endsAt) ?? Infinity;
  const rank = (id: string) => (id === status.nextGrantId ? 0 : 1);
  return status.grants
    .filter(
      (grant) =>
        !anthropicResetGrantBlocker(status, grant.id) &&
        (!grant.startsAt || Date.parse(grant.startsAt) <= now) &&
        (!grant.endsAt || Date.parse(grant.endsAt) > now)
    )
    .sort(
      (a, b) =>
        expiry(a.endsAt) - expiry(b.endsAt) ||
        rank(a.id) - rank(b.id) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
}

/** The default grant to spend: the usable one that expires first. */
export function selectResetGrant(status: AnthropicResetGrantStatus, now: number) {
  return sortResetGrants(status, now)[0];
}
