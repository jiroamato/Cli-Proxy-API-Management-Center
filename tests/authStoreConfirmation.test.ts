import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { apiClient } from '@/services/api/client';
import { useAuthStore } from '@/stores/useAuthStore';
import { useConfigStore } from '@/stores/useConfigStore';
import { useNotificationStore } from '@/stores/useNotificationStore';

const spies: Array<{ mockRestore(): void }> = [];
const originalFetchConfig = useConfigStore.getState().fetchConfig;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const memory = new Map<string, string>();
beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
    },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { host: 'proxy.invalid' } },
  });
});
afterAll(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});
afterEach(() => {
  spies.splice(0).forEach((spy) => spy.mockRestore());
  useConfigStore.setState({ fetchConfig: originalFetchConfig });
  useNotificationStore.getState().hideConfirmation();
  apiClient.setConfig({ apiBase: '', managementKey: '' });
  useAuthStore.setState({ isAuthenticated: false, connectionStatus: 'disconnected' });
});

let confirmed = 0;
const openConfirmation = () =>
  useNotificationStore.getState().showConfirmation({
    title: 'Reset',
    message: 'Spend a reset?',
    onConfirm: () => {
      confirmed += 1;
    },
  });

describe('pending confirmations on a connection change', () => {
  test('logout closes a pending confirmation without running it', () => {
    confirmed = 0;
    openConfirmation();
    useAuthStore.getState().logout();
    expect(useNotificationStore.getState().confirmation.isOpen).toBe(false);
    expect(confirmed).toBe(0);
  });

  test('login closes a pending confirmation before connecting', async () => {
    confirmed = 0;
    const error = Object.assign(new Error('unauthorized'), { status: 401 });
    spies.push(spyOn(useConfigStore.getState(), 'fetchConfig').mockRejectedValue(error));
    openConfirmation();
    await expect(
      useAuthStore.getState().login({
        apiBase: 'https://proxy.invalid/gateway',
        managementKey: 'fixture-only',
        rememberPassword: false,
      })
    ).rejects.toThrow('unauthorized');
    expect(useNotificationStore.getState().confirmation.isOpen).toBe(false);
    expect(confirmed).toBe(0);
  });
});
