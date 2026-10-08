import { accountStorage } from '@/src/storage/accounts';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'fictional-uuid') }));
jest.mock('expo-secure-store', () => { const values = new Map<string, string>(); return { setItemAsync: jest.fn(async (key: string, value: string) => values.set(key, value)), getItemAsync: jest.fn(async (key: string) => values.get(key) ?? null), deleteItemAsync: jest.fn(async (key: string) => values.delete(key)) }; });

it('treats malformed account index and records as empty data', async () => {
  const SecureStore = jest.requireMock('expo-secure-store');
  await SecureStore.setItemAsync('magicmirror.accounts.v1', '{broken-json');
  expect(await accountStorage.list()).toEqual([]);
  await SecureStore.setItemAsync('magicmirror.accounts.v1', JSON.stringify(['fictional-account']));
  await SecureStore.setItemAsync('magicmirror.account.fictional-account', '{broken-json');
  expect(await accountStorage.list()).toEqual([]);
});
