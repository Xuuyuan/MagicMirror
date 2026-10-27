import { bindExam, previewExamBinding, supportsExamBinding } from '../services/exam-binding';
import { accountStorage } from '../storage/accounts';
import { providerRegistry } from '../providers/registry';
import { ProviderError, type ExamBindingCandidate, type LocalAccount } from '../domain/models';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'fictional-id' }));
jest.mock('expo-secure-store', () => {
  const values = new Map<string, string>();
  return {
    setItemAsync: async (key: string, value: string) => {
      values.set(key, value);
    },
    getItemAsync: async (key: string) => values.get(key) ?? null,
    deleteItemAsync: async (key: string) => {
      values.delete(key);
    },
  };
});
const account: LocalAccount = {
  id: 'fictional-binding-account',
  revision: 'r1',
  label: '虚构',
  providerId: 'zhuxuebang',
  login: 'fictional',
  password: 'fictional-password',
  session: {
    providerId: 'zhuxuebang',
    accountId: 'fictional',
    accessToken: 'fictional-token',
    providerContext: { studentId: '11' },
  },
};
const candidate: ExamBindingCandidate = {
  examId: 'E1',
  examName: '虚构考试',
  studentId: '11',
  studentCode: '001234',
  displayName: '虚构学生',
  schoolName: '虚构学校',
  className: '虚构班级',
};
beforeEach(async () => {
  await accountStorage.save(account);
});
afterEach(() => jest.restoreAllMocks());

it('按方法探测入口，不改变七天的已有认领能力', () => {
  expect(supportsExamBinding(providerRegistry.get('zhuxuebang'))).toBe(true);
  expect(supportsExamBinding(providerRegistry.get('septnet'))).toBe(false);
  expect(supportsExamBinding(undefined)).toBe(false);
});

it('旧 revision 的核对和写入均被阻止', async () => {
  const provider = providerRegistry.get('zhuxuebang')!;
  const preview = jest.spyOn(provider, 'previewExamBinding');
  const write = jest.spyOn(provider, 'bindExam');
  const signal = new AbortController().signal;
  await expect(previewExamBinding(account.id, 'old', 'E1', '001234', signal)).rejects.toThrow(
    '账号已变更',
  );
  await expect(bindExam(account.id, 'old', candidate, signal)).rejects.toThrow('账号已变更');
  expect(preview).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});

it('绑定抛会话失效不会触发账号层重新登录和重复写入', async () => {
  const provider = providerRegistry.get('zhuxuebang')!;
  const write = jest
    .spyOn(provider, 'bindExam')
    .mockRejectedValue(new ProviderError('SESSION_EXPIRED', 'fictional expired'));
  const login = jest.spyOn(provider, 'authenticate');
  await expect(
    bindExam(account.id, account.revision, candidate, new AbortController().signal),
  ).rejects.toThrow('绑定未自动重试');
  expect(write).toHaveBeenCalledTimes(1);
  expect(login).not.toHaveBeenCalled();
});

it('取消的确认不调用写方法', async () => {
  const write = jest.spyOn(providerRegistry.get('zhuxuebang')!, 'bindExam');
  const controller = new AbortController();
  controller.abort();
  await expect(
    bindExam(account.id, account.revision, candidate, controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(write).not.toHaveBeenCalled();
});
