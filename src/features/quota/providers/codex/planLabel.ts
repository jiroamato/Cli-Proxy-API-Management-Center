/**
 * Codex plan label resolution, shared by the card body and the ledger view.
 * React-free so the ledger model tests can consume it directly.
 */

import type { TFunction } from 'i18next';
import {
  BUSINESS_PREMIUM_CODEX_PLAN_TYPE,
  PRO_CODEX_PLAN_TYPE,
  PRO_LITE_CODEX_PLAN_TYPES,
  PRO_MAX_CODEX_PLAN_TYPES,
  normalizePlanType,
} from '@/utils/quota';

export const getCodexPlanLabel = (t: TFunction, planType?: string | null): string | null => {
  const normalized = normalizePlanType(planType);
  if (!normalized) return null;
  if (normalized === BUSINESS_PREMIUM_CODEX_PLAN_TYPE) {
    return t('codex_quota.plan_business_premium');
  }
  if (PRO_MAX_CODEX_PLAN_TYPES.has(normalized)) return t('codex_quota.plan_promax');
  if (normalized === PRO_CODEX_PLAN_TYPE) return t('codex_quota.plan_pro');
  if (PRO_LITE_CODEX_PLAN_TYPES.has(normalized)) return t('codex_quota.plan_prolite');
  if (normalized === 'plus') return t('codex_quota.plan_plus');
  if (normalized === 'team') return t('codex_quota.plan_team');
  if (normalized === 'free') return t('codex_quota.plan_free');
  return planType || normalized;
};
