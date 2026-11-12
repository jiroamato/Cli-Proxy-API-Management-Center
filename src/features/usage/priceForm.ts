/**
 * Form model for the model price overrides dialog. Prices are edited as text
 * so a half-typed number never turns into NaN in state.
 */

import type { ModelPrice, UsageSettings } from '@/services/api/usageStats';

export interface PriceRow {
  id: number;
  model: string;
  /** Unpriced models found in the data keep a fixed name. */
  modelLocked: boolean;
  input: string;
  output: string;
  cacheRead: string;
  /** The stored override this row edits, kept so unedited fields survive a save. */
  base?: ModelPrice;
}

const numberText = (value: number | undefined): string =>
  value === undefined ? '' : String(value);

/** Unpriced models first (they need attention), then existing overrides by name. */
export function initialPriceRows(
  settings: UsageSettings,
  unpricedModels: readonly string[]
): PriceRow[] {
  let id = 0;
  const known = new Set(Object.keys(settings.modelPrices).map((model) => model.toLowerCase()));
  const unpriced = unpricedModels
    .filter((model) => model !== '' && !known.has(model.toLowerCase()))
    .map((model): PriceRow => ({
      id: id++,
      model,
      modelLocked: true,
      input: '',
      output: '',
      cacheRead: '',
    }));
  const overrides = Object.entries(settings.modelPrices)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([model, price]): PriceRow => ({
      id: id++,
      model,
      modelLocked: false,
      input: numberText(price.input),
      output: numberText(price.output),
      cacheRead: numberText(price.cacheRead),
      base: price,
    }));
  return [...unpriced, ...overrides];
}

/** Parses a price field: '' is unset (undefined), an invalid number is null. */
const parsePrice = (text: string): number | undefined | null => {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

/**
 * Builds the price overrides from the form. Rows with no model or no prices
 * are skipped; a row with an invalid or half-filled price makes the whole
 * form invalid (null).
 */
export function collectModelPrices(
  rows: readonly Pick<PriceRow, 'model' | 'input' | 'output' | 'cacheRead' | 'base'>[]
): Record<string, ModelPrice> | null {
  const prices: Record<string, ModelPrice> = {};
  for (const row of rows) {
    const model = row.model.trim();
    const input = parsePrice(row.input);
    const output = parsePrice(row.output);
    const cacheRead = parsePrice(row.cacheRead);
    if (input === null || output === null || cacheRead === null) return null;
    if (model === '' || (input === undefined && output === undefined && cacheRead === undefined)) {
      continue;
    }
    if (input === undefined || output === undefined) return null;
    const price: ModelPrice = { ...row.base, input, output };
    if (cacheRead === undefined) delete price.cacheRead;
    else price.cacheRead = cacheRead;
    prices[model] = price;
  }
  return prices;
}
