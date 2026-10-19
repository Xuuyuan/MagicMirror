/** @jest-environment jsdom */
import { act, type ReactNode } from 'react';
import { AcademicYearPicker } from '../academic-year-picker';
import { accountStorage } from '../storage/accounts';

type Root = { render: (element: ReactNode) => void; unmount: () => void };
const { createRoot } = jest.requireActual<{ createRoot: (element: Element) => Root }>(
  'react-dom/client',
);
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mockCancel = jest.fn(async () => undefined);
const mockReload = jest.fn(async () => undefined);
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ cancelQueries: mockCancel }),
}));
jest.mock('../accounts-context', () => ({ useAccounts: () => ({ reload: mockReload }) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'fictional-revision' }));
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
jest.mock('react-native-paper', () => {
  const Menu = ({
    anchor,
    visible,
    children,
  }: {
    anchor: ReactNode;
    visible: boolean;
    children: ReactNode;
  }) => (
    <div>
      {anchor}
      {visible && children}
    </div>
  );
  Menu.Item = function Item({
    title,
    disabled,
    onPress,
  }: {
    title: string;
    disabled: boolean;
    onPress: () => void;
  }) {
    return (
      <button disabled={disabled} onClick={onPress}>
        {title}
      </button>
    );
  };
  return {
    Menu,
    Button: ({
      children,
      disabled,
      onPress,
    }: {
      children: ReactNode;
      disabled: boolean;
      onPress: () => void;
    }) => (
      <button disabled={disabled} onClick={onPress}>
        {children}
      </button>
    ),
    Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  };
});
const account = {
  id: 'fictional-account',
  revision: 'r1',
  label: '虚构',
  login: 'fictional',
  providerId: 'fictional',
};
const years = [
  { id: '2025-2026', label: '虚构历史学年' },
  { id: '2026-2027', label: '虚构当前学年' },
];
let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  jest.clearAllMocks();
  await accountStorage.save(account);
  await accountStorage.save({ ...account, id: 'other-account', academicYear: 'other-year' });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function click(text: string) {
  const button = Array.from(container.querySelectorAll('button')).find(
    (value) => value.textContent === text,
  )!;
  await act(async () => button.click());
}
it('switches and persists the chosen year, cancels old list requests and leaves another account unchanged', async () => {
  await act(async () =>
    root.render(
      <AcademicYearPicker
        accountId={account.id}
        revision="r1"
        years={years}
        selected="2026-2027"
      />,
    ),
  );
  await click('虚构当前学年');
  await click('虚构历史学年');
  expect((await accountStorage.load(account.id))?.academicYear).toBe('2025-2026');
  expect((await accountStorage.load('other-account'))?.academicYear).toBe('other-year');
  expect(mockCancel).toHaveBeenCalledWith({ queryKey: ['account', account.id, 'r1', 'exams'] });
  expect(mockReload).toHaveBeenCalledTimes(1);
  await act(async () =>
    root.render(
      <AcademicYearPicker
        accountId={account.id}
        revision="r1"
        years={years}
        selected={(await accountStorage.load(account.id))?.academicYear}
      />,
    ),
  );
  expect(container.textContent).toBe('虚构历史学年');
});
it('does not overwrite an edited account from a stale year picker', async () => {
  await accountStorage.save({ ...account, revision: 'edited' });
  await act(async () =>
    root.render(<AcademicYearPicker accountId={account.id} revision="r1" years={years} />),
  );
  await click('选择学年');
  await click('虚构历史学年');
  expect(container.textContent).toContain('账号已变更');
  expect((await accountStorage.load(account.id))?.academicYear).toBeUndefined();
});
