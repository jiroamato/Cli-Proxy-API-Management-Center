/**
 * Ledger view model: one normalized shape for every provider's quota state.
 *
 * The card grid lets each provider render its own body. The ledger and the
 * provider summary strip instead read every provider through the same
 * `LedgerCredential` shape so rows line up and totals can be summed.
 *
 * React-free / SCSS-free: consumed directly by tests/quotaLedgerModel.test.ts.
 */

import type { TFunction } from 'i18next';
import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  DevinQuotaState,
  KimiQuotaState,
  MetaQuotaState,
  XaiQuotaState,
} from '@/types';
import {
  formatInstantShort,
  formatRelativeInstant,
  parseIsoToMs,
  resolvePlanTier,
  resolveResetMs,
} from '@/utils/quota';
import type { QuotaCardState } from '../providers';
import type { QuotaProviderType } from '../providers/types';
import {
  getAntigravityPlanLabel,
  isAntigravityPremiumPlan,
} from '../providers/antigravity/planLabel';
import { getCodexPlanLabel } from '../providers/codex/planLabel';
import { resolveXaiPlanLabel, resolveXaiPlanTier } from '../providers/xai/planLabel';
import { XAI_WEEKLY_ROW_ID, resetCreditRowId } from '../resetSchedule';

export type LedgerPlanTier = 'standard' | 'premium' | 'elite';

export interface LedgerMetric {
  /** Stable per-provider id; the summary strip groups credentials by it. */
  id: string;
  label: string;
  /** Remaining capacity 0-100; null when the provider reports no usable number. */
  remainingPercent: number | null;
  resetAtMs: number | null;
  /** Provider-baked reset label, used only when no instant is available. */
  resetLabel: string | null;
  /** Window length in hours; null when unknown. */
  periodHours: number | null;
}

/** A line under an extra block: free text, optionally followed by a countdown. */
export interface LedgerExtraLine {
  id: string;
  text: string;
  atMs: number | null;
}

/** Provider-specific block beside the metric columns (Codex manual resets, xAI credits). */
export interface LedgerExtra {
  id: string;
  title: string;
  value: string;
  valueSuffix: string | null;
  lines: LedgerExtraLine[];
}

export interface LedgerCredential {
  plan: string | null;
  planTier: LedgerPlanTier;
  /** Subscription renewal instant shown beside the plan; null when unknown. */
  renewsAtMs: number | null;
  metrics: LedgerMetric[];
  extras: LedgerExtra[];
  /** Provider message shown instead of metrics (e.g. xAI paid-health). */
  message: string | null;
}

/** Windows shorter than a day (5-hour sessions) stay out of the provider summary. */
const SUMMARY_MIN_PERIOD_HOURS = 24;

/**
 * Metric ids that lead the row for a provider. Claude's model-scoped weekly
 * window is the one that actually gates Fable/Opus usage, so it reads first.
 */
const LEADING_METRIC_IDS: Partial<Record<QuotaProviderType, readonly string[]>> = {
  claude: ['seven-day-fable', 'seven-day-opus', 'seven-day-sonnet'],
};

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));

const remainingFromUsed = (used: number | null | undefined): number | null =>
  typeof used === 'number' && Number.isFinite(used) ? clampPercent(100 - used) : null;

const usableMs = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const usableLabel = (value: string | null | undefined): string | null => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed && trimmed !== '-' ? trimmed : null;
};

const formatUsdFromCents = (cents: number | null): string => {
  if (cents === null) return '--';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(
    cents / 100
  );
};

export function orderLedgerMetrics(
  type: QuotaProviderType,
  metrics: LedgerMetric[]
): LedgerMetric[] {
  const leading = LEADING_METRIC_IDS[type];
  if (!leading || leading.length === 0) return metrics;
  const rank = (metric: LedgerMetric) => {
    const index = leading.indexOf(metric.id);
    return index === -1 ? leading.length : index;
  };
  return metrics
    .map((metric, index) => ({ metric, index }))
    .sort((a, b) => rank(a.metric) - rank(b.metric) || a.index - b.index)
    .map(({ metric }) => metric);
}

const buildClaude = (quota: ClaudeQuotaState, t: TFunction): LedgerCredential => {
  const extras: LedgerExtra[] = [];
  const extraUsage = quota.extraUsage ?? null;
  if (extraUsage && extraUsage.is_enabled) {
    extras.push({
      id: 'claude:extra-usage',
      title: t('claude_quota.extra_usage_label'),
      value: `$${(extraUsage.used_credits / 100).toFixed(2)}`,
      valueSuffix: `/ $${(extraUsage.monthly_limit / 100).toFixed(2)}`,
      lines: [],
    });
  }
  return {
    plan: quota.planType ? t(`claude_quota.${quota.planType}`) : null,
    planTier: 'standard',
    renewsAtMs: null,
    message: null,
    extras,
    metrics: orderLedgerMetrics(
      'claude',
      (quota.windows ?? []).map((window) => ({
        id: window.id,
        label: window.labelKey ? t(window.labelKey) : window.label,
        remainingPercent: remainingFromUsed(window.usedPercent),
        resetAtMs: usableMs(window.resetAtMs),
        resetLabel: usableLabel(window.resetLabel),
        periodHours: window.periodHours ?? null,
      }))
    ),
  };
};

