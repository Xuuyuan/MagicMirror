import { confirmAccountSession, selectAccountProfile, withAccount } from '../services/accounts';
import { accountStorage } from '../storage/accounts';
import { providerRegistry } from '../providers/registry';
import { ProviderError, type AuthSession, type LocalAccount } from '../domain/models';
import type { ScoreProvider } from '../providers/types';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'new-revision' }));
jest.mock('expo-secure-store', () => {
  const values = new Map<string, string>();
  return { setItemAsync: async (key: string, value: string) => { values.set(key, value); }, getItemAsync: async (key: string) => values.get(key) ?? null, deleteItemAsync: async (key: string) => { values.delete(key); } };
});
const session: AuthSession = { providerId: 'fictional', accountId: 'parent', accessToken: 'old', providerContext: { student: 'b' }, expiresAt: 0 };
const account: LocalAccount = { id: 'account', revision: 'r1', label: '虚构', login: 'parent', providerId: 'fictional', session, selectedProfile: { id: 'b', displayName: '虚构学生乙' } };
let provider: ScoreProvider;
beforeEach(async () => {
  provider = {
    metadata: { id: 'fictional', name: '虚构', description: '' }, capabilities: { profile: true, exams: true, results: true, ranking: false },
    authenticate: jest.fn(), getProfile: jest.fn(), getExamList: jest.fn(), getExamResult: jest.fn(), logout: jest.fn(),
    refreshSession: jest.fn(async () => ({ ...session, accessToken: 'renewed', expiresAt: Date.now() + 60000, providerContext: { student: 'a' } })),
    getProfiles: jest.fn(async (value) => [{ id: value.providerContext!.student, displayName: '虚构学生', selected: true }]),
    selectProfile: jest.fn(async (value, id) => ({ ...value, providerContext: { student: id } })),
  };
  jest.spyOn(providerRegistry, 'get').mockReturnValue(provider);
  await accountStorage.save(account);
});
afterEach(() => jest.restoreAllMocks());

it('refresh returning the default student restores and verifies the saved student before querying', async () => {
  await expect(withAccount(account.id, async (_provider, value) => value.providerContext!.student)).resolves.toBe('b');
  expect(provider.selectProfile).toHaveBeenCalledTimes(1);
  expect((await accountStorage.load(account.id))?.selectedProfile?.id).toBe('b');
});
it('stops queries when selecting the saved student cannot be confirmed', async () => {
  jest.mocked(provider.selectProfile!).mockImplementation(async (value) => value);
  const operation = jest.fn();
  await expect(withAccount(account.id, operation)).rejects.toMatchObject({ code: 'RESTRICTED' });
  expect(operation).not.toHaveBeenCalled();
  expect((await accountStorage.load(account.id))?.session?.accessToken).toBe('old');
});
it('rejects a different parent even when the provider matches', async () => {
  await expect(confirmAccountSession(account, { ...session, accountId: 'other-parent' })).rejects.toMatchObject({ code: 'RESTRICTED' });
  expect(provider.selectProfile).not.toHaveBeenCalled();
});
it('does not overwrite a newer token saved while refresh is running', async () => {
  jest.mocked(provider.refreshSession!).mockImplementation(async () => {
    await accountStorage.updateSession(account.id, account.revision, { ...session, accessToken: 'newest' });
    return { ...session, accessToken: 'late' };
  });
  await expect(withAccount(account.id, jest.fn())).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  expect((await accountStorage.load(account.id))?.session?.accessToken).toBe('newest');
});
it('coalesces concurrent recovery and restores the student once', async () => {
  await Promise.all([withAccount(account.id, async () => []), withAccount(account.id, async () => [])]);
  expect(provider.refreshSession).toHaveBeenCalledTimes(1);
  expect(provider.selectProfile).toHaveBeenCalledTimes(1);
});
it('does not replay a remote student mutation after an expired response', async () => {
  await accountStorage.save({ ...account, session: { ...session, expiresAt: undefined } });
  jest.mocked(provider.selectProfile!).mockRejectedValue(new ProviderError('SESSION_EXPIRED', 'uncertain selection'));
  await expect(selectAccountProfile(account.id, 'a')).rejects.toThrow('uncertain selection');
  expect(provider.selectProfile).toHaveBeenCalledTimes(1);
  expect(provider.refreshSession).not.toHaveBeenCalled();
  expect((await accountStorage.load(account.id))?.session?.expiresAt).toBe(0);
});
it('keeps a newly edited account when recovery finishes late', async () => {
  jest.mocked(provider.refreshSession!).mockImplementation(async () => {
    await accountStorage.save({ ...account, revision: 'edited', session: { ...session, accessToken: 'edited' } });
    return session;
  });
  await expect(withAccount(account.id, jest.fn())).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  expect((await accountStorage.load(account.id))?.revision).toBe('edited');
});
