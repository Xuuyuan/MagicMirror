/** @jest-environment jsdom */
import { act, type ReactNode } from 'react';
import { AdaptiveSheetImage, SheetImage } from '../sheet-image';
import type { AnswerSheet } from '../domain/models';
import { fetchSheetImage, sheetImageErrorMessage } from '../services/sheet-images';

// 捕获传给原生 Image 的属性，验证解码方式；图片地址解析走真实的 SheetImage 逻辑。
type CapturedImageProps = {
  resizeMethod?: string;
  source?: { uri?: string };
  onError: () => void;
  onLoad: (event: { nativeEvent: { source: { width: number; height: number } } }) => void;
};
const mockImageProps: CapturedImageProps[] = [];

jest.mock('../services/sheet-images', () => ({
  fetchSheetImage: jest.fn(async (uri: string) => `file://${uri}`),
  sheetImageErrorMessage: jest.fn(async () => '图片无法加载'),
  sheetImageFailureMessage: '图片无法加载',
}));
jest.mock('react-native-paper', () => ({
  ActivityIndicator: () => <span data-testid="spinner" />,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
jest.mock('react-native', () => ({
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Image: (props: CapturedImageProps) => {
    mockImageProps.push(props);
    return <img data-resize-method={String(props.resizeMethod)} />;
  },
  StyleSheet: { absoluteFill: {} },
}));

const { createRoot } = jest.requireActual<{
  createRoot: (element: Element) => { render: (element: ReactNode) => void; unmount: () => void };
}>('react-dom/client');
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const sheet: AnswerSheet = {
  subject: '语文',
  url: 'https://itembank.example.com/paper-0001.jpg?Expires=1&Signature=x',
  watermarked: false,
};

it('列表图片按显示尺寸解码，查看器保持原分辨率', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    // 列表缩略（答题卡/原卷/水印卡片共用）：交给 Android 按显示尺寸采样，避免整页扫描件（实测 14.8MB/张）吃满堆。
    mockImageProps.length = 0;
    await act(async () => {
      root.render(<AdaptiveSheetImage sheet={sheet} />);
    });
    expect(mockImageProps.at(-1)).toMatchObject({ resizeMethod: 'resize' });
    expect(String(mockImageProps.at(-1)?.source?.uri ?? '')).toContain('paper-0001.jpg');

    // 查看器用整屏大图，保持原分辨率以便放大查看。
    mockImageProps.length = 0;
    await act(async () => {
      root.render(<SheetImage sheet={sheet} style={{ width: 360, height: 520 }} />);
    });
    expect(mockImageProps.at(-1)).toMatchObject({ resizeMethod: 'none' });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('在加载超时后显示归档提示，忽略迟到的图片下载结果', async () => {
  jest.useFakeTimers();
  const container = document.createElement('div');
  const root = createRoot(container);
  let finish!: (uri: string) => void;
  jest.mocked(fetchSheetImage).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  jest
    .mocked(sheetImageErrorMessage)
    .mockResolvedValueOnce('该考试的图片已被平台归档，暂时无法读取');
  try {
    await act(async () =>
      root.render(<SheetImage sheet={sheet} style={{ width: 360, height: 520 }} />),
    );
    expect(container.querySelector('[data-testid="spinner"]')).not.toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(20000);
    });
    expect(container.textContent).toContain('已被平台归档');
    expect(container.querySelector('[data-testid="spinner"]')).toBeNull();
    await act(async () => finish('file:///late.jpg'));
    expect(container.textContent).toContain('已被平台归档');
  } finally {
    await act(async () => root.unmount());
    jest.useRealTimers();
  }
});

it('图片加载成功后取消超时诊断', async () => {
  jest.useFakeTimers();
  jest.mocked(sheetImageErrorMessage).mockClear();
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(<SheetImage sheet={sheet} style={{ width: 360, height: 520 }} />),
    );
    await act(async () =>
      mockImageProps.at(-1)!.onLoad({ nativeEvent: { source: { width: 1000, height: 700 } } }),
    );
    await act(async () => {
      jest.advanceTimersByTime(30000);
    });
    expect(sheetImageErrorMessage).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    jest.useRealTimers();
  }
});

it('切换图片后忽略上一张图片迟到的归档诊断', async () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  const onError = jest.fn();
  let finish!: (message: string) => void;
  jest.mocked(sheetImageErrorMessage).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  try {
    await act(async () =>
      root.render(
        <SheetImage sheet={sheet} style={{ width: 360, height: 520 }} onError={onError} />,
      ),
    );
    // 本地缓存解码失败后，回退原始地址；远程失败才诊断。
    await act(async () => mockImageProps.at(-1)!.onError());
    await act(async () => mockImageProps.at(-1)!.onError());
    await act(async () =>
      root.render(
        <SheetImage
          sheet={{ ...sheet, url: 'https://example.test/new.jpg' }}
          style={{ width: 360, height: 520 }}
          onError={onError}
        />,
      ),
    );
    await act(async () => finish('已被平台归档'));
    expect(onError).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('已被平台归档');
    expect(mockImageProps.at(-1)!.source?.uri).toContain('new.jpg');
  } finally {
    await act(async () => root.unmount());
  }
});
