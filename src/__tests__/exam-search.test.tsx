/** @jest-environment jsdom */
import { act, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExamSearchForm } from '../../app/exam-search';
import { ProviderError, type ExamBindingPreview, type ExamBindingResult } from '../domain/models';

type Root = { render: (element: ReactNode) => void; unmount: () => void };
const { createRoot } = jest.requireActual<{ createRoot: (element: Element) => Root }>('react-dom/client');
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mockBack = jest.fn();
const mockPreview = jest.fn();
const mockBind = jest.fn();
const mockProjects = jest.fn();
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}) }));
jest.mock('react-native', () => ({ useWindowDimensions: () => ({ width: 400 }) }));
jest.mock('../accounts-context', () => ({ useAccounts: () => ({}) }));
jest.mock('../providers/registry', () => ({ providerRegistry: { get: () => undefined } }));
jest.mock('../services/exam-binding', () => ({
  supportsExamBinding: () => true,
  previewExamBinding: (...args: unknown[]) => mockPreview(...args),
  bindExam: (...args: unknown[]) => mockBind(...args),
  searchableExamsQueryOptions: (id: string, revision: string) => ({ queryKey: ['account', id, revision, 'searchable-exams'], queryFn: () => mockProjects() }),
}));
jest.mock('../services/queries', () => ({ accountQueryKeys: { exams: (id: string, revision: string) => ['account', id, revision, 'exams'] } }));
jest.mock('../ui', () => {
  const Box = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return { Screen: Box, Body: Box, Card: Box, Header: () => <h1>搜索考试项目</h1>, LoadingState: () => <span>加载中</span>, backOrHome: () => mockBack(), showToast: jest.fn() };
});
jest.mock('react-native-paper', () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({ children, onPress, disabled, accessibilityLabel }: { children: ReactNode; onPress?: () => void; disabled?: boolean; accessibilityLabel?: string }) => <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>,
  TextInput: ({ label, value, onChangeText, disabled }: { label: string; value: string; onChangeText: (value: string) => void; disabled?: boolean }) => <input aria-label={label} value={value} disabled={disabled} onChange={event => onChangeText(event.target.value)} />,
  Menu: Object.assign(
    ({ visible, anchor, children }: { visible: boolean; anchor: ReactNode; children: ReactNode }) => <>{anchor}{visible ? <div role="menu">{children}</div> : null}</>,
    { Item: ({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) => <button role="menuitem" disabled={disabled} onClick={onPress}>{title}</button> },
  ),
}));
const candidate = { examId: 'E1', examName: '虚构考试一', studentId: 'S1', studentCode: '001234', displayName: '虚构学生', schoolName: '虚构学校', className: '虚构班级' };
let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
const examsKey = ['account', 'fictional', 'r1', 'exams'];
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function render() {
  await act(async () => root.render(<QueryClientProvider client={client}><ExamSearchForm accountId="fictional" revision="r1" /></QueryClientProvider>));
  await settle();
}
function button(label: string) { return [...container.querySelectorAll('button')].find(item => item.textContent === label)!; }
async function click(label: string) { await act(async () => button(label).click()); await settle(); }
async function input(value: string) {
  await act(async () => {
    const field = container.querySelector<HTMLInputElement>('[aria-label="本人准考证号"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function chooseExam(name: string) {
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="选择考试项目"]')!.click());
  await settle();
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent === name)!.click());
  await settle();
}
async function ready() { await render(); await chooseExam('虚构考试一'); await input('001234'); await click('核对考生'); }

beforeEach(() => {
  jest.clearAllMocks();
  mockProjects.mockResolvedValue([{ id: 'E1', name: '虚构考试一' }, { id: 'E2', name: '虚构考试二' }]);
  mockPreview.mockResolvedValue({ status: 'ready', candidate });
  mockBind.mockResolvedValue({ status: 'bound' });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); });

