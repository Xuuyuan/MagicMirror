import { beginWebLogin, isAllowedLoginUrl } from '../services/web-login';
import { providerRegistry } from '../providers/registry';
import { accountStorage } from '../storage/accounts';
import type { AuthSession, LocalAccount } from '../domain/models';
import type { ScoreProvider } from '../providers/types';
import * as SecureStore from 'expo-secure-store';

jest.mock('expo-crypto', () => {
  let id = 0;
  return { randomUUID: () => `fictional-${++id}` };
});
jest.mock('expo-secure-store', () => {
  const values = new Map<string, string>();
  return {
    setItemAsync: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    getItemAsync: async (key: string) => values.get(key) ?? null,
    deleteItemAsync: async (key: string) => {
      values.delete(key);
    },
  };
});
const session: AuthSession = {
  providerId: 'fictional',
  accountId: 'parent',
  accessToken: 'fictional-token',
};
const profile = { id: 'student', displayName: '虚构学生' };
let provider: ScoreProvider;
let attempt: Awaited<ReturnType<typeof beginWebLogin>> | undefined;
const message = (value: NonNullable<typeof attempt>, payload: unknown = {}) =>
  JSON.stringify({ kind: 'official-session', attemptId: value.script, payload });
beforeEach(() => {
  provider = {
    metadata: { id: 'fictional', name: '虚构', description: '' },
    capabilities: { profile: true, exams: true, results: true, ranking: false },
    authenticate: jest.fn(),
    getProfile: jest.fn(async () => profile),
    getExamList: jest.fn(async () => []),
    getExamResult: jest.fn(),
    logout: jest.fn(),
    webLogin: {
      url: 'https://www.zhixue.com/',
      allowedOrigins: ['https://www.zhixue.com'],
      script: (id) => id,
      authenticate: jest.fn(async () => session),
    },
  };
  jest.spyOn(providerRegistry, 'get').mockReturnValue(provider);
});
afterEach(() => {
  attempt?.cancel();
  attempt = undefined;
  jest.restoreAllMocks();
});
it('validates HTTPS origins including credentials, ports and lookalike hosts', () => {
  for (const url of [
    'http://www.zhixue.com/',
    'https://www.zhixue.com.evil.test/',
    'https://evil@www.zhixue.com/',
    'https://www.zhixue.com:444/',
  ]) {
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
  await attempt.complete(
    JSON.stringify({ kind: 'official-session', attemptId: 'stale' }),
    'https://www.zhixue.com/',
  );
  await attempt.complete(message(attempt), 'https://evil.test/');
  expect(provider.webLogin!.authenticate).not.toHaveBeenCalled();
});
it('does not save a candidate after cancellation during validation', async () => {
  attempt = await beginWebLogin({ providerId: 'fictional', label: '' });
  jest.mocked(provider.webLogin!.authenticate).mockImplementation(async () => {
    attempt!.cancel();
    return session;
  });
  await expect(attempt.complete(message(attempt), 'https://www.zhixue.com/')).rejects.toThrow(
    '取消',
  );
});
it('serializes WebView attempts without touching global cookies', async () => {
  attempt = await beginWebLogin({ providerId: 'fictional', label: '' });
  await expect(beginWebLogin({ providerId: 'fictional', label: '' })).rejects.toThrow('已有');
});
it('reports a scoped preparation error without authenticating or saving a session', async () => {
  attempt = await beginWebLogin({ providerId: 'fictional', label: '' });
  const raw = JSON.stringify({ kind: 'official-login-error', attemptId: attempt.script });
  await expect(attempt.complete(raw, 'https://evil.test/')).resolves.toBeUndefined();
  await expect(attempt.complete(raw, 'https://www.zhixue.com/')).rejects.toThrow('准备官方登录');
  expect(provider.webLogin!.authenticate).not.toHaveBeenCalled();
  await expect(attempt.commit()).rejects.toThrow('验证');
});
it('releases a pending attempt immediately when its screen unmounts', async () => {
  const controller = new AbortController();
  const pending = beginWebLogin(
    { providerId: 'fictional', id: 'missing', label: '' },
    controller.signal,
  );
  controller.abort();
  attempt = await beginWebLogin({ providerId: 'fictional', label: '' });
  await expect(pending).rejects.toThrow('取消');
  expect(attempt).toBeDefined();
});
const previous: LocalAccount = {
  id: 'saved-account',
  revision: 'r1',
  label: '旧备注',
  providerId: 'fictional',
  login: 'parent',
  session,
  selectedProfile: profile,
};
it('rejects a different parent during relogin and keeps the old account', async () => {
  await accountStorage.save(previous);
  attempt = await beginWebLogin({ id: previous.id, providerId: 'fictional', label: '' });
  jest
    .mocked(provider.webLogin!.authenticate)
    .mockResolvedValue({ ...session, accountId: 'other-parent' });
  await expect(attempt.complete(message(attempt), 'https://www.zhixue.com/')).rejects.toThrow(
    '身份',
  );
  expect((await accountStorage.load(previous.id))?.revision).toBe('r1');
});
it('requires explicit confirmation to replace a student and resets only student configuration', async () => {
  await accountStorage.save({ ...previous, academicYear: 'fictional-year' });
  attempt = await beginWebLogin({ id: previous.id, providerId: 'fictional', label: '' });
  const nextProfile = { id: 'other-student', displayName: '虚构新学生', schoolName: '虚构学校' };
  jest.mocked(provider.getProfile).mockResolvedValue(nextProfile);
  await attempt.complete(message(attempt), 'https://www.zhixue.com/');
  expect(attempt.previousProfile).toEqual(profile);
  expect(attempt.requiresStudentReplacement).toBe(true);
  await expect(attempt.commit()).rejects.toThrow('确认替换');
  expect(await accountStorage.load(previous.id)).toMatchObject({
    revision: 'r1',
    selectedProfile: profile,
    academicYear: 'fictional-year',
  });
  await attempt.commit({ replaceStudent: true });
  const saved = await accountStorage.load(previous.id);
  expect(saved).toMatchObject({
    id: previous.id,
    selectedProfile: nextProfile,
    label: previous.label,
  });
  expect(saved?.academicYear).toBeUndefined();
  expect(saved?.revision).not.toBe(previous.revision);
});
it('preserves the old student and settings when replacement is cancelled', async () => {
  const original = { ...previous, academicYear: 'fictional-year' };
  await accountStorage.save(original);
  attempt = await beginWebLogin({ id: previous.id, providerId: 'fictional', label: '' });
  jest.mocked(provider.getProfile).mockResolvedValue({ ...profile, id: 'other-student' });
  await attempt.complete(message(attempt), 'https://www.zhixue.com/');
  attempt.cancel();
  await expect(attempt.commit({ replaceStudent: true })).rejects.toThrow('验证');
  expect(await accountStorage.load(previous.id)).toEqual(original);
});
it('keeps the academic year when relogin returns the same student', async () => {
  await accountStorage.save({ ...previous, academicYear: 'fictional-year' });
  attempt = await beginWebLogin({ id: previous.id, providerId: 'fictional', label: '' });
  await attempt.complete(message(attempt), 'https://www.zhixue.com/');
  expect(attempt.requiresStudentReplacement).toBe(false);
  await attempt.commit();
  expect((await accountStorage.load(previous.id))?.academicYear).toBe('fictional-year');
});
it('rechecks the new student and concurrent edits before replacing', async () => {
  await accountStorage.save(previous);
  attempt = await beginWebLogin({ id: previous.id, providerId: 'fictional', label: '' });
  jest.mocked(provider.getProfile).mockResolvedValue({ ...profile, id: 'other-student' });
  await attempt.complete(message(attempt), 'https://www.zhixue.com/');
  jest.mocked(provider.getProfile).mockResolvedValue({ ...profile, id: 'third-student' });
  await expect(attempt.commit({ replaceStudent: true })).rejects.toThrow('学生已变化');
  expect((await accountStorage.load(previous.id))?.selectedProfile).toEqual(profile);
  jest.mocked(provider.getProfile).mockResolvedValue({ ...profile, id: 'other-student' });
  await accountStorage.save({ ...previous, revision: 'edited' });
  await expect(attempt.commit({ replaceStudent: true })).rejects.toThrow('变更');
  expect((await accountStorage.load(previous.id))?.revision).toBe('edited');
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
  jest
    .mocked(SecureStore.setItemAsync)
    .mockRejectedValueOnce(new Error('fictional storage failure'));
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
