/**
 * Antigravity plan label resolution, shared by the card body and the ledger view.
 * React-free so the ledger model tests can consume it directly.
 */

import type { TFunction } from 'i18next';
import type { AntigravityQuotaSubscription } from '@/types';

export const getAntigravityPlanLabel = (
  subscription: AntigravityQuotaSubscription | null | undefined,
  t: TFunction
): string | null => {
  if (!subscription) return null;
  if (subscription.plan === 'free') return t('antigravity_subscription.plan_free');
  if (subscription.plan === 'pro') return t('antigravity_subscription.plan_pro');
  if (subscription.plan === 'ultra') return t('antigravity_subscription.plan_ultra');
  if (subscription.plan === 'ultra-lite') return t('antigravity_subscription.plan_ultra_lite');
  return (
    subscription.tierName ||
    subscription.tierId ||
    (subscription.plan === 'unknown' ? t('antigravity_subscription.plan_unknown') : null)
  );
};

export const isAntigravityPremiumPlan = (
  subscription: AntigravityQuotaSubscription | null | undefined
): boolean => {
  const normalized = subscription?.plan?.toLowerCase() ?? '';
  return normalized === 'ultra' || normalized === 'ultra-lite';
};
