/** @jest-environment jsdom */
import { act, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AnswerSheets from '../../app/answer-sheets';
import ExamPapers from '../../app/exam-papers';
import type { AnswerSheet, AuthSession } from '../domain/models';
import type { ScoreProvider } from '../providers/types';
import { accountQueryKeys } from '../services/queries';

type Root = { render: (element: ReactNode) => void; unmount: () => void };
const { createRoot } = jest.requireActual<{ createRoot: (element: Element) => Root }>(
  'react-dom/client',
);
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mockParams: { accountId: string; examId: string; subjectId?: string } = {
  accountId: 'fictional-account',
  examId: 'fictional-exam',
  subjectId: 'fictional-subject',
};
const mockGetAnswerSheets = jest.fn<Promise<AnswerSheet[]>, unknown[]>();
const mockGetPaperImages = jest.fn<Promise<AnswerSheet[]>, unknown[]>();
const mockImageErrorCallbacks = new Map<string, () => void>();
const mockProvider = {
  getExamResult: async () => ({ examId: mockParams.examId, examName: '虚构考试', subjects: [] }),
  getAnswerSheets: mockGetAnswerSheets,
  getPaperImages: mockGetPaperImages,
};
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams }));
jest.mock('../accounts-context', () => ({
  useAccounts: () => ({ accounts: [{ id: 'fictional-account', revision: 'r1' }] }),
}));
jest.mock('../services/accounts', () => ({
  withAccount: (
    _id: string,
    operation: (provider: ScoreProvider, session: AuthSession, signal?: AbortSignal) => unknown,
    signal?: AbortSignal,
  ) =>
    operation(
      mockProvider as unknown as ScoreProvider,
      { accessToken: 'fictional' } as AuthSession,
      signal,
    ),
}));
jest.mock('react-native', () => ({
  Pressable: ({
    children,
    onPress,
    onLongPress,
    accessibilityRole,
    accessibilityLabel,
  }: {
    children: ReactNode;
    onPress: () => void;
    onLongPress: () => void;
    accessibilityRole?: string;
    accessibilityLabel?: string;
  }) => (
    <div
      data-pressable
      role={accessibilityRole}
      aria-label={accessibilityLabel}
      onClick={onPress}
      onContextMenu={onLongPress}
    >
      {children}
    </div>
  ),
}));
jest.mock('react-native-paper', () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({
    children,
    onPress,
    loading,
  }: {
    children: ReactNode;
    onPress: () => void;
    loading?: boolean;
  }) => (
    <button onClick={onPress} aria-busy={loading}>
      {children}
    </button>
  ),
}));
jest.mock('../ui', () => ({
  Screen: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  Header: ({ title }: { title: string }) => <h1>{title}</h1>,
  Body: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  Card: ({ children }: { children: ReactNode }) => <article>{children}</article>,
  LoadingState: ({ label }: { label: string }) => <p>{label}</p>,
  ErrorCard: ({
    error,
    retry,
    accountId,
  }: {
    error: Error;
    retry: () => void;
    accountId: string;
  }) => (
    <button data-account={accountId} onClick={retry}>
      {error.message}
    </button>
  ),
  // Native gesture recognition is unchanged; exercise the callback wired to it.
  useDoubleTap: (callback: (sheet: AnswerSheet) => void) => callback,
}));
jest.mock('../sheet-image', () => ({
  AdaptiveSheetImage: ({
    sheet,
    reloadKey,
    onError,
  }: {
    sheet: AnswerSheet;
    reloadKey: number;
    onError: () => void;
  }) => {
    mockImageErrorCallbacks.set(sheet.url, onError);
    return (
      <img
        alt={sheet.subject}
        src={sheet.url}
        data-headers={JSON.stringify(sheet.headers)}
        data-reload-key={reloadKey}
        onError={onError}
      />
    );
  },
  SheetViewerModal: ({
    sheet,
    onDismiss,
    onLongPress,
  }: {
    sheet?: AnswerSheet;
    onDismiss: () => void;
    onLongPress: (sheet: AnswerSheet) => void;
  }) =>
    sheet ? (
      <aside data-viewer={sheet.url}>
        <button onClick={onDismiss}>关闭预览</button>
        <button onClick={() => onLongPress(sheet)}>预览长按</button>
      </aside>
    ) : null,
}));
jest.mock('../sheet-actions', () => ({
  SheetActionsSheet: ({ sheet, onDismiss }: { sheet?: AnswerSheet; onDismiss: () => void }) =>
    sheet ? (
      <aside data-actions={sheet.url}>
        <button onClick={onDismiss}>关闭菜单</button>
      </aside>
    ) : null,
}));

