import { describe, expect, test } from 'bun:test';
import { collectModelPrices, initialPriceRows } from '../src/features/usage/priceForm';

const row = (model: string, input: string, output: string, cacheRead = '') => ({
  model,
  input,
  output,
  cacheRead,
});

describe('initialPriceRows', () => {
  const settings = {
    modelPrices: {
      zeta: { input: 1, output: 2 },
      Alpha: { input: 3, output: 4, cacheRead: 0.3, cacheWrite1h: 6 },
    },
    accountPlans: [],
  };

  test('lists unpriced models first with locked names, then overrides by name', () => {
    const rows = initialPriceRows(settings, ['mystery', 'alpha', '']);
    expect(rows.map((item) => [item.model, item.modelLocked])).toEqual([
      ['mystery', true],
      ['Alpha', false],
      ['zeta', false],
    ]);
    expect(rows[1]).toMatchObject({ input: '3', output: '4', cacheRead: '0.3' });
    expect(new Set(rows.map((item) => item.id)).size).toBe(rows.length);
  });
});

describe('collectModelPrices', () => {
  test('keeps filled rows and skips rows without a model or without prices', () => {
    expect(
      collectModelPrices([
        row('model-a', '1.5', '6', '0.15'),
        row('model-b', '2', '8'),
        row('still-unpriced', '', ''),
        row('', '1', '2'),
      ])
    ).toEqual({
      'model-a': { input: 1.5, output: 6, cacheRead: 0.15 },
      'model-b': { input: 2, output: 8 },
    });
  });

  test('preserves price fields the form does not edit', () => {
    const base = { input: 3, output: 4, cacheRead: 0.3, cacheWrite1h: 6 };
    expect(collectModelPrices([{ ...row('alpha', '5', '4', ''), base }])).toEqual({
      alpha: { input: 5, output: 4, cacheWrite1h: 6 },
    });
  });

  test('rejects invalid and half-filled prices', () => {
    expect(collectModelPrices([row('m', '-1', '2')])).toBeNull();
    expect(collectModelPrices([row('m', 'abc', '2')])).toBeNull();
    expect(collectModelPrices([row('m', '1', '')])).toBeNull();
    expect(collectModelPrices([row('m', '', '', '0.1')])).toBeNull();
  });

  test('accepts zero as a real price', () => {
    expect(collectModelPrices([row('free', '0', '0')])).toEqual({ free: { input: 0, output: 0 } });
  });
});
