/** @jest-environment jsdom */
import { act, type ReactNode } from 'react';
import { SheetViewerModal } from '../sheet-image';
import type { AnswerSheet } from '../domain/models';
import { sheetImageErrorMessage } from '../services/sheet-images';

type ImageProps = {
  source: { uri: string };
  style: Record<string, unknown>;
  onLoad: (event: { nativeEvent: { source: { width: number; height: number } } }) => void;
  onError: () => void;
};
type ViewProps = {
  children?: ReactNode;
  style?: Record<string, unknown> | Record<string, unknown>[];
  onLayout?: (event: { nativeEvent: { layout: { width: number; height: number } } }) => void;
};
type PanConfig = {
  onPanResponderGrant: (event: unknown) => void;
  onPanResponderRelease: (event: unknown) => void;
  onPanResponderMove: (event: unknown, state: unknown) => void;
};
const mockImages: ImageProps[] = [];
const mockViews: ViewProps[] = [];
const mockPans: PanConfig[] = [];
jest.mock('../services/sheet-images', () => ({
  fetchSheetImage: jest.fn(async (uri: string) => uri),
  sheetImageErrorMessage: jest.fn(async () => '该考试的图片已被平台归档，暂时无法读取'),
  sheetImageFailureMessage: '图片无法加载或与作答区域不匹配，请关闭后重新获取。',
}));
jest.mock('react-native', () => ({
  Modal: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? <div>{children}</div> : null,
  View: (props: ViewProps) => {
    mockViews.push(props);
    return <div data-style={JSON.stringify(props.style)}>{props.children}</div>;
  },
  Image: (props: ImageProps) => {
    mockImages.push(props);
    return <span data-source={props.source.uri} />;
  },
  StatusBar: () => null,
  useWindowDimensions: () => ({ width: 400, height: 800 }),
  PanResponder: {
    create: (config: PanConfig) => {
      mockPans.push(config);
      return { panHandlers: {} };
    },
  },
}));
jest.mock('react-native-paper', () => ({
  ActivityIndicator: () => <span>loading</span>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
    accessibilityLabel?: string;
  }) => (
    <button onClick={onPress} disabled={disabled} aria-label={accessibilityLabel}>
      {children}
    </button>
  ),
}));
const { createRoot } = jest.requireActual<{
  createRoot: (element: Element) => { render: (element: ReactNode) => void; unmount: () => void };
}>('react-dom/client');
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const sheets: AnswerSheet[] = [0, 0.1, 0.2].map((offset) => ({
  subject: '虚构作文',
  url: 'https://fictional.example/page.jpg?signature=fictional',
  watermarked: false,
  region: { x: offset, y: offset, width: 0.8, height: 0.8, sourceAspectRatio: 10 / 7 },
}));
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  mockImages.length = 0;
  mockViews.length = 0;
  mockPans.length = 0;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  jest.useRealTimers();
});
const button = (label: string) =>
  container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
async function loadRegion() {
  await act(async () =>
    mockImages.at(-1)!.onLoad({ nativeEvent: { source: { width: 1000, height: 700 } } }),
  );
  const clip = [...mockViews]
    .reverse()
    .find(
      (view) =>
        Array.isArray(view.style) && view.style.some((style) => style.overflow === 'hidden'),
    )!;
  await act(async () => clip.onLayout!({ nativeEvent: { layout: { width: 800, height: 560 } } }));
}