const buildCodex = (quota: CodexQuotaState, t: TFunction): LedgerCredential => {
  const tier = resolvePlanTier(quota.planType ?? null);
  const extras: LedgerExtra[] = [];
  const availableCount = quota.rateLimitResetCreditsAvailableCount ?? null;
  const credits = quota.rateLimitResetCredits ?? [];
  if (availableCount !== null || credits.length > 0) {
    extras.push({
      id: 'codex:manual-resets',
      title: t('codex_quota.reset_credits_label'),
      value: String(availableCount ?? credits.length),
      valueSuffix: t('quota_management.ledger_available'),
      lines: credits.map((credit, index) => ({
        id: resetCreditRowId(credit, index),
        text: t('codex_quota.reset_credit_number', { index: index + 1 }),
        atMs: parseIsoToMs(credit.expiresAt),
      })),
    });
  }
  return {
    plan: getCodexPlanLabel(t, quota.planType),
    planTier: tier === 'elite' ? 'elite' : tier === 'premium' ? 'premium' : 'standard',
    renewsAtMs: resolveResetMs([quota.subscriptionActiveUntil ?? null]),
    message: null,
    extras,
    metrics: (quota.windows ?? []).map((window) => ({
      id: window.id,
      label: window.labelKey
        ? t(window.labelKey, window.labelParams as Record<string, string | number>)
        : window.label,
      remainingPercent: remainingFromUsed(window.usedPercent),
      resetAtMs: usableMs(window.resetAtMs),
      resetLabel: usableLabel(window.resetLabel),
      periodHours: window.periodHours ?? null,
    })),
  };
};

const buildXai = (quota: XaiQuotaState, t: TFunction): LedgerCredential | null => {
  const billing = quota.billing;
  if (!billing) return null;
  const plan = resolveXaiPlanLabel(t, billing);
  const planTier = resolveXaiPlanTier(billing);
  if (billing.mode === 'paid-health') {
    return {
      plan,
      planTier,
      renewsAtMs: null,
      metrics: [],
      extras: [],
      message: t('xai_quota.paid_health'),
    };
  }

  const metrics: LedgerMetric[] = [];
  const hasWeeklyData =
    billing.periodType === 'weekly' &&
    (billing.usagePercent !== null ||
      Boolean(billing.periodEnd) ||
      billing.productUsage.length > 0);
  if (hasWeeklyData) {
    metrics.push({
      id: XAI_WEEKLY_ROW_ID,
      label: t('xai_quota.weekly_limit'),
      remainingPercent: remainingFromUsed(billing.usagePercent),
      resetAtMs: usableMs(billing.resetAtMs),
      resetLabel: null,
      periodHours: billing.periodHours ?? 168,
    });
  }
  billing.productUsage.forEach((item) => {
    metrics.push({
      id: `xai:product:${item.product}`,
      label: t('xai_quota.product_usage', { product: item.product }),
      remainingPercent: remainingFromUsed(item.usagePercent),
      resetAtMs: usableMs(billing.resetAtMs),
      resetLabel: null,
      periodHours: billing.periodHours ?? 168,
    });
  });
  const onDemandCap = billing.onDemandCapCents ?? 0;
  if (onDemandCap > 0) {
    metrics.push({
      id: 'xai:on-demand',
      label: t('xai_quota.pay_as_you_go_label'),
      remainingPercent: remainingFromUsed(billing.onDemandUsedPercent),
      resetAtMs: null,
      resetLabel: null,
      periodHours: null,
    });
  }

  const extras: LedgerExtra[] = [];
  const hasMonthlyData =
    (billing.monthlyLimitCents !== null ||
      billing.usedCents !== null ||
      Boolean(billing.billingPeriodEnd)) &&
    !(hasWeeklyData && billing.monthlyLimitCents === 0 && billing.usedCents === 0);
  if (hasMonthlyData || onDemandCap === 0) {
    const remainingCents =
      billing.monthlyLimitCents !== null && billing.includedUsedCents !== null
        ? Math.max(0, billing.monthlyLimitCents - billing.includedUsedCents)
        : null;
    const lines: LedgerExtraLine[] = [];
    if (onDemandCap === 0) {
      lines.push({
        id: 'xai:on-demand-disabled',
        text: `${t('xai_quota.pay_as_you_go_label')}: ${t('xai_quota.pay_as_you_go_disabled')}`,
        atMs: null,
      });
    }
    const monthlyResetMs = parseIsoToMs(billing.billingPeriodEnd);
    if (monthlyResetMs !== null) {
      lines.push({
        id: 'xai:monthly-reset',
        text: t('xai_quota.resets_label'),
        atMs: monthlyResetMs,
      });
    }
    extras.push({
      id: 'xai:monthly',
      title: t('xai_quota.monthly_credits'),
      value: formatUsdFromCents(remainingCents),
      valueSuffix:
        billing.monthlyLimitCents === null
          ? null
          : `/ ${formatUsdFromCents(billing.monthlyLimitCents)}`,
      lines,
    });
  }
  return { plan, planTier, renewsAtMs: null, metrics, extras, message: null };
};