const sheets: AnswerSheet[] = [1, 2].map((page) => ({
  subject: '虚构科目',
  url: `https://example.invalid/answer-${page}.png`,
  watermarked: false,
  headers: { Referer: 'https://example.invalid' },
}));
const papers = sheets.map((sheet) => ({ ...sheet, url: sheet.url.replace('answer', 'paper') }));
const routes = [
  {
    Page: AnswerSheets,
    title: '答题卡',
    empty: '平台未提供本场考试的答题卡。',
    refresh: '重新获取答题卡',
    fetch: mockGetAnswerSheets,
    other: mockGetPaperImages,
    data: sheets,
    key: accountQueryKeys.sheets,
  },
  {
    Page: ExamPapers,
    title: '试卷原卷',
    empty: '平台未提供本科目原卷。',
    refresh: '重新获取原卷',
    fetch: mockGetPaperImages,
    other: mockGetAnswerSheets,
    data: papers,
    key: accountQueryKeys.papers,
  },
];
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: QueryClient;
beforeEach(() => {
  mockImageErrorCallbacks.clear();
  mockParams.subjectId = 'fictional-subject';
  mockGetAnswerSheets.mockReset().mockResolvedValue(sheets);
  mockGetPaperImages.mockReset().mockResolvedValue(papers);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
});
async function render(Page: () => ReactNode) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Page />
      </QueryClientProvider>,
    ),
  );
}
async function waitFor(check: () => void) {
  for (let attempt = 0; attempt < 30; attempt++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    try {
      check();
      return;
    } catch (error) {
      if (attempt === 29) throw error;
    }
  }
}
async function click(text: string) {
  const button = Array.from(container.querySelectorAll('button')).find(
    (item) => item.textContent === text,
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
async function failImage(index: number) {
  await act(async () => container.querySelectorAll('img')[index].dispatchEvent(new Event('error')));
}

describe.each(routes)('$title', (route) => {
  it('科目缺失时显示原提示且不发起图片请求', async () => {
    mockParams.subjectId = undefined;
    await render(route.Page);
    expect(container.textContent).toContain(`请从单科详情进入${route.title}。`);
    expect(route.fetch).not.toHaveBeenCalled();
  });
  it('保留加载状态和空数据文案', async () => {
    let resolve!: (value: AnswerSheet[]) => void;
    route.fetch.mockReturnValueOnce(
      new Promise<AnswerSheet[]>((done) => {
        resolve = done;
      }),
    );
    await render(route.Page);
    expect(container.textContent).toContain(`正在加载${route.title}…`);
    await act(async () => resolve([]));
    await waitFor(() => expect(container.textContent).toContain(route.empty));
  });
  it('查询失败可按账号重试，保留单页标题', async () => {
    route.fetch
      .mockRejectedValueOnce(new Error('虚构请求失败'))
      .mockResolvedValueOnce([route.data[0]]);
    await render(route.Page);
    await waitFor(() => expect(container.textContent).toContain('虚构请求失败'));
    expect(container.querySelector('[data-account]')?.getAttribute('data-account')).toBe(
      mockParams.accountId,
    );
    await click('虚构请求失败');
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(1));
    expect(container.querySelector('article')?.textContent).toBe('虚构科目');
    expect(route.fetch).toHaveBeenCalledTimes(2);
  });
  it('使用独立查询键并传递图片请求头及原有无障碍标签', async () => {
    await render(route.Page);
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(2));
    expect(container.querySelector('h1')?.textContent).toBe(route.title);
    expect(container.textContent).toContain('虚构科目（第 2 页）');
    expect(route.other).not.toHaveBeenCalled();
    expect(
      client.getQueryData(
        route.key(mockParams.accountId, 'r1', mockParams.examId, mockParams.subjectId!),
      ),
    ).toEqual(route.data);
    expect(container.querySelector('img')?.getAttribute('data-headers')).toBe(
      JSON.stringify(route.data[0].headers),
    );
    expect(container.querySelector('[data-pressable]')?.getAttribute('aria-label')).toBe(
      route.Page === ExamPapers ? '查看第 1 页原卷' : null,
    );
  });
  it('连接预览、长按菜单及关闭回调，预览正常图片不会清除其他图片错误', async () => {
    await render(route.Page);
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(2));
    await failImage(0);
    expect(container.querySelectorAll('button')).toHaveLength(1);
    const pressable = container.querySelectorAll('[data-pressable]')[1];
    await act(async () => pressable.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector('[data-viewer]')?.getAttribute('data-viewer')).toBe(
      route.data[1].url,
    );
    expect(container.textContent).toContain('图片链接可能已过期');
    await click('预览长按');
    expect(container.querySelector('[data-actions]')?.getAttribute('data-actions')).toBe(
      route.data[1].url,
    );
    await click('关闭菜单');
    await click('关闭预览');
    expect(container.querySelector('[data-viewer]')).toBeNull();
    await act(async () =>
      pressable.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })),
    );
    expect(container.querySelector('[data-actions]')?.getAttribute('data-actions')).toBe(
      route.data[1].url,
    );
  });
  it('重新获取时清除提示、更新下载刷新标识并使用新链接', async () => {
    await render(route.Page);
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(2));
    await failImage(0);
    const next = route.data.map((sheet) => ({ ...sheet, url: `${sheet.url}?renewed=1` }));
    route.fetch.mockResolvedValueOnce(next);
    await click(route.refresh);
    await waitFor(() =>
      expect(container.querySelector('img')?.getAttribute('src')).toBe(next[0].url),
    );
    expect(container.textContent).not.toContain('图片链接可能已过期');
    expect(container.querySelector('img')?.getAttribute('data-reload-key')).toBe('1');
    expect(route.fetch).toHaveBeenCalledTimes(2);
  });
  it.each([0, 1])('仅第 %s 张失败时显示错误，列表重排后仍跟随对应图片', async (index) => {
    await render(route.Page);
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(2));
    await failImage(index);
    await failImage(index);
    const cards = container.querySelectorAll('article');
    expect(cards[index].textContent).toContain('图片链接可能已过期');
    expect(cards[1 - index].textContent).not.toContain('图片链接可能已过期');
    expect(container.querySelectorAll('button')).toHaveLength(1);
    await act(async () => {
      client.setQueryData(
        route.key(mockParams.accountId, 'r1', mockParams.examId, mockParams.subjectId!),
        [...route.data].reverse(),
      );
    });
    await waitFor(() => {
      const reordered = container.querySelectorAll('article');
      expect(reordered[1 - index].textContent).toContain('图片链接可能已过期');
      expect(reordered[index].textContent).not.toContain('图片链接可能已过期');
    });
  });
  it('多张图片失败可分别提示，预览其中一张仅清除该张提示', async () => {
    await render(route.Page);
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(2));
    await failImage(0);
    await failImage(1);
    expect(container.querySelectorAll('button')).toHaveLength(2);
    await act(async () => {
      container
        .querySelector('[data-pressable]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelectorAll('article')[0].textContent).not.toContain(
      '图片链接可能已过期',
    );
    expect(container.querySelectorAll('article')[1].textContent).toContain('图片链接可能已过期');
  });
  it('重新获取同一链接也会刷新全部图片，忽略上一轮迟到的失败回调', async () => {
    await render(route.Page);
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(2));
    const previousFailure = mockImageErrorCallbacks.get(route.data[0].url)!;
    await failImage(0);
    await failImage(1);
    await click(route.refresh);
    await waitFor(() => expect(route.fetch).toHaveBeenCalledTimes(2));
    expect(container.textContent).not.toContain('图片链接可能已过期');
    for (const image of container.querySelectorAll('img')) {
      expect(image.getAttribute('data-reload-key')).toBe('1');
    }
    await act(async () => previousFailure());
    expect(container.textContent).not.toContain('图片链接可能已过期');
    await failImage(0);
    expect(container.querySelectorAll('article')[0].textContent).toContain('图片链接可能已过期');
    expect(container.querySelectorAll('article')[1].textContent).not.toContain(
      '图片链接可能已过期',
    );
  });
});

it('在两个路由之间切换时，原卷与答题卡缓存互不覆盖', async () => {
  await render(AnswerSheets);
  await waitFor(() =>
    expect(container.querySelector('img')?.getAttribute('src')).toBe(sheets[0].url),
  );
  await render(ExamPapers);
  await waitFor(() =>
    expect(container.querySelector('img')?.getAttribute('src')).toBe(papers[0].url),
  );
  await render(AnswerSheets);
  expect(container.querySelector('img')?.getAttribute('src')).toBe(sheets[0].url);
  expect(mockGetAnswerSheets).toHaveBeenCalledTimes(1);
  expect(mockGetPaperImages).toHaveBeenCalledTimes(1);
});