it('先核对再确认；连续点击只绑定一次，刷新列表后返回', async () => {
  const list = jest.fn().mockResolvedValue({ pages: [[]], pageParams: [0] });
  await client.fetchQuery({ queryKey: examsKey, queryFn: list });
  const pending = deferred<ExamBindingResult>(); mockBind.mockReturnValue(pending.promise);
  await ready();
  expect(container.textContent).toContain('姓名：虚构学生');
  expect(mockBind).not.toHaveBeenCalled();
  await act(async () => { button('确认绑定').click(); button('确认绑定').click(); });
  expect(mockBind).toHaveBeenCalledTimes(1);
  expect(mockBind.mock.calls[0].slice(0, 3)).toEqual(['fictional', 'r1', candidate]);
  await act(async () => pending.resolve({ status: 'bound' })); await settle();
  expect(list).toHaveBeenCalledTimes(2);
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it('空考号禁用核对；修改考号或项目后旧确认失效', async () => {
  await ready();
  await input('');
  expect(button('核对考生').disabled).toBe(true);
  expect(button('确认绑定')).toBeUndefined();
  await input('001234'); await click('核对考生');
  await chooseExam('虚构考试二');
  expect(button('确认绑定')).toBeUndefined();
  expect(mockBind).not.toHaveBeenCalled();
});

it('输入变化会取消预览，晚返回的数据不能恢复旧确认按钮', async () => {
  const pending = deferred<ExamBindingPreview>(); mockPreview.mockReturnValue(pending.promise);
  await render(); await chooseExam('虚构考试一'); await input('001234'); await click('核对考生');
  const signal = mockPreview.mock.calls[0][4] as AbortSignal;
  await input('009999');
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve({ status: 'ready', candidate })); await settle();
  expect(button('确认绑定')).toBeUndefined();
});

it('错误考号展示可改正的提示，不调用绑定', async () => {
  mockPreview.mockRejectedValue(new ProviderError('NOT_FOUND', '准考证号不存在，请检查考试项目和考号'));
  await ready();
  expect(container.textContent).toContain('准考证号不存在');
  expect(button('确认绑定')).toBeUndefined();
  expect(mockBind).not.toHaveBeenCalled();
});

it('已关联只刷新列表，不展示考生核对成功、不调用绑定', async () => {
  mockPreview.mockResolvedValue({ status: 'already-bound' });
  await ready();
  expect(container.textContent).not.toContain('姓名：');
  expect(mockBind).not.toHaveBeenCalled();
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it('写失败后不自动重试，必须重新核对才有确认按钮', async () => {
  mockBind.mockRejectedValue(new ProviderError('NETWORK', '绑定结果尚未确认，请先刷新考试列表核实'));
  await ready(); await click('确认绑定');
  expect(mockBind).toHaveBeenCalledTimes(1);
  expect(button('确认绑定')).toBeUndefined();
  expect(container.textContent).toContain('绑定结果尚未确认');
  expect(mockBack).not.toHaveBeenCalled();
});

it('绑定成功后刷新失败仍保留成功状态，重试仅刷新列表', async () => {
  const list = jest.fn().mockResolvedValueOnce({ pages: [[]], pageParams: [0] }).mockRejectedValueOnce(new Error('fictional network')).mockResolvedValue({ pages: [[{ id: 'E1' }]], pageParams: [0] });
  await client.fetchQuery({ queryKey: examsKey, queryFn: list });
  await ready(); await click('确认绑定');
  expect(container.textContent).toContain('绑定状态已确认，无需再次提交');
  expect(mockBack).not.toHaveBeenCalled();
  await click('重新刷新考试列表');
  expect(mockBind).toHaveBeenCalledTimes(1);
  expect(list).toHaveBeenCalledTimes(3);
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it('卸载取消进行中的核对，不再返回或绑定', async () => {
  const pending = deferred<ExamBindingPreview>(); mockPreview.mockReturnValue(pending.promise);
  await render(); await chooseExam('虚构考试一'); await input('001234'); await click('核对考生');
  const signal = mockPreview.mock.calls[0][4] as AbortSignal;
  await act(async () => root.render(<div />));
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve({ status: 'already-bound' })); await settle();
  expect(mockBack).not.toHaveBeenCalled(); expect(mockBind).not.toHaveBeenCalled();
});
