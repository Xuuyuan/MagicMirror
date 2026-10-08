import { authenticateAccount, withAccount } from '@/src/services/accounts';
import { accountStorage } from '@/src/storage/accounts';
import { providerRegistry } from '@/src/providers/registry';
import { ProviderError, type LocalAccount } from '@/src/domain/models';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'fictional-uuid') }));
jest.mock('expo-secure-store', () => {
  const values = new Map<string, string>();
  return { setItemAsync: jest.fn(async (key: string, value: string) => { values.set(key, value); }), getItemAsync: jest.fn(async (key: string) => values.get(key) ?? null), deleteItemAsync: jest.fn(async (key: string) => { values.delete(key); }) };
});

const base: LocalAccount = { id: 'fictional-account', revision: 'r1', label: '虚构', providerId: 'haofenshu-parent', login: 'fictional', authMode: 'token', session: { providerId: 'haofenshu-parent', accountId: 'fictional', accessToken: 'TEST_TOKEN' } };
afterEach(() => jest.restoreAllMocks());

it('persists token mode in secure storage and stops reusing a confirmed expired token', async () => {
  await accountStorage.save(base);
  const operation = jest.fn(async () => { throw new ProviderError('SESSION_EXPIRED', 'expired'); });
  await expect(withAccount(base.id, operation)).rejects.toThrow('Token 已失效');
  expect((await accountStorage.load(base.id))?.session?.expiresAt).toBe(0);
  await expect(withAccount(base.id, operation)).rejects.toThrow('Token 已失效');
  expect(operation).toHaveBeenCalledTimes(1);
});

it('preserves the saved password when an account is edited with a blank password', async () => {
  await accountStorage.save({ ...base, authMode: 'password', password: 'fictional-password' });
  const provider = providerRegistry.get(base.providerId)!;
  const login = jest.spyOn(provider, 'authenticate').mockResolvedValue(base.session!);
  const account = await authenticateAccount({ id: base.id, label: base.label, providerId: base.providerId, login: base.login, password: '' });
  expect(login).toHaveBeenCalledWith(base.login, 'fictional-password');
  expect(account.password).toBe('fictional-password');
});

it('replaces a token without retaining the old password', async () => {
  await accountStorage.save({ ...base, authMode: 'password', password: 'fictional-password' });
  const provider = providerRegistry.get(base.providerId)!;
  jest.spyOn(provider, 'authenticateWithToken').mockResolvedValue({ ...base.session!, accessToken: 'NEW_TEST_TOKEN' });
  const account = await authenticateAccount({ id: base.id, label: base.label, providerId: base.providerId, login: base.login, token: 'NEW_TEST_TOKEN' });
  expect(account.authMode).toBe('token');
  expect(account.password).toBeUndefined();
  await accountStorage.save(account);
  const operation = jest.fn(async () => []);
  await expect(withAccount(base.id, operation)).resolves.toEqual([]);
  expect(operation.mock.calls).toHaveLength(1);
});

it('does not mark a token expired on transient network errors', async () => {
  await accountStorage.save(base);
  await expect(withAccount(base.id, async () => { throw new ProviderError('NETWORK', 'network'); })).rejects.toMatchObject({ code: 'NETWORK' });
  expect((await accountStorage.load(base.id))?.session?.expiresAt).toBeUndefined();
});

it('does not recover or retry after the query has been cancelled', async () => {
  await accountStorage.save(base);
  const controller = new AbortController();
  controller.abort();
  const operation = jest.fn(async () => []);
  await expect(withAccount(base.id, operation, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(operation).not.toHaveBeenCalled();
});

it('does not overwrite a newer session when invalidating an old token', async () => {
  await accountStorage.save({ ...base, session: { ...base.session!, accessToken: 'NEW_TEST_TOKEN' } });
  expect(await accountStorage.updateSession(base.id, base.revision, { ...base.session!, expiresAt: 0 }, 'TEST_TOKEN')).toBe(false);
  expect((await accountStorage.load(base.id))?.session?.accessToken).toBe('NEW_TEST_TOKEN');
});