const buildKimi = (quota: KimiQuotaState, t: TFunction): LedgerCredential => ({
  plan: null,
  planTier: 'standard',
  renewsAtMs: null,
  message: null,
  extras: [],
  metrics: (quota.rows ?? []).map((row) => {
    const remaining =
      row.limit > 0
        ? clampPercent(Math.round(((row.limit - row.used) / row.limit) * 100))
        : row.used > 0
          ? 0
          : null;
    return {
      id: row.id,
      label: row.labelKey
        ? t(row.labelKey, (row.labelParams ?? {}) as Record<string, string | number>)
        : (row.label ?? ''),
      remainingPercent: remaining,
      resetAtMs: usableMs(row.resetAtMs),
      resetLabel: usableLabel(row.resetHint),
      periodHours: row.periodHours ?? null,
    };
  }),
});

const buildAntigravity = (quota: AntigravityQuotaState, t: TFunction): LedgerCredential => ({
  plan: getAntigravityPlanLabel(quota.subscription, t),
  planTier: isAntigravityPremiumPlan(quota.subscription) ? 'premium' : 'standard',
  renewsAtMs: null,
  message: null,
  extras: [],
  metrics: (quota.groups ?? []).flatMap((group) =>
    group.buckets.map((bucket) => ({
      id: `${group.id}:${bucket.id}`,
      label: group.label ? `${group.label} · ${bucket.label}` : bucket.label,
      remainingPercent: Number.isFinite(bucket.remainingFraction)
        ? clampPercent(bucket.remainingFraction * 100)
        : null,
      resetAtMs: usableMs(bucket.resetAtMs),
      resetLabel: null,
      periodHours: bucket.periodHours ?? null,
    }))
  ),
});

const buildDevin = (quota: DevinQuotaState, t: TFunction): LedgerCredential => ({
  plan: quota.plan ?? null,
  planTier: 'standard',
  renewsAtMs: usableMs(quota.planEndMs),
  message: null,
  extras: [],
  metrics: (quota.windows ?? []).map((window) => ({
    id: window.id,
    label: t(`devin_quota.${window.id}`),
    remainingPercent:
      window.remainingPercent === null ? null : clampPercent(window.remainingPercent),
    resetAtMs: usableMs(window.resetAtMs),
    resetLabel: null,
    periodHours: window.periodHours,
  })),
});

const buildMeta = (quota: MetaQuotaState, t: TFunction): LedgerCredential | null => {
  const data = quota.data;
  if (!data) return null;
  return {
    plan: data.planName ?? null,
    planTier: 'standard',
    renewsAtMs: null,
    message: null,
    extras: [],
    metrics: data.windows.map((window) => ({
      id: window.id,
      label:
        window.id === 'window' && window.durationMinutes
          ? t('meta_quota.window_duration', { minutes: window.durationMinutes })
          : t(`meta_quota.${window.id}`),
      remainingPercent: remainingFromUsed(window.usedPercent),
      resetAtMs: window.resetAt === undefined ? null : window.resetAt * 1000,
      resetLabel: null,
      periodHours:
        window.id === 'weekly' ? 168 : window.durationMinutes ? window.durationMinutes / 60 : null,
    })),
  };
};

/** Null for anything but a successful load; the row renders its status instead. */
export function buildLedgerCredential(
  type: QuotaProviderType,
  quota: QuotaCardState | undefined,
  t: TFunction
): LedgerCredential | null {
  if (!quota || quota.status !== 'success') return null;
  switch (type) {
    case 'claude':
      return buildClaude(quota as ClaudeQuotaState, t);
    case 'codex':
      return buildCodex(quota as CodexQuotaState, t);
    case 'xai':
      return buildXai(quota as XaiQuotaState, t);
    case 'kimi':
      return buildKimi(quota as KimiQuotaState, t);
    case 'antigravity':
      return buildAntigravity(quota as AntigravityQuotaState, t);
    case 'devin':
      return buildDevin(quota as DevinQuotaState, t);
    case 'meta':
      return buildMeta(quota as MetaQuotaState, t);
    default:
      return null;
  }
}

