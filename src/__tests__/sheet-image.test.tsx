/** @jest-environment jsdom */
import { act, type ReactNode } from 'react';
import { AdaptiveSheetImage, SheetImage } from '../sheet-image';
import type { AnswerSheet } from '../domain/models';

// 捕获传给原生 Image 的属性，验证解码方式；图片地址解析走真实的 SheetImage 逻辑。
type CapturedImageProps = { resizeMethod?: string; source?: { uri?: string } };
const mockImageProps: CapturedImageProps[] = [];

jest.mock('../services/sheet-images', () => ({ fetchSheetImage: jest.fn(async (uri: string) => `file://${uri}`) }));
jest.mock('react-native-paper', () => ({ ActivityIndicator: () => <span data-testid="spinner" /> }));
jest.mock('react-native', () => ({
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Image: (props: CapturedImageProps) => { mockImageProps.push(props); return <img data-resize-method={String(props.resizeMethod)} />; },
  StyleSheet: { absoluteFill: {} },
}));

const { createRoot } = jest.requireActual<{ createRoot: (element: Element) => { render: (element: ReactNode) => void; unmount: () => void } }>('react-dom/client');
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const sheet: AnswerSheet = { subject: '语文', url: 'https://itembank.example.com/paper-0001.jpg?Expires=1&Signature=x', watermarked: false };

it('列表图片按显示尺寸解码，查看器保持原分辨率', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    // 列表缩略（答题卡/原卷/水印卡片共用）：交给 Android 按显示尺寸采样，避免整页扫描件（实测 14.8MB/张）吃满堆。
    mockImageProps.length = 0;
    await act(async () => { root.render(<AdaptiveSheetImage sheet={sheet} />); });
    expect(mockImageProps.at(-1)).toMatchObject({ resizeMethod: 'resize' });
    expect(String(mockImageProps.at(-1)?.source?.uri ?? '')).toContain('paper-0001.jpg');

    // 查看器用整屏大图，保持原分辨率以便放大查看。
    mockImageProps.length = 0;
    await act(async () => { root.render(<SheetImage sheet={sheet} style={{ width: 360, height: 520 }} />); });
    expect(mockImageProps.at(-1)).toMatchObject({ resizeMethod: 'none' });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
