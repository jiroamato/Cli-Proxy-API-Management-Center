import {
  selectResetGrant,
  sortResetGrants,
} from '../src/features/quota/providers/claude/selectResetGrant';
import { buildClaudeResetConfirmation } from '../src/features/quota/providers/claude/claudeResetConfirmation';
import i18n from '@/i18n';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { LIVE_CEDAR_EMBER } from './fixtures/claudeResetGrants';

import { afterEach, describe, expect, test } from 'bun:test';
import {
  anthropicResetGrantBlocker,
  claimClaudeResetGrant,
  parseAnthropicResetGrantStatus,
  readClaudeOrganization,
  readClaudeResetGrants,
  AnthropicResetGrantUnknownOutcome,
  ANTHROPIC_RESET_RESULTS,
  type AnthropicResetSettledCode,
} from '../src/services/api/claudeResetGrants';
import { apiCallApi, type ApiCallRequest } from '../src/services/api/apiCall';
import {
  createResetGrantOperations,
  RETRY_WINDOW_MS,
} from '../src/features/quota/providers/claude/resetGrantOperations';

const organization = '11111111-2222-3333-4444-555555555555';
const grant = { id: 'test-grant', resets_total: 2, resets_left: 2, usable_now: true };
const block = { eligible: true, at_limit: true, grants: [grant] };
const status = () => parseAnthropicResetGrantStatus(block)!;
const originalRequest = apiCallApi.request;
afterEach(() => {
  apiCallApi.request = originalRequest;
});

describe('Claude reset grant fail-closed parsing', () => {
  test('valid block and refusing defaults', () => {
    expect(status().grants[0].useRequiresLimit).toBe(true);
    expect(anthropicResetGrantBlocker(status(), grant.id)).toBeNull();
    expect(anthropicResetGrantBlocker({ ...status(), atLimit: false }, grant.id)).toBe(
      'not_limited'
    );
    expect(anthropicResetGrantBlocker({ ...status(), eligible: false }, grant.id)).toBe(
      'ineligible'
    );
    const missing = parseAnthropicResetGrantStatus({
      ...block,
      grants: [{ ...grant, usable_now: undefined }],
    })!;
    expect(anthropicResetGrantBlocker(missing, grant.id)).toBe('not_usable');
  });
  test('rejects malformed blocks and grants', () => {
    for (const value of [
      undefined,
      {},
      { ...block, eligible: 1 },
      { ...block, grants: {} },
      { ...block, grants: [grant, grant] },
      { ...block, cooldown_until: 'bad' },
    ]) {
      expect(parseAnthropicResetGrantStatus(value)).toBeNull();
    }
    for (const fields of [
      { id: '../bad' },
      { resets_left: -1 },
      { resets_left: 3 },
      { resets_total: 1.5 },
      { paused: 'false' },
      { starts_at: 'bad' },
      { clears: {} },
    ]) {
      expect(
        parseAnthropicResetGrantStatus({ ...block, grants: [{ ...grant, ...fields }] })
      ).toBeNull();
    }
  });
});

test('exact proxied GET/profile/claim contract, no provider token in frontend', async () => {
  const calls: ApiCallRequest[] = [];
  apiCallApi.request = async (request) => {
    calls.push(request);
    const body =
      request.method === 'POST'
        ? { result: 'reset' }
        : request.url.endsWith('profile')
          ? { organization: { uuid: organization } }
          : { cedar_ember: block };
    return { statusCode: 200, body, bodyText: '', header: {} };
  };
  await readClaudeResetGrants('index');
  expect(await readClaudeOrganization('index')).toBe(organization);
  expect(await claimClaudeResetGrant('index', organization, grant.id, 'request-1')).toBe('reset');
  expect(calls[0].url).toBe('https://api.anthropic.com/api/oauth/usage?cedar_ember=1&skip_spend=1');
  expect(calls[1].url).toBe('https://api.anthropic.com/api/oauth/profile');
  expect(calls[2].url).toBe(
    `https://api.anthropic.com/api/organizations/${organization}/reset_rate_limits`
  );
  expect(JSON.parse(calls[2].data!)).toEqual({
    program: 'cedar_ember',
    grant_id: grant.id,
    request_id: 'request-1',
  });
  for (const call of calls) {
    expect(call.authIndex).toBe('index');
    expect(call.header?.Authorization).toBe('Bearer $TOKEN$');
    expect(call.header?.['anthropic-beta']).toBe('oauth-2025-04-20');
    expect(call.header?.['User-Agent']).toBe('claude-cli/2.1.280 (external, cli)');
  }
});