/* ---------- Reset labels ---------- */

export interface LedgerResetDisplay {
  /** Countdown such as "in 1 day"; null when only a baked label was available. */
  relative: string | null;
  absolute: string;
}

/**
 * `in 1 day · 09/13, 13:00`: the countdown leads because it is what the
 * reader reacts to; the instant follows for planning. Null means nothing is
 * pending and the caller renders its "no reset" copy.
 */
export function describeLedgerReset(
  metric: Pick<LedgerMetric, 'resetAtMs' | 'resetLabel'>,
  nowMs: number,
  locale?: string
): LedgerResetDisplay | null {
  if (metric.resetAtMs !== null) {
    return {
      relative: formatRelativeInstant(metric.resetAtMs, nowMs, locale),
      absolute: formatInstantShort(metric.resetAtMs),
    };
  }
  if (metric.resetLabel) return { relative: null, absolute: metric.resetLabel };
  return null;
}

/* ---------- Identity masking ---------- */

/**
 * Hide the account in a credential filename while keeping it recognisable:
 * `claude-ab12-tom@lab.dev.json` becomes `claude-ab12-t•••@l•••.dev.json`.
 *
 * The local part stops at the last `-` so provider/hash prefixes survive;
 * only the first label of the domain is masked so the TLD still hints at the
 * organisation. Applied to display strings only: cache keys and API calls
 * keep the real name.
 */
const EMAIL_PATTERN = /([A-Za-z0-9._%+]+)@([A-Za-z0-9-]+)((?:\.[A-Za-z0-9-]+)*)/g;

export function maskEmails(text: string): string {
  return text.replace(
    EMAIL_PATTERN,
    (_match, local: string, domain: string, rest: string) =>
      `${local.charAt(0)}•••@${domain.charAt(0)}•••${rest}`
  );
}

/* ---------- Provider summary ---------- */

export interface SummaryMetric {
  id: string;
  label: string;
  /** Sum of remaining % across loaded credentials carrying this metric; null when none. */
  totalRemaining: number | null;
  /** Credential count × 100: what the sum would be with every window untouched. */
  capacity: number;
  /** One slot per credential in group order; null = not loaded or no such window. */
  segments: (number | null)[];
  soonestResetMs: number | null;
}

export interface ProviderSummary {
  type: QuotaProviderType;
  count: number;
  loadedCount: number;
  headline: SummaryMetric | null;
  secondary: SummaryMetric[];
}

const isSummaryWindow = (metric: LedgerMetric): boolean =>
  metric.periodHours === null || metric.periodHours >= SUMMARY_MIN_PERIOD_HOURS;

/**
 * Roll one provider's credentials up into a headline window plus collapsible
 * secondary windows.
 *
 * Only day-or-longer windows take part: a 5-hour session recovers before the
 * reader has finished comparing accounts, so it would only add noise. The
 * headline is the first such window in row order (after `orderLedgerMetrics`),
 * which puts Claude's model-scoped weekly limit on top. Credentials that have
 * not loaded contribute an empty segment and nothing to the sum, so the total
 * is always "of what we know" rather than an invented number.
 */
export function buildProviderSummary(
  type: QuotaProviderType,
  credentials: ReadonlyArray<LedgerCredential | null>
): ProviderSummary {
  const count = credentials.length;
  const loaded = credentials.filter((credential): credential is LedgerCredential =>
    Boolean(credential)
  );

  const order: string[] = [];
  const labels = new Map<string, string>();
  loaded.forEach((credential) => {
    credential.metrics.filter(isSummaryWindow).forEach((metric) => {
      if (!labels.has(metric.id)) {
        order.push(metric.id);
        labels.set(metric.id, metric.label);
      }
    });
  });

  const metrics = order.map((id): SummaryMetric => {
    let total: number | null = null;
    let soonest: number | null = null;
    const segments = credentials.map((credential) => {
      const metric = credential?.metrics.find((candidate) => candidate.id === id);
      if (!metric) return null;
      if (metric.resetAtMs !== null && (soonest === null || metric.resetAtMs < soonest)) {
        soonest = metric.resetAtMs;
      }
      if (metric.remainingPercent === null) return null;
      total = (total ?? 0) + metric.remainingPercent;
      return metric.remainingPercent;
    });
    return {
      id,
      label: labels.get(id) ?? id,
      totalRemaining: total,
      capacity: count * 100,
      segments,
      soonestResetMs: soonest,
    };
  });

  return {
    type,
    count,
    loadedCount: loaded.length,
    headline: metrics[0] ?? null,
    secondary: metrics.slice(1),
  };
}
