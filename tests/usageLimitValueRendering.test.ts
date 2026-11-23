import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '../src/i18n/index';
import type { LimitSeries } from '../src/services/api/limitValue';
import { LimitCard } from '../src/features/usage/components/LimitValuePanel';
import { buildLimitValueCards } from '../src/features/usage/limitValue';

const series = (percentUsed: number, costUsd: number): LimitSeries => ({
  requests: 3,
  failed: 0,
  turns: 0,
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
  outputTokens: 1000,
  reasoningTokens: 0,
  unclassifiedTokens: 0,
  totalTokens: 1000,
  webSearchRequests: 0,
  costUsd,
  inputCostUsd: 0,
  cacheReadCostUsd: 0,
  cacheWriteCostUsd: 0,
  outputCostUsd: costUsd,
  unpricedTokens: 0,
  intervals: percentUsed,
  percentUsed,
  usdPerPercent: percentUsed > 0 ? costUsd / percentUsed : null,
  outputTokensPerPercent: null,
  provider: 'claude',
  authIndex: 'a',
  account: 'a@example.com',
  window: '7d',
  modelScope: '',
  models: [],
});

const render = (entry: LimitSeries) =>
  renderToStaticMarkup(
    createElement(LimitCard, {
      card: buildLimitValueCards([entry], [])[0],
      displayAccount: (account: string) => account,
    })
  );

describe('LimitCard rendering', () => {
  test('shows no data, never $0, for a window that did not rise', () => {
    const markup = render(series(0, 0));
    expect(markup).toContain(i18n.t('usage.limit_value.no_data'));
    expect(markup).not.toContain('$0');
  });

  test('marks thin evidence and still shows the measured figure', () => {
    const markup = render(series(4, 12));
    expect(markup).toContain(i18n.t('usage.limit_value.thin'));
    expect(markup).toContain('$3.00');
  });

  test('shows no thin tag once the evidence reaches the threshold', () => {
    const markup = render(series(40, 120));
    expect(markup).not.toContain(i18n.t('usage.limit_value.thin'));
    expect(markup).toContain('$300.00');
  });
});
