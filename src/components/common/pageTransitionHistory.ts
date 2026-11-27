import type { Location } from 'react-router-dom';

/**
 * React Router stores a key in the history state of every entry it creates. An entry it did not
 * create, such as a URL typed into the address bar or a hash edited in place, has no state, and
 * every such entry reads back with this same key. The key therefore cannot tell those entries
 * apart, and must not be used as a page's identity.
 */
export const UNTRACKED_HISTORY_KEY = 'default';

/** The key that identifies this history entry, or null when the entry is untracked. */
export const historyEntryKey = (location: Pick<Location, 'key'>): string | null =>
  location.key === UNTRACKED_HISTORY_KEY ? null : location.key;

/**
 * Whether moving from the shown location to the next one changes the page. Only the pathname
 * selects a page: the key is shared by untracked entries, and a search or hash change stays on
 * the same page.
 */
export const needsPageTransition = (
  shown: Pick<Location, 'pathname'> | undefined,
  next: Pick<Location, 'pathname'>
): boolean => shown?.pathname !== next.pathname;
