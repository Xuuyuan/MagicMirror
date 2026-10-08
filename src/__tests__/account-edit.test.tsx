/** @jest-environment jsdom */
import { act, type ReactNode } from 'react';
import AccountEdit from '../../app/account-edit';
import { accountStorage } from '../storage/accounts';
import { authenticateAccount } from '../services/accounts';

type Root = { render: (element: ReactNode) => void; unmount: () => void };
const { createRoot } = jest.requireActual<{ createRoot: (element: Element) => Root }>('react-dom/client');
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let mockId: string | undefined;
const mockSave = jest.fn();
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: mockId }) }));
jest.mock('../accounts-context', () => ({ useAccounts: () => ({ saveAccount: mockSave }) }));
jest.mock('../storage/accounts', () => ({ accountStorage: { load: jest.fn() } }));
jest.mock('../services/accounts', () => ({ authenticateAccount: jest.fn() }));
jest.mock('../providers/registry', () => {
  const providers = ['haofenshu-parent', 'other'].map((id) => ({ metadata: { id, name: id } }));
  return { providerRegistry: { get: (id: string) => providers.find((provider) => provider.metadata.id === id), list: () => providers } };
});
jest.mock('react-native', () => ({ View: ({ children }: { children: ReactNode }) => <div>{children}</div>, useWindowDimensions: () => ({ width: 390 }) }));
jest.mock('../ui', () => ({
  Screen: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Body: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Header: () => null, LoadingState: () => null, backOrHome: jest.fn(),
}));
jest.mock('react-native-paper', () => {
  const TextInput = ({ label, value, onChangeText, secureTextEntry, disabled, right }: { label: string; value: string; onChangeText: (value: string) => void; secureTextEntry?: boolean; disabled?: boolean; right?: ReactNode }) => <label>{label}<input aria-label={label} value={value} onChange={(event) => onChangeText(event.target.value)} type={secureTextEntry ? 'password' : 'text'} disabled={disabled} />{right}</label>;
  TextInput.Icon = function InputIcon({ accessibilityLabel, onPress }: { accessibilityLabel: string; onPress: () => void }) { return <button onClick={onPress}>{accessibilityLabel}</button>; };
  const Menu = ({ anchor, visible, children }: { anchor: ReactNode; visible: boolean; children: ReactNode }) => <div>{anchor}{visible && children}</div>;
  Menu.Item = function MenuItem({ title, onPress }: { title: string; onPress: () => void }) { return <button onClick={onPress}>{title}</button>; };
  return { TextInput, Menu, Text: ({ children }: { children: ReactNode }) => <span>{children}</span>, Button: ({ children, disabled, onPress }: { children: ReactNode; disabled?: boolean; onPress: () => void }) => <button disabled={disabled} onClick={onPress}>{children}</button> };
});

let container: HTMLDivElement;
let root: Root;
const saved = { id: 'fictional', label: '虚构', providerId: 'haofenshu-parent', login: 'fictional-login', password: 'fictional-saved-password' };
beforeEach(() => {
  jest.clearAllMocks();
  mockId = saved.id;
  jest.mocked(accountStorage.load).mockResolvedValue({ ...saved, revision: 'r1' });
  jest.mocked(authenticateAccount).mockResolvedValue({ ...saved, revision: 'r2' });
  mockSave.mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render() { await act(async () => root.render(<AccountEdit />)); }
function button(text: string) {
  const result = Array.from(container.querySelectorAll('button')).find((element) => element.textContent === text);
  if (!result) throw new Error(`Missing button: ${text}`);
  return result;
}
async function click(text: string) { await act(async () => button(text).click()); }
function input(label: string) { return container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`); }
async function fill(label: string, value: string) {
  const element = input(label);
  if (!element) throw new Error(`Missing input: ${label}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('requires a password on add and toggles visibility without changing its value', async () => {
  mockId = undefined;
  await render();
  await fill('登录账号', 'fictional-login');
  expect(button('登录并保存').disabled).toBe(true);
  await fill('密码', 'fictional-new-password');
  expect(button('登录并保存').disabled).toBe(false);
  expect(input('密码')?.type).toBe('password');
  await click('显示密码');
  expect(input('密码')?.type).toBe('text');
  expect(input('密码')?.value).toBe('fictional-new-password');
  await click('隐藏密码');
  expect(input('密码')?.type).toBe('password');
});

it('shows saved status and cancels replacement without submitting the discarded password', async () => {
  await render();
  expect(container.textContent).toContain('密码已保存');
  expect(input('密码')).toBeNull();
  await click('替换密码');
  expect(button('登录并保存').disabled).toBe(true);
  await fill('密码', 'fictional-discarded-password');
  await click('取消替换');
  expect(input('密码')).toBeNull();
  await click('登录并保存');
  expect(authenticateAccount).toHaveBeenCalledWith(expect.objectContaining({ id: saved.id, password: '' }));
});

it('requires a fresh password when login or provider changes and restores saved status when reverted', async () => {
  await render();
  await fill('登录账号', 'fictional-other-login');
  expect(container.textContent).toContain('账号已变更，请重新输入密码');
  expect(button('登录并保存').disabled).toBe(true);
  await fill('密码', 'fictional-other-password');
  await fill('登录账号', saved.login);
  expect(input('密码')).toBeNull();
  await click('haofenshu-parent');
  await click('other');
  expect(input('密码')?.value).toBe('');
  expect(button('登录并保存').disabled).toBe(true);
});

it('submits the newly entered password during replacement', async () => {
  await render();
  await click('替换密码');
  await fill('密码', 'fictional-replacement-password');
  await click('登录并保存');
  expect(authenticateAccount).toHaveBeenCalledWith(expect.objectContaining({ password: 'fictional-replacement-password' }));
});
