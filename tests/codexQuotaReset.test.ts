import { afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TFunction } from 'i18next';
import i18n from '@/i18n';
import { buildCodexResetConfirmation } from '@/features/quota/providers/codex/codexResetConfirmation';
import { CODEX_CONFIG } from '@/features/quota/providers/codex/data';
import { apiCallApi, authFilesApi, apiClient } from '@/services/api';
import {
  CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL,
  CODEX_RATE_LIMIT_RESET_CREDITS_URL,
  selectCodexResetCredit,
} from '@/utils/quota';

const t = ((key: string) => key) as TFunction;
const file = { name: 'codex-test.json', auth_index: 'test-index', type: 'codex' };
const response = (body: unknown, statusCode = 200) => ({
  statusCode,
  body,
  bodyText: JSON.stringify(body),
  header: {},
});
const reset = (creditId?: string) => CODEX_CONFIG.resetQuota!(file, t, creditId);
const mocks: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const mock of mocks.splice(0)) mock.mockRestore();
});

const credit = (id: string, expiresAt: string) => ({
  id,
  reset_type: 'codex_rate_limits',
  status: 'available',
  granted_at: '2026-11-01T00:00:00Z',
  expires_at: expiresAt,
});

function setup(body: unknown, statusCode = 200, credits: unknown = { credits: [] }) {
  const calls: string[] = [];
  const consumed: unknown[] = [];
  let listed = false;
  const request = spyOn(apiCallApi, 'request').mockImplementation(async (payload) => {
    if (payload.url === CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL) {
      calls.push('consume');
      consumed.push(JSON.parse(String(payload.data)));
      return response(body, statusCode);
    }
    if (payload.url === CODEX_RATE_LIMIT_RESET_CREDITS_URL && !listed) {
      // The first list read picks the credit; later ones refresh the card.
      listed = true;
      calls.push('list');
      return response(credits);
    }
    calls.push('read');
    return response({});
  });
  const clear = spyOn(authFilesApi, 'resetCooldown').mockImplementation(async () => {
    calls.push('clear');
    return { status: 'ok', auth_index: 'test-index', models: [] };
  });
  mocks.push(request, clear);
  return { calls, consumed, request, clear };
}

describe('Codex reset gateway cooldown', () => {
  test.each(['reset', 'already_redeemed'])(
    'clears only after confirmed %s, before reads',
    async (code) => {
      const { calls, clear } = setup({ code, windows_reset: 0 });
      await reset();
      expect(calls.slice(0, 4)).toEqual(['list', 'consume', 'clear', 'read']);
      expect(clear).toHaveBeenCalledTimes(1);
      expect(clear).toHaveBeenCalledWith('test-index');
    }
  );

  test.each(['no_credit', 'nothing_to_reset', 'unknown'])('does not clear for %s', async (code) => {
    const { calls } = setup({ code });
    await expect(reset()).rejects.toThrow('codex_quota.reset_not_confirmed');
    expect(calls).toEqual(['list', 'consume']);
  });

  test('does not clear on HTTP failure', async () => {
    const { calls } = setup({ code: 'reset' }, 503);
    await expect(reset()).rejects.toThrow();
    expect(calls).toEqual(['list', 'consume']);
  });

  test('does not clear on transport failure', async () => {
    const { request, clear } = setup({});
    request.mockRejectedValue(new Error('timeout'));
    await expect(reset()).rejects.toThrow('timeout');
    expect(clear).not.toHaveBeenCalled();
  });

  test('directs cooldown failures to manual clearing, without another consume', async () => {
    const { request, clear } = setup({ code: 'reset' });
    clear.mockRejectedValue(new Error('offline'));
    await expect(reset()).rejects.toThrow('codex_quota.reset_cooldown_failed');
    expect(request).toHaveBeenCalledTimes(2);
  });

  test('rejects mismatched cooldown acknowledgements', async () => {
    const { clear } = setup({ code: 'reset' });
    clear.mockResolvedValue({ status: 'ok', auth_index: 'other-index', models: [] });
    await expect(reset()).rejects.toThrow('codex_quota.reset_cooldown_failed');
  });

  test('does not redeem after connection changes during the credit list read', async () => {
    const { calls } = setup({ code: 'reset' }, 200, {
      credits: [credit('soon', '2099-11-30T00:00:00Z')],
    });
    const revision = spyOn(apiClient, 'getConnectionRevision')
      .mockReturnValueOnce(1)
      .mockReturnValue(2);
    mocks.push(revision);
    await expect(reset()).rejects.toThrow('The management connection changed.');
    expect(calls).toEqual(['list']);
  });

  test('does not redeem a chosen credit after the connection changes', async () => {
    const { calls } = setup({ code: 'reset' });
    const revision = spyOn(apiClient, 'getConnectionRevision')
      .mockReturnValueOnce(1)
      .mockReturnValue(2);
    mocks.push(revision);
    await expect(reset('soon')).rejects.toThrow('The management connection changed.');
    expect(calls).toEqual([]);
  });

  test('does not clear after connection changes during redemption', async () => {
    const { clear } = setup({ code: 'reset' });
    // Unchanged at the start and just before the POST, changed after it.
    const revision = spyOn(apiClient, 'getConnectionRevision')
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(1)
      .mockReturnValue(2);
    mocks.push(revision);
    await expect(reset()).rejects.toThrow('codex_quota.reset_cooldown_failed');
    expect(clear).not.toHaveBeenCalled();
  });
});

