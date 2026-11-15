import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '../src/i18n/index';
import en from '../src/i18n/locales/en.json';
import ko from '../src/i18n/locales/ko.json';
import ru from '../src/i18n/locales/ru.json';
import vi from '../src/i18n/locales/vi.json';
import zhCN from '../src/i18n/locales/zh-CN.json';
import zhTW from '../src/i18n/locales/zh-TW.json';
import type { UsageGroup } from '../src/services/api/usageStats';
import { TurnsFigures } from '../src/features/usage/components/TurnsPanel';
import { emptyMetrics } from '../src/features/usage/logic';
import { buildTurnFigures, type TurnsSource } from '../src/features/usage/turns';

const group = (dimensions: Record<string, string>, fields: Partial<UsageGroup>): UsageGroup => ({
  ...emptyMetrics(),
  dimensions,
  sessions: 0,
  ...fields,
});

const OCT_NOV = {
  from: new Date(2026, 9, 16).getTime(),
  to: new Date(2026, 10, 14, 15, 30).getTime(),
  bucket: 'day' as const,
};

const render = (source: Partial<TurnsSource>) =>
  renderToStaticMarkup(
    createElement(TurnsFigures, {
      figures: buildTurnFigures(
        { total: null, main: null, months: [], monthStops: [], ...source },
        OCT_NOV
      ),
    })
  );

describe('TurnsFigures rendering', () => {
  test('says turns were not recorded instead of showing zero', () => {
    const markup = render({
      total: group({}, { requests: 4, sessions: 2, costUsd: 1 }),
      monthStops: [group({ month: '2026-11', stop_reason: '' }, { requests: 4 })],
    });
    expect(markup).toContain(i18n.t('usage.turns.not_recorded'));
    expect(markup).toContain(i18n.t('usage.turns.unrecorded_notice'));
    expect(markup).toContain(i18n.t('usage.turns.no_data'));
  });

  test('shows a recorded zero as 0, not as missing', () => {
    const markup = render({
      total: group({}, { requests: 3, sessions: 1 }),
      monthStops: [group({ month: '2026-11', stop_reason: 'tool_use' }, { requests: 3 })],
    });
    expect(markup).toMatch(/<dd[^>]*>0<\/dd>/);
    expect(markup).not.toContain(i18n.t('usage.turns.not_recorded'));
    expect(markup).not.toContain('role="status"');
  });

  test('tells how many replies recorded no stop reason', () => {
    const markup = render({
      total: group({}, { requests: 10, turns: 2, sessions: 1 }),
      monthStops: [
        group({ month: '2026-11', stop_reason: 'end_turn' }, { requests: 2, turns: 2 }),
        group({ month: '2026-11', stop_reason: 'tool_use' }, { requests: 2 }),
        group({ month: '2026-11', stop_reason: '' }, { requests: 6 }),
      ],
    });
    expect(markup).toContain(i18n.t('usage.turns.partial_notice', { share: '60%', value: '6' }));
  });

  test('never rounds a share of unrecorded requests down to zero', () => {
    const markup = render({
      total: group({}, { requests: 4001, turns: 1000, sessions: 1 }),
      monthStops: [
        group({ month: '2026-11', stop_reason: 'end_turn' }, { requests: 4000, turns: 1000 }),
        group({ month: '2026-11', stop_reason: '' }, { requests: 1 }),
      ],
    });
    expect(markup).toContain('&lt;0.1%');
  });

  test('marks a month the range cuts short with the days it covers', () => {
    const markup = render({
      total: group({}, { requests: 3, turns: 2, sessions: 2 }),
      months: [
        group({ month: '2026-10' }, { requests: 1, turns: 1, sessions: 1 }),
        group({ month: '2026-11' }, { requests: 2, turns: 1, sessions: 1 }),
      ],
      monthStops: [
        group({ month: '2026-10', stop_reason: 'end_turn' }, { requests: 1, turns: 1 }),
        group({ month: '2026-11', stop_reason: 'end_turn' }, { requests: 2, turns: 1 }),
      ],
    });
    const day = new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric' });
    const lastDay = new Intl.DateTimeFormat(i18n.language, { day: 'numeric' });
    expect(markup).toContain(
      i18n.t('usage.turns.month_span', {
        from: day.format(new Date(2026, 9, 16)),
        to: lastDay.format(new Date(2026, 9, 31)),
      })
    );
  });

  test('says a month without requests had none instead of showing zero turns', () => {
    const markup = renderToStaticMarkup(
      createElement(TurnsFigures, {
        figures: buildTurnFigures(
          {
            total: group({}, { requests: 4, turns: 2, sessions: 2 }),
            main: null,
            months: [
              group({ month: '2026-09' }, { requests: 2, turns: 1, sessions: 1 }),
              group({ month: '2026-11' }, { requests: 2, turns: 1, sessions: 1 }),
            ],
            monthStops: [
              group({ month: '2026-09', stop_reason: 'end_turn' }, { requests: 2, turns: 1 }),
              group({ month: '2026-11', stop_reason: 'end_turn' }, { requests: 2, turns: 1 }),
            ],
          },
          { ...OCT_NOV, from: new Date(2026, 8, 1).getTime() }
        ),
      })
    );
    expect(markup).toContain(i18n.t('usage.turns.no_requests'));
  });
});

describe('turns and cache write strings', () => {
  const locales = { ko, ru, vi, 'zh-CN': zhCN, 'zh-TW': zhTW };
  const cacheWriteKeys = ['cache_write_5m', 'cache_write_1h', 'cache_write_unsplit'] as const;

  test.each(Object.entries(locales))('%s has every string English has', (_, locale) => {
    expect(Object.keys(locale.usage.turns).sort()).toEqual(Object.keys(en.usage.turns).sort());
    for (const value of Object.values(locale.usage.turns)) expect(value.trim()).not.toBe('');
    for (const key of cacheWriteKeys) expect(locale.usage.tokens[key].trim()).not.toBe('');
  });
});