test('claim terminal mappings and ambiguous outcomes', async () => {
  for (const result of ANTHROPIC_RESET_RESULTS) {
    apiCallApi.request = async () => ({
      statusCode: 200,
      body: { result },
      bodyText: '',
      header: {},
    });
    expect(await claimClaudeResetGrant('a', organization, grant.id, 'r')).toBe(result);
  }
  for (const [statusCode, code] of [
    [401, 'auth_error'],
    [403, 'auth_error'],
    [429, 'rate_limited'],
  ] as const) {
    apiCallApi.request = async () => ({ statusCode, body: null, bodyText: '', header: {} });
    expect(await claimClaudeResetGrant('a', organization, grant.id, 'r')).toBe(code);
  }
  for (const statusCode of [200, 400, 500]) {
    apiCallApi.request = async () => ({
      statusCode,
      body: { result: 'unexpected' },
      bodyText: '',
      header: {},
    });
    await expect(claimClaudeResetGrant('a', organization, grant.id, 'r')).rejects.toBeInstanceOf(
      AnthropicResetGrantUnknownOutcome
    );
  }
  apiCallApi.request = async () => {
    throw new Error('private upstream detail');
  };
  await expect(claimClaudeResetGrant('a', organization, grant.id, 'r')).rejects.toThrow(
    'outcome is unknown'
  );
});

function setup() {
  let revision = 1;
  let now = 100;
  let count = 0;
  const ids: string[] = [];
  const deps = {
    revision: () => revision,
    now: () => now,
    requestId: () => `request-${++count}`,
    readStatus: async () => status(),
    readOrganization: async () => organization,
    claim: async (
      _auth: string,
      _org: string,
      _grant: string,
      id: string
    ): Promise<AnthropicResetSettledCode> => {
      ids.push(id);
      throw new AnthropicResetGrantUnknownOutcome();
    },
  };
  return {
    deps,
    ids,
    nextSession: () => {
      revision++;
    },
    advance: () => {
      now += RETRY_WINDOW_MS;
    },
  };
}

test('unknown outcome retains request ID across retries; expiry blocks', async () => {
  const h = setup();
  const operations = createResetGrantOperations(h.deps);
  await expect(operations.run('account', 'a', grant.id)).rejects.toThrow();
  await expect(operations.run('account', 'a', grant.id)).rejects.toThrow();
  expect(h.ids).toEqual(['request-1', 'request-1']);
  await expect(operations.run('account', 'a', 'other-grant')).rejects.toThrow('expired');
  h.advance();
  await expect(operations.run('account', 'a', grant.id)).rejects.toThrow('expired');
  expect(h.ids).toHaveLength(2);
});

test('fresh spend rechecks eligibility and blocks concurrent clicks', async () => {
  const h = setup();
  h.deps.readStatus = async () => ({ ...status(), eligible: false });
  const operations = createResetGrantOperations(h.deps);
  const first = operations.run('account', 'a', grant.id);
  await expect(operations.run('account', 'a', grant.id)).rejects.toThrow('busy');
  await expect(first).rejects.toThrow('blocked');
  expect(h.ids).toHaveLength(0);
});

test('session change during profile read prevents POST and isolates journal', async () => {
  const h = setup();
  const operations = createResetGrantOperations(h.deps);
  await expect(operations.run('account', 'a', grant.id)).rejects.toThrow();
  h.nextSession();
  expect(operations.inspect('account')).toBeUndefined();
  h.deps.readOrganization = async () => {
    h.nextSession();
    return organization;
  };
  await expect(operations.run('account', 'a', grant.id)).rejects.toThrow('session');
  expect(h.ids).toHaveLength(1);
});

test('retry binds original organization', async () => {
  const h = setup();
  const operations = createResetGrantOperations(h.deps);
  await expect(operations.run('account', 'a', grant.id)).rejects.toThrow();
  h.deps.readOrganization = async () => 'aaaaaaaa-2222-3333-4444-555555555555';
  await expect(operations.run('account', 'a', grant.id)).rejects.toThrow('identity');
  expect(h.ids).toHaveLength(1);
});

test('a retry refusal keeps the ambiguous original operation open', async () => {
  const h = setup();
  const operations = createResetGrantOperations(h.deps);
  await expect(operations.run('account', 'a', grant.id)).rejects.toThrow();
  h.deps.claim = async (_auth, _org, _grant, id) => {
    h.ids.push(id);
    return 'rate_limited';
  };
  expect(await operations.run('account', 'a', grant.id)).toEqual({
    code: 'rate_limited',
    unresolved: true,
  });
  expect(operations.inspect('account')?.code).toBeUndefined();
  h.deps.claim = async (_auth, _org, _grant, id) => {
    h.ids.push(id);
    return 'already_used';
  };
  expect(await operations.run('account', 'a', grant.id)).toEqual({
    code: 'already_used',
    unresolved: false,
  });
  expect(h.ids).toEqual(['request-1', 'request-1', 'request-1']);
});

