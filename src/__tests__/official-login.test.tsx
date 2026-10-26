/** @jest-environment jsdom */
import { act, type ReactNode } from 'react';
import { QueryClient } from '@tanstack/react-query';
import OfficialLogin from '../../app/official-login';
import { beginWebLogin } from '../services/web-login';

const { createRoot } = jest.requireActual<{
  createRoot: (element: Element) => { render: (node: ReactNode) => void; unmount: () => void };
}>('react-dom/client');
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mockClient = new QueryClient();
const mockReload = jest.fn();
const mockSwitch = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => mockClient,
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ providerId: 'fictional', id: 'account-a', draft: 'draft' }),
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
}));
jest.mock('../accounts-context', () => ({
  useAccounts: () => ({ reload: mockReload, switchAccount: mockSwitch }),
}));
jest.mock('../services/web-login-draft', () => ({
  takeWebLoginCredentials: () => ({ login: 'fictional-login', password: 'fictional-password' }),
}));
jest.mock('../services/web-login', () => ({
  beginWebLogin: jest.fn(),
  isAllowedLoginUrl: () => true,
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'fictional-id' }));
jest.mock('expo-secure-store', () => ({}));
jest.mock('../providers/registry', () => ({ providerRegistry: { get: jest.fn() } }));
jest.mock('react-native', () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('../ui', () => ({
  Screen: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Header: () => null,
  LoadingState: () => null,
  backOrHome: () => mockBack(),
}));
jest.mock('react-native-paper', () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
jest.mock('react-native-webview', () => ({
  WebView: ({ onMessage }: { onMessage: (event: unknown) => void }) => (
    <button
      onClick={() =>
        onMessage({ nativeEvent: { data: 'fictional-session', url: 'https://official.test/' } })
      }
    >
      模拟官方登录完成
    </button>
  ),
}));

const oldProfile = {
  id: 'old-student',
  displayName: '虚构原学生',
  schoolName: '虚构原学校',
  grade: '高一',
};
const newProfile = {
  id: 'new-student',
  displayName: '虚构新学生',
  schoolName: '虚构新学校',
  grade: '高二',
};
const account = { id: 'account-a', revision: 'r2', selectedProfile: newProfile };
let attempt: Awaited<ReturnType<typeof beginWebLogin>>;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  jest.clearAllMocks();
  mockClient.clear();
  mockClient.setQueryData(['account', 'account-a', 'r1', 'exams'], ['old-exam']);
  mockClient.setQueryData(['account', 'account-a', 'r1', 'result', 'old-exam'], ['old-score']);
  mockClient.setQueryData(['account', 'account-b', 'r1', 'exams'], ['other-exam']);
  attempt = {
    url: 'https://official.test/',
    allowedOrigins: ['https://official.test'],
    script: '',
    previousProfile: oldProfile,
    requiresStudentReplacement: true,
    cancel: jest.fn(),
    complete: jest.fn(async () => account),
    commit: jest.fn(async () => account),
  } as unknown as typeof attempt;
  jest.mocked(beginWebLogin).mockResolvedValue(attempt);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  mockClient.clear();
});
async function click(label: string) {
  const button = Array.from(container.querySelectorAll('button')).find(
    (item) => item.textContent === label,
  );
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => button.click());
}
async function prepare() {
  await act(async () => root.render(<OfficialLogin />));
  await click('模拟官方登录完成');
}
it('shows both students, saves only on confirmation, and removes only this account cache', async () => {
  await prepare();
  for (const text of [
    '虚构原学生',
    '虚构新学生',
    '虚构原学校',
    '虚构新学校',
    '高一',
    '高二',
    'old-student',
    'new-student',
  ])
    expect(container.textContent).toContain(text);
  expect(attempt.commit).not.toHaveBeenCalled();
  expect(mockClient.getQueryData(['account', 'account-a', 'r1', 'exams'])).toEqual(['old-exam']);
  await click('确认替换学生并保存');
  expect(attempt.commit).toHaveBeenCalledWith({ replaceStudent: true });
  expect(mockClient.getQueryCache().findAll({ queryKey: ['account', 'account-a'] })).toHaveLength(
    0,
  );
  expect(mockClient.getQueryData(['account', 'account-b', 'r1', 'exams'])).toEqual(['other-exam']);
  expect(mockReload).toHaveBeenCalled();
  expect(mockSwitch).toHaveBeenCalledWith('account-a');
  expect(mockReplace).toHaveBeenCalledWith('/');
});
it('cancels without saving or clearing caches', async () => {
  await prepare();
  await click('取消替换，保留原学生');
  expect(attempt.cancel).toHaveBeenCalled();
  expect(attempt.commit).not.toHaveBeenCalled();
  expect(mockBack).toHaveBeenCalled();
  expect(mockClient.getQueryData(['account', 'account-a', 'r1', 'exams'])).toEqual(['old-exam']);
});
it('keeps caches and displays the error when persistence fails', async () => {
  jest.mocked(attempt.commit).mockRejectedValueOnce(new Error('fictional storage failure'));
  await prepare();
  await click('确认替换学生并保存');
  expect(container.textContent).toContain('登录验证或安全存储失败');
  expect(mockClient.getQueryData(['account', 'account-a', 'r1', 'exams'])).toEqual(['old-exam']);
  expect(mockSwitch).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});
