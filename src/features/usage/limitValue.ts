/**
 * What a subscription limit is worth at API prices, per provider and window.
 *
 * The backend reports, for each account and quota window, the API-equivalent
 * cost of the intervals in which the window rose and how many percentage
 * points it rose. Accounts of one provider and window are combined by summing
 * both before dividing, so each account weighs by the evidence it carries.
 */

import type { LimitSeries, LimitSpend } from '@/services/api/limitValue';
import type { AccountPlan } from '@/services/api/usageStats';
import { accountPlanKey } from './logic';

/**
 * Below this many percentage points of evidence a figure is thin. The backend
 * documents a figure over 20% of a limit as good to a few percent: reports are
 * rounded to whole percents, so a run of rises can be off by about one
 * request's share at each end.
 */
export const THIN_EVIDENCE_PERCENT = 20;

/** A weekly limit renews 30/7 times in an average 30-day month. */
const WEEKS_PER_MONTH = 30 / 7;

export interface LimitFigures {
  costUsd: number;
  percentUsed: number;
  intervals: number;
  /** Output and reasoning tokens. */
  outputTokens: number;
  /** Null when the window never rose: there is no evidence, not a zero value. */
  usdPerPercent: number | null;
  /** The API-equivalent value of one full limit, `usdPerPercent` × 100. */
  fullLimitUsd: number | null;
  outputTokensPerLimit: number | null;
  thin: boolean;
}

export interface LimitModelRow extends LimitFigures {
  model: string;
}

export interface LimitAccountRow extends LimitFigures {
  account: string;
  /** A full weekly limit every week of a month; null for other windows. */
  monthlyUsd: number | null;
  /** Null for a model-scoped window, as on the card. */
  planMonthlyUsd: number | null;
}

export interface LimitValueCard {
  key: string;
  provider: string;
  window: string;
  modelScope: string;
  /** Window length parsed from its id, such as 7 days for `7d_oi`; null when the id has none. */
  length: { count: number; unit: 'd' | 'h' | 'm' } | null;
  weekly: boolean;
  figures: LimitFigures;
  monthlyUsd: number | null;
  /**
   * The plan price every priced account of the card shares. Null when they
   * differ, when none has one, and for a model-scoped window: the plan pays for
   * the whole subscription, not one model family's sub-limit.
   */
  planMonthlyUsd: number | null;
  models: LimitModelRow[];
  accounts: LimitAccountRow[];
}

const PROVIDER_ORDER = ['claude', 'codex'];

export function parseWindowLength(window: string): LimitValueCard['length'] {
  const match = /^([1-9]\d*)([dhm])/.exec(window);
  return match ? { count: Number(match[1]), unit: match[2] as 'd' | 'h' | 'm' } : null;
}

const isWeekly = (length: LimitValueCard['length']): boolean =>
  length !== null && length.unit === 'd' && length.count === 7;

export function sumFigures(parts: readonly LimitSpend[]): LimitFigures {
  let costUsd = 0;
  let percentUsed = 0;
  let intervals = 0;
  let outputTokens = 0;
  for (const part of parts) {
    costUsd += part.costUsd;
    percentUsed += part.percentUsed;
    intervals += part.intervals;
    outputTokens += part.outputTokens + part.reasoningTokens;
  }
  const usdPerPercent = percentUsed > 0 ? costUsd / percentUsed : null;
  return {
    costUsd,
    percentUsed,
    intervals,
    outputTokens,
    usdPerPercent,
    fullLimitUsd: usdPerPercent === null ? null : usdPerPercent * 100,
    outputTokensPerLimit: percentUsed > 0 ? (outputTokens / percentUsed) * 100 : null,
    thin: percentUsed < THIN_EVIDENCE_PERCENT,
  };
}

const monthlyOf = (figures: LimitFigures, weekly: boolean): number | null =>
  weekly && figures.fullLimitUsd !== null ? figures.fullLimitUsd * WEEKS_PER_MONTH : null;

const byEvidence = <T extends LimitFigures>(a: T, b: T): number =>
  b.percentUsed - a.percentUsed || b.costUsd - a.costUsd;

const cardRank = (card: Pick<LimitValueCard, 'provider' | 'modelScope' | 'length'>): number[] => {
  const provider = PROVIDER_ORDER.indexOf(card.provider);
  const windowRank =
    card.modelScope !== '' ? 2 : isWeekly(card.length) ? 0 : card.length?.unit === 'h' ? 1 : 2;
  return [provider === -1 ? PROVIDER_ORDER.length : provider, windowRank];
};

/** One card per provider and window, weekly limits first, each with model and account rows. */
export function buildLimitValueCards(
  series: readonly LimitSeries[],
  plans: readonly AccountPlan[]
): LimitValueCard[] {
  const planByAccount = new Map(
    plans
      .filter((plan) => plan.monthlyUsd > 0)
      .map((plan) => [accountPlanKey(plan.provider, plan.account), plan.monthlyUsd])
  );
  const groups = new Map<string, LimitSeries[]>();
  for (const entry of series) {
    const key = `${entry.provider}\u0000${entry.window}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }

  const cards = [...groups.entries()].map(([key, members]): LimitValueCard => {
    const { provider, window, modelScope } = members[0];
    const length = parseWindowLength(window);
    const weekly = isWeekly(length);
    const figures = sumFigures(members);

    const modelParts = new Map<string, LimitSpend[]>();
    members
      .flatMap((member) => member.models)
      .forEach((model) =>
        modelParts.set(model.model, [...(modelParts.get(model.model) ?? []), model])
      );
    const models = [...modelParts.entries()]
      .map(([model, parts]) => ({ ...sumFigures(parts), model }))
      .sort(byEvidence);

    const accounts = members
      .map((member): LimitAccountRow => {
        const accountFigures = sumFigures([member]);
        return {
          ...accountFigures,
          account: member.account,
          monthlyUsd: monthlyOf(accountFigures, weekly),
          planMonthlyUsd:
            modelScope === ''
              ? (planByAccount.get(accountPlanKey(provider, member.account)) ?? null)
              : null,
        };
      })
      .sort(byEvidence);

    const prices = new Set(
      accounts.map((account) => account.planMonthlyUsd).filter((price) => price !== null)
    );
    return {
      key,
      provider,
      window,
      modelScope,
      length,
      weekly,
      figures,
      monthlyUsd: monthlyOf(figures, weekly),
      planMonthlyUsd: prices.size === 1 ? [...prices][0] : null,
      models,
      accounts,
    };
  });

  return cards.sort((a, b) => {
    const [providerA, windowA] = cardRank(a);
    const [providerB, windowB] = cardRank(b);
    return (
      providerA - providerB ||
      a.provider.localeCompare(b.provider) ||
      windowA - windowB ||
      a.window.localeCompare(b.window)
    );
  });
}