test('no retry after the deadline expires during profile lookup', async () => {
  const h = setup();
  const operations = createResetGrantOperations(h.deps);
  await expect(operations.run('account', 'a', grant.id)).rejects.toThrow();
  h.deps.readOrganization = async () => {
    h.advance();
    return organization;
  };
  await expect(operations.run('account', 'a', grant.id)).rejects.toThrow('expired');
  expect(h.ids).toHaveLength(1);
});

test('date, pause, limit, balance, usability and cooldown gates refuse new spending', async () => {
  for (const fields of [
    { paused: true },
    { resetsLeft: 0 },
    { usableNow: false },
    { startsAt: '2099-01-01T00:00:00Z' },
    { endsAt: '1970-01-01T00:00:00Z' },
  ]) {
    const h = setup();
    h.deps.readStatus = async () => ({
      ...status(),
      grants: [{ ...status().grants[0], ...fields }],
    });
    await expect(createResetGrantOperations(h.deps).run('account', 'a', grant.id)).rejects.toThrow(
      'blocked'
    );
    expect(h.ids).toHaveLength(0);
  }
  for (const fields of [{ atLimit: false }, { cooldownUntil: '2099-01-01T00:00:00Z' }]) {
    const h = setup();
    h.deps.readStatus = async () => ({ ...status(), ...fields });
    await expect(createResetGrantOperations(h.deps).run('account', 'a', grant.id)).rejects.toThrow(
      'blocked'
    );
    expect(h.ids).toHaveLength(0);
  }
});

test('a stale claim answer cannot settle the replacement session operation', async () => {
  const h = setup();
  const operations = createResetGrantOperations(h.deps);
  h.deps.claim = async () => {
    h.nextSession();
    expect(operations.inspect('account')).toBeUndefined();
    return 'reset';
  };
  await expect(operations.run('account', 'a', grant.id)).rejects.toThrow('session');
  expect(operations.inspect('account')).toBeUndefined();
});

test('all grant messages and confirmation are translated in four locales', async () => {
  const locales = await Promise.all(
    ['en', 'zh-CN', 'zh-TW', 'ru'].map(
      async (locale) => (await Bun.file(`src/i18n/locales/${locale}.json`).json()).claude_reset
    )
  );
  for (const locale of locales) {
    expect(Object.keys(locale).sort()).toEqual(Object.keys(locales[0]).sort());
    expect(locale.choose_message).toContain('{{name}}');
    expect(typeof locale.choose_button).toBe('string');
    expect(locale.retry_confirm).toContain('{{name}}');
    expect(typeof locale.remaining).toBe('string');
    expect(locale.count).toContain('{{left}}');
    for (const key of [
      ...ANTHROPIC_RESET_RESULTS,
      'auth_error',
      'rate_limited',
      'unknown',
      'expired',
    ]) {
      expect(typeof locale[key]).toBe('string');
    }
  }
});

test('card selection prefers the soonest expiry, then the recommendation, then ID', () => {
  const base = status();
  const a = { ...base.grants[0], id: 'a' };
  const b = { ...a, id: 'b' };
  const multiple = { ...base, grants: [b, a], nextGrantId: 'b' };
  expect(selectResetGrant(multiple, 0)?.id).toBe('b');
  expect(selectResetGrant({ ...multiple, nextGrantId: null }, 0)?.id).toBe('a');
  const soon = { ...a, id: 'soon', endsAt: new Date(14 * 86400_000).toISOString() };
  const late = { ...a, id: 'late', endsAt: new Date(30 * 86400_000).toISOString() };
  const dated = { ...base, grants: [late, b, soon], nextGrantId: 'late' };
  expect(sortResetGrants(dated, 0).map((grant) => grant.id)).toEqual(['soon', 'late', 'b']);
  expect(selectResetGrant(dated, 0)?.id).toBe('soon');
  expect(selectResetGrant({ ...multiple, grants: [a, { ...b, paused: true }] }, 0)?.id).toBe('a');
  expect(selectResetGrant({ ...multiple, eligible: false }, 0)).toBeUndefined();
  expect(selectResetGrant({ ...multiple, atLimit: false }, 0)).toBeUndefined();
  expect(
    selectResetGrant({ ...multiple, cooldownUntil: new Date(1000).toISOString() }, 0)
  ).toBeUndefined();
  for (const changed of [
    { resetsLeft: 0 },
    { usableNow: false },
    { paused: true },
    { startsAt: new Date(1000).toISOString() },
    { endsAt: new Date(0).toISOString() },
  ]) {
    expect(selectResetGrant({ ...base, grants: [{ ...a, ...changed }] }, 0)).toBeUndefined();
  }
});

