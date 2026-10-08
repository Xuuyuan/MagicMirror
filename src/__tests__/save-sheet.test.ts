import type { AnswerSheet } from '../domain/models';
import { saveSheetToLibrary } from '../services/save-sheet';
import { downloadSheetImage } from '../services/sheet-images';
import * as MediaLibrary from 'expo-media-library/legacy';

jest.mock('expo-media-library', () => { throw new Error('Root API must not be imported'); });
jest.mock('expo-media-library/legacy', () => ({ requestPermissionsAsync: jest.fn(), saveToLibraryAsync: jest.fn() }));
jest.mock('../services/sheet-images', () => ({ downloadSheetImage: jest.fn() }));
const sheet: AnswerSheet = { subject: '虚构科目', url: 'https://example.invalid/sheet.png', watermarked: true, headers: { Cookie: 'fictional-cookie' } };
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(MediaLibrary.requestPermissionsAsync).mockResolvedValue({ granted: true } as Awaited<ReturnType<typeof MediaLibrary.requestPermissionsAsync>>);
  jest.mocked(downloadSheetImage).mockResolvedValue('file:///fictional-cache/sheet.png');
  jest.mocked(MediaLibrary.saveToLibraryAsync).mockResolvedValue(undefined);
});
it('saves through the legacy API with write-only access and no media read permissions', async () => {
  await saveSheetToLibrary(sheet);
  expect(MediaLibrary.requestPermissionsAsync).toHaveBeenCalledWith(true, []);
  expect(downloadSheetImage).toHaveBeenCalledWith(sheet.url, sheet.headers);
  expect(MediaLibrary.saveToLibraryAsync).toHaveBeenCalledWith('file:///fictional-cache/sheet.png');
});
it('does not download or save when permission is denied', async () => {
  jest.mocked(MediaLibrary.requestPermissionsAsync).mockResolvedValue({ granted: false } as Awaited<ReturnType<typeof MediaLibrary.requestPermissionsAsync>>);
  await expect(saveSheetToLibrary(sheet)).rejects.toThrow('未获得相册写入权限');
  expect(downloadSheetImage).not.toHaveBeenCalled();
  expect(MediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled();
});
it('reports a permission request failure separately', async () => {
  jest.mocked(MediaLibrary.requestPermissionsAsync).mockRejectedValue(new Error('native permission failure'));
  await expect(saveSheetToLibrary(sheet)).rejects.toThrow('无法申请相册写入权限');
});
it('reports download failure without exposing signed URLs or headers', async () => {
  jest.mocked(downloadSheetImage).mockRejectedValue(new Error('https://example.invalid/private?secret=fictional'));
  await expect(saveSheetToLibrary(sheet)).rejects.toThrow('图片下载失败，请检查网络或重新获取答题卡');
  expect(MediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled();
});
it('reports an album write failure without suggesting an unrelated Expo Go update', async () => {
  jest.mocked(MediaLibrary.saveToLibraryAsync).mockRejectedValue(new Error('disk failure'));
  await expect(saveSheetToLibrary(sheet)).rejects.toThrow('写入相册失败');
});
