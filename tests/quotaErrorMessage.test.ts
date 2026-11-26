import { beforeAll, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { QuotaErrorMessage } from '@/features/quota/components/QuotaErrorMessage';
import { QuotaLedger } from '@/features/quota/components/QuotaLedger';
import type { QuotaFileEntry } from '@/features/quota/logic';
import type { QuotaCardState } from '@/features/quota/providers';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

const message = 'Verify your account to continue.';
const render = (overrides: Partial<QuotaCardState>) =>
  renderToStaticMarkup(
    createElement(QuotaErrorMessage, {
      quota: { status: 'error', errorStatus: 403, error: message, ...overrides },
      i18nPrefix: 'antigravity_quota',
    })
  );

test('validation preserves the upstream message and offers a safe external action', () => {
  const url = 'https://accounts.google.com/signin/continue?example=1';
  const html = render({ validation: { url } });
  expect(html).toContain(message);
  expect(html).toContain(`href="${url}"`);
  expect(html).toContain('target="_blank"');
  expect(html).toContain('rel="noopener noreferrer"');
  expect(html).toContain('Open verification link');
});

test('validation without a trusted link still shows the message', () => {
  for (const url of [undefined, 'javascript:void(0)', 'https://accounts.google.com.example.org/']) {
    const html = render({ validation: { url } });
    expect(html).toContain(message);
    expect(html).not.toContain('<a ');
  }
});

test('ordinary errors retain the provider wrapper and existing status messages', () => {
  for (const [errorStatus, expected] of [
    [403, i18n.t('common.quota_check_credential')],
    [404, i18n.t('common.quota_update_required')],
    [500, message],
  ] as const) {
    expect(render({ errorStatus })).toBe(
      i18n.t('antigravity_quota.load_failed', { message: expected })
    );
  }
});

test('ledger rows surface the same message and verification link as the cards', () => {
  const url = 'https://accounts.google.com/signin/continue?example=1';
  const entry = {
    file: { name: 'antigravity-a.json', type: 'antigravity' },
    type: 'antigravity',
  } as QuotaFileEntry;
  const html = renderToStaticMarkup(
    createElement(QuotaLedger, {
      groups: [{ type: 'antigravity', provider: 'antigravity', entries: [entry] }],
      quotaFor: () => ({ status: 'error', errorStatus: 403, error: message, validation: { url } }),
      credentialFor: () => null,
      displayNameFor: () => 'antigravity-a.json',
      resolvedTheme: 'light',
      canUseActions: true,
      resettingKey: null,
      cacheKeyFor: (item) => item.file.name,
      onRefresh: () => {},
      onReset: () => {},
    })
  );
  expect(html).toContain('role="alert"');
  expect(html).toContain(message);
  expect(html).toContain(`href="${url}"`);
  expect(html).toContain('Open verification link');
});
