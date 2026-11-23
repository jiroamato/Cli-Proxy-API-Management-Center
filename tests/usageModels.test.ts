import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '../src/i18n/index';
import type { UsageGroup, UsageMetrics } from '../src/services/api/usageStats';
import { ModelsPanel } from '../src/features/usage/components/ModelsPanel';
import {
  MODEL_PARTS,
  buildModelRows,
  costPerMillion,
  emptyMetrics,
  hasCostSplit,
  isUnpriced,
  partCost,
  partTokens,
  type ModelView,
} from '../src/features/usage/logic';

const group = (model: string, metrics: Partial<UsageMetrics>): UsageGroup => ({
  ...emptyMetrics(),
  ...metrics,
  dimensions: { model },
  sessions: 0,
});

/** 1M each of input, cache write, cache read and output at $4 / $5 / $0.20 / $20 per 1M. */
const opus = group('claude-opus-5-5', {
  requests: 12,
  inputTokens: 1_000_000,
  cacheWriteTokens: 1_000_000,
  cacheReadTokens: 1_000_000,
  outputTokens: 600_000,
  reasoningTokens: 400_000,
  totalTokens: 4_000_000,
  costUsd: 29.2,
  inputCostUsd: 4,
  cacheWriteCostUsd: 5,
  cacheReadCostUsd: 0.2,
  outputCostUsd: 20,
});

/** More tokens than Opus, but far cheaper. */
const mini = group('gpt-6.2-mini', {
  requests: 40,
  inputTokens: 8_000_000,
  outputTokens: 1_000_000,
  totalTokens: 9_000_000,
  costUsd: 4,
  inputCostUsd: 2,
  outputCostUsd: 2,
});

const mystery = group('mystery-model', {
  requests: 3,
  inputTokens: 500,
  outputTokens: 500,
  totalTokens: 1000,
  unpricedTokens: 1000,
});

describe('model parts', () => {
  test('output includes reasoning tokens, as it is billed alike', () => {
    expect(partTokens(opus, 'output')).toBe(1_000_000);
    expect(MODEL_PARTS.reduce((sum, part) => sum + partTokens(opus, part), 0)).toBe(
      opus.totalTokens
    );
  });

  test('cost parts add up to the cost', () => {
    const sum = MODEL_PARTS.reduce((total, part) => total + partCost(opus, part), 0);
    expect(sum).toBeCloseTo(opus.costUsd, 9);
  });

  test('a cost without parts comes from a backend that predates the split', () => {
    expect(hasCostSplit(opus)).toBe(true);
    expect(hasCostSplit(group('old', { costUsd: 3, totalTokens: 10 }))).toBe(false);
    expect(hasCostSplit(mystery)).toBe(true);
  });

  test('cost per million counts only priced tokens', () => {
    expect(costPerMillion(opus)).toBeCloseTo(7.3, 9);
    expect(
      costPerMillion(group('m', { totalTokens: 2_000_000, unpricedTokens: 1_000_000, costUsd: 3 }))
    ).toBe(3);
    expect(costPerMillion(mystery)).toBeNull();
    expect(isUnpriced(mystery)).toBe(true);
    expect(isUnpriced(opus)).toBe(false);
  });
});

describe('buildModelRows', () => {
  const groups = [mini, opus, mystery];

  test('the cost view ranks and shares by cost', () => {
    const { rows, basis } = buildModelRows(groups, 'cost', 10);
    expect(basis).toBe('cost');
    expect(rows.map((row) => row.value)).toEqual([
      'claude-opus-5-5',
      'gpt-6.2-mini',
      'mystery-model',
    ]);
    expect(rows[0].share).toBeCloseTo((29.2 / 33.2) * 100, 6);
  });

  test('the tokens view ranks and shares by tokens', () => {
    const { rows, basis } = buildModelRows(groups, 'tokens', 10);
    expect(basis).toBe('tokens');
    expect(rows.map((row) => row.value)).toEqual([
      'gpt-6.2-mini',
      'claude-opus-5-5',
      'mystery-model',
    ]);
    expect(rows[0].share).toBeCloseTo((9_000_000 / 13_001_000) * 100, 6);
  });
});

const render = (groups: UsageGroup[], initialView: ModelView) =>
  renderToStaticMarkup(createElement(ModelsPanel, { groups, truncated: false, initialView }));

describe('ModelsPanel rendering', () => {
  test('the cost view splits each model cost and totals every model', () => {
    const markup = render([mini, opus, mystery], 'cost');
    expect(markup).toContain(i18n.t('usage.models.title'));
    expect(markup).toContain(i18n.t('usage.models.per_million'));
    for (const value of ['$4.00', '$5.00', '$0.20', '$20.00', '$29.20', '$7.30', '$33.20']) {
      expect(markup).toContain(`>${value}<`);
    }
    expect(markup).toContain(i18n.t('usage.models.all'));
    expect(markup).toContain(i18n.t('usage.models.no_price'));
    expect(markup.indexOf('claude-opus-5-5')).toBeLessThan(markup.indexOf('gpt-6.2-mini'));
    // Mini wrote no cache, so its cache cells are dashes rather than $0.
    expect(markup).not.toContain('>$0<');
    expect(markup).toContain('>-<');
  });

  test('the tokens view lists token counts and requests', () => {
    const markup = render([mini, opus], 'tokens');
    expect(markup).toContain(`>${i18n.t('usage.columns.requests')}<`);
    expect(markup).not.toContain(i18n.t('usage.models.per_million'));
    expect(markup).toContain('>9M<');
    expect(markup).toContain('>13M<');
    expect(markup.indexOf('gpt-6.2-mini')).toBeLessThan(markup.indexOf('claude-opus-5-5'));
  });

  test('shows no cost parts when the backend reports only the total', () => {
    const markup = render([group('old', { totalTokens: 10, inputTokens: 10, costUsd: 3 })], 'cost');
    expect(markup).toContain('>$3.00<');
    expect(markup).not.toContain('>$0<');
    expect(markup.match(/>-</g)?.length).toBe(4);
    // No legend and a neutral bar: the cost must not read as all input.
    expect(markup).not.toContain('<ul');
    expect(markup).toContain('var(--usage-c-rest)');
    expect(markup).not.toContain('var(--usage-input)');
  });

  test('still draws bars when nothing in the range is priced', () => {
    const markup = render(
      [
        mystery,
        group('other-mystery', { totalTokens: 500, inputTokens: 500, unpricedTokens: 500 }),
      ],
      'cost'
    );
    expect(markup).toContain(i18n.t('usage.columns.token_share'));
    expect(markup).not.toContain('<ul');
    expect(markup.split('var(--usage-c-rest)').length - 1).toBe(3);
  });

  test('a part paid only by unpriced models reads as a dash, not $0', () => {
    const priced = group('priced', {
      inputTokens: 1_000_000,
      totalTokens: 1_000_000,
      costUsd: 1,
      inputCostUsd: 1,
    });
    const unpriced = group('unpriced', {
      cacheWriteTokens: 1000,
      totalTokens: 1000,
      unpricedTokens: 1000,
    });
    const markup = render([priced, unpriced], 'cost');
    expect(markup).not.toContain('>$0<');
    expect(markup).toContain('>$1.00<');
  });

  test('a single model gets no all-models row', () => {
    expect(render([opus], 'cost')).not.toContain(i18n.t('usage.models.all'));
  });

  test('says so when nothing was recorded', () => {
    expect(render([], 'cost')).toContain(i18n.t('usage.breakdown.empty'));
  });
});