describe('Codex reset credit choice', () => {
  test('redeems the credit that expires first, not the newest', async () => {
    const { consumed } = setup({ code: 'reset' }, 200, {
      credits: [credit('late', '2099-12-16T00:00:00Z'), credit('soon', '2099-11-30T00:00:00Z')],
    });
    await reset();
    expect(consumed).toEqual([{ redeem_request_id: expect.any(String), credit_id: 'soon' }]);
  });

  test('redeems the credit the operator chose, without rereading the list', async () => {
    const { calls, consumed } = setup({ code: 'reset' }, 200, {
      credits: [credit('soon', '2099-11-30T00:00:00Z'), credit('late', '2099-12-16T00:00:00Z')],
    });
    await reset('late');
    expect(calls.slice(0, 2)).toEqual(['consume', 'clear']);
    expect(consumed).toEqual([{ redeem_request_id: expect.any(String), credit_id: 'late' }]);
  });

  test('lets the backend pick when the credit list cannot be read', async () => {
    const { calls, consumed } = setup({ code: 'reset' }, 200, 'not json');
    await reset();
    expect(calls.slice(0, 2)).toEqual(['list', 'consume']);
    expect(consumed).toEqual([{ redeem_request_id: expect.any(String) }]);
  });
});

describe('selectCodexResetCredit', () => {
  const now = Date.parse('2026-11-16T00:00:00Z');
  const entry = (id: string, expiresAt: string) => ({
    id,
    status: 'available',
    grantedAt: '',
    expiresAt,
  });

  test('orders by expiry, then ID', () => {
    const credits = [
      entry('c', '2026-12-16T00:00:00Z'),
      entry('b', '2026-11-30T00:00:00Z'),
      entry('a', '2026-11-30T00:00:00Z'),
    ];
    expect(selectCodexResetCredit(credits, now)?.id).toBe('a');
  });

  test('skips expired, unparseable, and ID-less credits', () => {
    const credits = [
      entry('expired', '2026-11-15T00:00:00Z'),
      entry('garbled', 'soon'),
      entry('', '2026-11-20T00:00:00Z'),
      entry('valid', '2026-12-16T00:00:00Z'),
    ];
    expect(selectCodexResetCredit(credits, now)?.id).toBe('valid');
    expect(selectCodexResetCredit(credits.slice(0, 3), now)).toBeUndefined();
  });
});

describe('Codex reset confirmation', () => {
  const now = Date.parse('2026-11-16T00:00:00Z');
  const stored = (id: string, expiresAt: string) => ({
    id,
    status: 'available',
    grantedAt: '',
    expiresAt,
  });
  const quota = (credits: ReturnType<typeof stored>[]) => ({
    status: 'success' as const,
    rateLimitResetCredits: credits,
  });

  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  test('lists credits soonest first with expiry dates and preselects the first', () => {
    const late = '2026-12-16T00:00:00Z';
    const soon = '2026-11-30T00:00:00Z';
    const confirmation = buildCodexResetConfirmation(
      i18n.t,
      'codex-test.json',
      quota([stored('late', late), stored('soon', soon)]),
      now
    );
    expect(confirmation.creditId()).toBe('soon');
    expect(confirmation.confirmText).toBe('Use reset');
    expect(isValidElement(confirmation.message)).toBe(true);

    const markup = renderToStaticMarkup(confirmation.message as React.ReactElement);
    const format = (iso: string) =>
      new Date(iso).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' });
    const soonAt = markup.indexOf(`Expires ${format(soon)}`);
    const lateAt = markup.indexOf(`Expires ${format(late)}`);
    expect(soonAt).toBeGreaterThan(-1);
    expect(lateAt).toBeGreaterThan(soonAt);
    expect(markup).toContain('in 14 days');
    expect(markup).toContain('in 30 days');
    expect(markup).toContain('Expires first');
    expect(markup).toMatch(/checked="" value="soon"/);
    expect(markup).not.toMatch(/checked="" value="late"/);
    expect(markup).toContain('role="radiogroup"');
  });

  test('keeps the plain confirmation when no credit can be chosen', () => {
    const confirmation = buildCodexResetConfirmation(
      i18n.t,
      'codex-test.json',
      quota([stored('', '2026-11-30T00:00:00Z')]),
      now
    );
    expect(confirmation.message).toBe(
      i18n.t('codex_quota.reset_confirm_message', { name: 'codex-test.json' })
    );
    expect(confirmation.creditId()).toBeUndefined();
  });
});