it('shows all three regions in order, keeps the signed original unchanged and resets zoom between regions', async () => {
  await act(async () => root.render(<SheetViewerModal sheets={sheets} onDismiss={jest.fn()} />));
  expect(container.textContent).toContain('区域 1 / 3');
  expect(button('上一作答区域').disabled).toBe(true);
  await loadRegion();
  expect(mockImages.at(-1)!.style).toMatchObject({ width: 1000, height: 700, left: 0, top: 0 });
  const touch = { nativeEvent: { pageX: 200, pageY: 400, touches: [{ pageX: 200, pageY: 400 }] } };
  await act(async () => {
    mockPans.at(-1)!.onPanResponderGrant(touch);
    mockPans.at(-1)!.onPanResponderRelease(touch);
    mockPans.at(-1)!.onPanResponderGrant(touch);
  });
  const transform = () =>
    [...mockViews].reverse().find((view) => !Array.isArray(view.style) && view.style?.transform)
      ?.style as { transform: { scale?: number }[] };
  expect(transform().transform[2].scale).toBe(1);
  await act(async () => button('下一作答区域').click());
  expect(container.textContent).toContain('区域 2 / 3');
  await loadRegion();
  expect(transform().transform[2].scale).toBe(0.5);
  expect(mockImages.at(-1)!.style).toMatchObject({ left: -100, top: -70 });
  await act(async () => button('下一作答区域').click());
  await loadRegion();
  expect(container.textContent).toContain('区域 3 / 3');
  expect(button('下一作答区域').disabled).toBe(true);
  expect(mockImages.at(-1)!.style).toMatchObject({ left: -200, top: -140 });
  expect(mockImages.every((image) => image.source.uri === sheets[0].url)).toBe(true);
  await act(async () => button('上一作答区域').click());
  expect(container.textContent).toContain('区域 2 / 3');
});

it('resets to the first region when another question is selected', async () => {
  await act(async () => root.render(<SheetViewerModal sheets={sheets} onDismiss={jest.fn()} />));
  await act(async () => button('下一作答区域').click());
  const next = [{ ...sheets[0], url: 'https://fictional.example/different.jpg' }, { ...sheets[1] }];
  await act(async () => root.render(<SheetViewerModal sheets={next} onDismiss={jest.fn()} />));
  expect(container.textContent).toContain('区域 1 / 2');
});

it('does not offer saving a clipped preview as if it were the whole source; full-image long press is preserved', async () => {
  jest.useFakeTimers();
  const onLongPress = jest.fn();
  await act(async () =>
    root.render(
      <SheetViewerModal sheets={sheets} onDismiss={jest.fn()} onLongPress={onLongPress} />,
    ),
  );
  const touch = { nativeEvent: { pageX: 200, pageY: 400, touches: [{ pageX: 200, pageY: 400 }] } };
  await act(async () => {
    mockPans.at(-1)!.onPanResponderGrant(touch);
    jest.advanceTimersByTime(501);
  });
  expect(onLongPress).not.toHaveBeenCalled();
  const whole: AnswerSheet = { subject: '虚构整页', url: sheets[0].url, watermarked: false };
  await act(async () =>
    root.render(<SheetViewerModal sheet={whole} onDismiss={jest.fn()} onLongPress={onLongPress} />),
  );
  expect(container.textContent).not.toContain('下一区域');
  await act(async () => {
    mockPans.at(-1)!.onPanResponderGrant(touch);
    jest.advanceTimersByTime(501);
  });
  expect(onLongPress).toHaveBeenCalledWith(whole);
});

it('reports mismatched source dimensions instead of displaying an incorrect crop', async () => {
  const dismiss = jest.fn();
  await act(async () => root.render(<SheetViewerModal sheets={sheets} onDismiss={dismiss} />));
  await act(async () =>
    mockImages.at(-1)!.onLoad({ nativeEvent: { source: { width: 700, height: 1000 } } }),
  );
  expect(container.textContent).toContain('图片无法加载或与作答区域不匹配');
  await act(async () =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((b) => b.textContent === '关闭预览')!
      .click(),
  );
  expect(dismiss).toHaveBeenCalledTimes(1);
});

it.each([true, false])('归档图片显示错误并可关闭预览，停止转圈（分区：%s）', async (region) => {
  const dismiss = jest.fn();
  const sheet = { ...sheets[0], region: region ? sheets[0].region : undefined };
  await act(async () => root.render(<SheetViewerModal sheet={sheet} onDismiss={dismiss} />));
  await act(async () => mockImages.at(-1)!.onError());
  expect(sheetImageErrorMessage).toHaveBeenCalledWith(sheet.url);
  expect(container.textContent).toContain('已被平台归档');
  expect(container.textContent).not.toContain('loading');
  await act(async () =>
    Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent === '关闭预览')!
      .click(),
  );
  expect(dismiss).toHaveBeenCalledTimes(1);
});
