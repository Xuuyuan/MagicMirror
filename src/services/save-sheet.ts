import type { AnswerSheet } from '../domain/models';
import { downloadSheetImage } from './sheet-images';
import * as mediaLibrary from 'expo-media-library/legacy';

/** 使用仍受支持的 legacy 入口，避免加载 Expo Go 未注册的 MediaLibraryNext。 */
export async function saveSheetToLibrary(sheet: AnswerSheet): Promise<void> {
  let granted: boolean;
  // 只申请写入：不请求 photo/video 读取权限，避免 Expo Go 对完整相册访问的限制。
  try { granted = (await mediaLibrary.requestPermissionsAsync(true, [])).granted; }
  catch { throw new Error('无法申请相册写入权限，请检查系统权限设置'); }
  if (!granted) throw new Error('未获得相册写入权限，无法保存');
  let localUri: string;
  try { localUri = await downloadSheetImage(sheet.url, sheet.headers); }
  catch { throw new Error('图片下载失败，请检查网络或重新获取答题卡'); }
  try { await mediaLibrary.saveToLibraryAsync(localUri); }
  catch { throw new Error('写入相册失败，请检查设备存储空间和相册权限'); }
}
