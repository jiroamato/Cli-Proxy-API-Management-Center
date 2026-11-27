import { describe, expect, test } from 'bun:test';
import {
  UNTRACKED_HISTORY_KEY,
  historyEntryKey,
  needsPageTransition,
} from '@/components/common/pageTransitionHistory';

// A hash typed into the address bar, or set with `location.hash = ...`, has no history state.
const untracked = (pathname: string) => ({ pathname, key: UNTRACKED_HISTORY_KEY });

describe('page transition history', () => {
  test('changes page between two untracked entries that share a key', () => {
    // The shown page was itself reached by an edited hash, so both locations read back as
    // "default". Matching on the key left the old page on screen under the new URL.
    expect(needsPageTransition(untracked('/quota'), untracked('/quick-start'))).toBe(true);
  });

  test('changes page between tracked entries with different pathnames', () => {
    expect(needsPageTransition({ pathname: '/' }, { pathname: '/usage' })).toBe(true);
    expect(needsPageTransition(undefined, { pathname: '/usage' })).toBe(true);
  });

  test('stays on the page when only the search or the history entry changes', () => {
    expect(needsPageTransition({ pathname: '/config' }, { pathname: '/config' })).toBe(false);
    expect(needsPageTransition(untracked('/config'), untracked('/config'))).toBe(false);
  });

  test('untracked entries have no history key', () => {
    expect(historyEntryKey(untracked('/quota'))).toBeNull();
    expect(historyEntryKey({ key: 'k3x9a2' })).toBe('k3x9a2');
  });
});
