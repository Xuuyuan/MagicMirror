import { beginWebLogin, isAllowedLoginUrl } from '../services/web-login';
import { providerRegistry } from '../providers/registry';
import { accountStorage } from '../storage/accounts';
import type { AuthSession, LocalAccount } from '../domain/models';
import type { ScoreProvider } from '../providers/types';
import * as SecureStore from 'expo-secure-store';

jest.mock('expo-crypto', () => { let id = 0; return { randomUUID: () => `fictional-${++id}` }; });
jest.mock('expo-secure-store', () => {
  const values = new Map<string, string>();
  return { setItemAsync: jest.fn(async (key: string, value: string) => { values.set(key, value); }), getItemAsync: async (key: string) => values.get(key) ?? null, deleteItemAsync: async (key: string) => { values.delete(key); } };
});
const session: AuthSession = { providerId: 'fictional', accountId: 'parent', accessToken: 'fictional-token' };
const profile = { id: 'student', displayName: '虚构学生' };
let provider: ScoreProvider;
let attempt: Awaited<ReturnType<typeof beginWebLogin>> | undefined;
const message = (value: NonNullable<typeof attempt>, payload: unknown = {}) => JSON.stringify({ kind: 'official-session', attemptId: value.script, payload });
beforeEach(() => {
  provider = {
    metadata: { id: 'fictional', name: '虚构', description: '' }, capabilities: { profile: true, exams: true, results: true, ranking: false },
    authenticate: jest.fn(), getProfile: jest.fn(async () => profile), getExamList: jest.fn(async () => []), getExamResult: jest.fn(), logout: jest.fn(),
    webLogin: { url: 'https://www.zhixue.com/', allowedOrigins: ['https://www.zhixue.com'], script: (id) => id, authenticate: jest.fn(async () => session) },
  };
  jest.spyOn(providerRegistry, 'get').mockReturnValue(provider);
});
afterEach(() => { attempt?.cancel(); attempt = undefined; jest.restoreAllMocks(); });
it('validates HTTPS origins including credentials, ports and lookalike hosts', () => {
  for (const url of ['http://www.zhixue.com/', 'https://www.zhixue.com.evil.test/', 'https://evil@www.zhixue.com/', 'https://www.zhixue.com:444/']) {
    expect(isAllowedLoginUrl(url, provider.webLogin!.allowedOrigins)).toBe(false);
  }
});
it('saves only verified session material and does not require any exams', async () => {
  attempt = await beginWebLogin({ providerId: 'fictional', label: '测试备注' });
  const saved = await attempt.complete(message(attempt), 'https://www.zhixue.com/report');
  expect(saved).toMatchObject({ authMode: 'webview', selectedProfile: profile, label: '测试备注' });
  expect(saved?.password).toBeUndefined();
  expect(await accountStorage.load(saved!.id)).toBeNull();
  await attempt.commit();
  expect(await accountStorage.load(saved!.id)).toMatchObject({ authMode: 'webview' });
  expect(provider.getExamList).not.toHaveBeenCalled();
  expect(await attempt.complete(message(attempt), 'https://www.zhixue.com/')).toBeUndefined();
});
it('ignores malformed, stale and foreign-origin messages without authenticating', async () => {
  attempt = await beginWebLogin({ providerId: 'fictional', label: '' });
  await attempt.complete('not-json', 'https://www.zhixue.com/');
  await attempt.complete(JSON.stringify({ kind: 'official-session', attemptId: 'stale' }), 'https://www.zhixue.com/');
  await attempt.complete(message(attempt), 'https://evil.test/');
  expect(provider.webLogin!.authenticate).not.toHaveBeenCalled();
});
it('does not save a candidate after cancellation during validation', async () => {
  attempt = await beginWebLogin({ providerId: 'fictional', label: '' });
  jest.mocked(provider.webLogin!.authenticate).mockImplementation(async () => { attempt!.cancel(); return session; });
  await expect(attempt.complete(message(attempt), 'https://www.zhixue.com/')).rejects.toThrow('取消');
});
it('serializes WebView attempts without touching global cookies', async () => {
  attempt = await beginWebLogin({ providerId: 'fictional', label: '' });
  await expect(beginWebLogin({ providerId: 'fictional', label: '' })).rejects.toThrow('已有');
});
it('releases a pending attempt immediately when its screen unmounts', async () => {
  const controller = new AbortController();
  const pending = beginWebLogin({ providerId: 'fictional', id: 'missing', label: '' }, controller.signal);
  controller.abort();
  attempt = await beginWebLogin({ providerId: 'fictional', label: '' });
  await expect(pending).rejects.toThrow('取消');
  expect(attempt).toBeDefined();
});
const previous: LocalAccount = { id: 'saved-account', revision: 'r1', label: '旧备注', providerId: 'fictional', login: 'parent', session, selectedProfile: profile };
it('rejects a different parent during relogin and keeps the old account', async () => {
  await accountStorage.save(previous);
  attempt = await beginWebLogin({ id: previous.id, providerId: 'fictional', label: '' });
  jest.mocked(provider.webLogin!.authenticate).mockResolvedValue({ ...session, accountId: 'other-parent' });
  await expect(attempt.complete(message(attempt), 'https://www.zhixue.com/')).rejects.toThrow('身份');
  expect((await accountStorage.load(previous.id))?.revision).toBe('r1');
});
it('rejects a different student when student switching is unavailable', async () => {
  await accountStorage.save(previous);
  attempt = await beginWebLogin({ id: previous.id, providerId: 'fictional', label: '' });
  jest.mocked(provider.getProfile).mockResolvedValue({ ...profile, id: 'other-student' });
  await expect(attempt.complete(message(attempt), 'https://www.zhixue.com/')).rejects.toThrow('学生');
});
it('refuses to overwrite an account edited after login started', async () => {
  await accountStorage.save(previous);
  attempt = await beginWebLogin({ id: previous.id, providerId: 'fictional', label: '' });
  await accountStorage.save({ ...previous, revision: 'edited' });
  await attempt.complete(message(attempt), 'https://www.zhixue.com/');
  await expect(attempt.commit()).rejects.toThrow('变更');
});
it('propagates secure-store failure without reporting login success', async () => {
  attempt = await beginWebLogin({ providerId: 'fictional', label: '' });
  jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('fictional storage failure'));
  await attempt.complete(message(attempt), 'https://www.zhixue.com/');
  await expect(attempt.commit()).rejects.toThrow('storage failure');
});
it('rechecks the student when confirming a previously prepared account', async () => {
  attempt = await beginWebLogin({ providerId: 'fictional', label: '' });
  const prepared = await attempt.complete(message(attempt), 'https://www.zhixue.com/');
  jest.mocked(provider.getProfile).mockResolvedValue({ ...profile, id: 'changed' });
  await expect(attempt.commit()).rejects.toThrow('学生已变化');
  expect(await accountStorage.load(prepared!.id)).toBeNull();
});
