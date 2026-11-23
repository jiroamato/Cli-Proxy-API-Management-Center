import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '../src/i18n/index';
import { QuotaSummaryStrip } from '../src/features/quota/components/QuotaSummaryStrip';
import { PluginProviderLogos } from '../src/features/plugins/providerLogos';
import type { ProviderSummary } from '../src/features/quota/ledger/model';

const summary = (overrides: Partial<ProviderSummary>): ProviderSummary => ({
  type: 'plugin',
  provider: 'example-quota',
  count: 1,
  loadedCount: 0,
  headline: null,
  secondary: [],
  ...overrides,
});

const render = (summaries: ProviderSummary[], logos: ReadonlyMap<string, string>) =>
  renderToStaticMarkup(
    createElement(
      PluginProviderLogos.Provider,
      { value: logos },
      createElement(QuotaSummaryStrip, { summaries, resolvedTheme: 'dark' })
    )
  );

describe('QuotaSummaryStrip provider artwork', () => {
  test('a plugin quota provider shows the logo its plugin registered', () => {
    const html = render([summary({})], new Map([['example-quota', '/plugin-logo.svg']]));
    expect(html).toContain('src="/plugin-logo.svg"');
  });

  test('falls back to the initial when nothing supplies a logo', () => {
    const html = render([summary({})], new Map());
    expect(html).not.toContain('<img');
    expect(html).toContain('>E</span>');
  });

  test('built-in provider icons win over plugin logos', () => {
    const html = render(
      [summary({ type: 'claude', provider: 'claude' })],
      new Map([['claude', '/plugin-claude.svg']])
    );
    expect(html).toContain('<img');
    expect(html).not.toContain('/plugin-claude.svg');
  });
});
