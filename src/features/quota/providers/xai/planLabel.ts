/**
 * xAI plan label resolution, shared by the card body and the ledger view.
 * React-free so the ledger model tests can consume it directly.
 */

import type { TFunction } from 'i18next';
import type { XaiBillingSummary } from '@/types';
import { XAI_SUPERGROK_HEAVY_LIMIT_CENTS, XAI_SUPERGROK_LIMIT_CENTS } from '../../cardTier';

/** Identifies SuperGrok and SuperGrok Heavy by monthly limit when the subscription has no label. */
export const resolveXaiPlanLabelKey = (monthlyLimitCents: number | null): string | null => {
  if (monthlyLimitCents === XAI_SUPERGROK_LIMIT_CENTS) return 'plan_supergrok';
  if (monthlyLimitCents === XAI_SUPERGROK_HEAVY_LIMIT_CENTS) return 'plan_supergrok_heavy';
  return null;
};

export const resolveXaiPlanLabel = (t: TFunction, billing: XaiBillingSummary): string | null => {
  if (billing.planLabel) return billing.planLabel;
  if (billing.mode === 'paid-health') return t('xai_quota.plan_paid');
  const labelKey = resolveXaiPlanLabelKey(billing.monthlyLimitCents);
  return labelKey ? t(`xai_quota.${labelKey}`) : null;
};
