/**
 * xAI plan label resolution, shared by the card body and the ledger view.
 * React-free so the ledger model tests can consume it directly.
 */

import type { TFunction } from 'i18next';
import type { XaiBillingSummary } from '@/types';

export const XAI_SUPERGROK_LIMIT_CENTS = 15_000;
export const XAI_SUPERGROK_HEAVY_LIMIT_CENTS = 150_000;

export const resolveXaiPlan = (
  monthlyLimitCents: number | null
): { labelKey: string; premium: boolean } | null => {
  if (monthlyLimitCents === XAI_SUPERGROK_LIMIT_CENTS) {
    return { labelKey: 'plan_supergrok', premium: false };
  }
  if (monthlyLimitCents === XAI_SUPERGROK_HEAVY_LIMIT_CENTS) {
    return { labelKey: 'plan_supergrok_heavy', premium: true };
  }
  return null;
};

export const resolveXaiPlanLabel = (t: TFunction, billing: XaiBillingSummary): string | null => {
  if (billing.planLabel) return billing.planLabel;
  if (billing.mode === 'paid-health') return t('xai_quota.plan_paid');
  const plan = resolveXaiPlan(billing.monthlyLimitCents);
  return plan ? t(`xai_quota.${plan.labelKey}`) : null;
};

export const resolveXaiPlanTier = (
  billing: XaiBillingSummary
): 'standard' | 'premium' | 'elite' => {
  if (billing.planLabel && billing.planTier) return billing.planTier;
  if (billing.mode === 'paid-health') return 'premium';
  return resolveXaiPlan(billing.monthlyLimitCents)?.premium ? 'premium' : 'standard';
};
