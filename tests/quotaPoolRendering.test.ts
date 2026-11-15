import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '../src/i18n/index';
import {
  QuotaPoolSection,
  type QuotaPoolSectionProps,
} from '../src/features/quota/components/QuotaPoolSection';
import { buildQuotaPools, type QuotaPoolGroup } from '../src/features/quota/quotaPoolModel';

const HOUR = 3_600_000;

const render = (overrides: Partial<QuotaPoolSectionProps>) =>
  renderToStaticMarkup(
    createElement(QuotaPoolSection, {
      groups: [],
      status: 'ready',
      error: '',
      rangeId: '3d',
      resolvedTheme: 'dark',
      enabling: false,
      onRangeChange: () => undefined,
      onRetry: () => undefined,
      onEnableRecording: () => undefined,
      ...overrides,
    })
  );

const claudeGroup = (withSamples: boolean): QuotaPoolGroup => {
  const credentials = [
    { key: 'a', label: 'claude-a.json', ledger: {} },
    { key: 'b', label: 'claude-b.json', ledger: {} },
  ];
  const now = Date.now();
  return {
    provider: 'claude',
    accountCount: credentials.length,
    pools: buildQuotaPools(
      'claude',
      credentials,
      withSamples
        ? [
            {
              provider: 'claude',
              authIndex: 'a',
              account: 'a@example.com',
              window: '7d',
              carryIn: null,
              points: [{ tsMs: now - HOUR, usedPercent: 40, resetsAtMs: now + 48 * HOUR }],
              thinned: false,
            },
          ]
        : []
    ),
  };
};

describe('QuotaPoolSection rendering', () => {
  test('renders nothing when the page lists no Claude or Codex credential', () => {
    expect(render({ groups: [] })).toBe('');
  });

  test('offers to turn recording on while the server answers 409', () => {
    const markup = render({ groups: [claudeGroup(true)], status: 'disabled' });
    expect(markup).toContain(i18n.t('quota_management.pool_disabled'));
    expect(markup).toContain(i18n.t('usage.disabled.action'));
    expect(markup).not.toContain('role="img"');
  });

  test('shows the error with a way to retry', () => {
    const markup = render({ groups: [claudeGroup(true)], status: 'error', error: 'boom' });
    expect(markup).toContain(i18n.t('quota_management.pool_error', { message: 'boom' }));
    expect(markup).toContain('role="alert"');
  });

  test('explains an empty history instead of drawing an empty chart', () => {
    const markup = render({ groups: [claudeGroup(false)] });
    expect(markup).toContain(i18n.t('quota_management.pool_no_samples'));
    expect(markup).not.toContain('role="img"');
  });

  test('shows the pool header, the unknown account and the chart', () => {
    const markup = render({ groups: [claudeGroup(true)] });
    expect(markup).toContain('>60%<');
    expect(markup).toContain(i18n.t('quota_management.summary_capacity', { percent: 200 }));
    expect(markup).toContain(i18n.t('quota_management.pool_unknown', { count: 1 }));
    expect(markup).toContain('role="img"');
  });
});