test('Claude card uses Codex count and action styles and shared confirmation, not a grant dialog', async () => {
  // The action buttons live in the shared QuotaEntryActions component (card footer + ledger rows).
  const card =
    (await Bun.file('src/features/quota/components/QuotaCard.tsx').text()) +
    (await Bun.file('src/features/quota/components/QuotaEntryActions.tsx').text());
  const hook = await Bun.file('src/features/quota/providers/claude/ClaudeResetGrants.tsx').text();
  expect(card).toContain('quotaClasses.codexPlanValue}>{claudeReset.count');
  expect(card).toContain('disabled={claudeReset.blocked}');
  expect(card).toContain('onClick={claudeReset.confirm}');
  expect(hook).toContain('showConfirmation({');
  // A retry keeps the ambiguous claim's grant; only a fresh claim offers the picker.
  expect(hook).toContain("message: t('claude_reset.retry_confirm'");
  expect(hook).toContain('grantId: (): string | undefined => pending.grantId');
  expect(hook).toContain('buildClaudeResetConfirmation(t, file.name, status, now)');
  expect(hook).not.toContain('<Modal');
});

test('reset confirmation lists usable grants soonest first and reads the choice', async () => {
  await i18n.changeLanguage('en');
  const now = Date.parse('2026-11-16T00:00:00Z');
  const parsed = parseAnthropicResetGrantStatus({
    ...block,
    next_grant_id: 'late',
    grants: [
      { ...grant, id: 'late', label: 'Launch', ends_at: '2026-12-16T00:00:00Z' },
      { ...grant, id: 'soon', resets_left: 1, ends_at: '2026-11-30T00:00:00Z' },
      { ...grant, id: 'paused', paused: true, ends_at: '2026-11-20T00:00:00Z' },
      { ...grant, id: 'open' },
    ],
  })!;
  const confirmation = buildClaudeResetConfirmation(i18n.t, 'claude.json', parsed, now);
  expect(confirmation.grantId()).toBe('soon');
  expect(confirmation.confirmText).toBe('Use selected reset');
  const markup = renderToStaticMarkup(confirmation.message as ReactElement);
  const format = (iso: string) =>
    new Date(iso).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' });
  const soonAt = markup.indexOf(`Expires ${format('2026-11-30T00:00:00Z')}`);
  const lateAt = markup.indexOf(`Expires ${format('2026-12-16T00:00:00Z')}`);
  const openAt = markup.indexOf('No expiry');
  expect(soonAt).toBeGreaterThan(-1);
  expect(lateAt).toBeGreaterThan(soonAt);
  expect(openAt).toBeGreaterThan(lateAt);
  expect(markup).not.toContain('value="paused"');
  // The label leads each choice; unlabeled grants keep the card's numbering,
  // which also counts the paused grant.
  const text = markup.replace(/(<[^>]+>)+/g, '|');
  expect(text).toContain(
    `|Grant 2|Expires ${format('2026-11-30T00:00:00Z')}| · |in 14 days| · |1 / 2 resets remaining|`
  );
  expect(text).toContain(
    `|Launch|Expires ${format('2026-12-16T00:00:00Z')}| · |in 30 days| · |2 / 2 resets remaining|`
  );
  expect(markup).toContain('Expires first');
  expect(markup).toMatch(/checked="" value="soon"/);
});

test('live cedar_ember block parses and offers every grant, soonest expiry first', async () => {
  await i18n.changeLanguage('en');
  const parsed = parseAnthropicResetGrantStatus(LIVE_CEDAR_EMBER);
  expect(parsed).not.toBeNull();
  const now = Date.parse('2026-11-16T12:00:00Z');
  expect(sortResetGrants(parsed!, now).map((grant) => grant.id)).toEqual([
    'full-reset-2611',
    'launch-2610-fable',
    'launch-2610-fable-12mo',
    'launch-2610-fable-6mo',
  ]);
  const confirmation = buildClaudeResetConfirmation(i18n.t, 'claude.json', parsed!, now);
  expect(confirmation.grantId()).toBe('full-reset-2611');
  const markup = renderToStaticMarkup(confirmation.message as ReactElement);
  expect(markup).toContain('One full limit reset (November 2026)');
  expect(markup).toContain('New model launch: one Fable reset for Max');
  expect(markup.match(/type="radio"/g)).toHaveLength(4);
});
