import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { embeddedImageData } from '../domain/image-uri';

const cacheDirectory = new Directory(Paths.cache, 'answer-sheets');
const inFlight = new Map<string, Promise<string>>();

async function downloadToCache(uri: string, headers: Record<string, string> | undefined, forceRefresh: boolean): Promise<string> {
  const name = await digestStringAsync(CryptoDigestAlgorithm.SHA256, uri);
  const embedded = embeddedImageData(uri);
  const file = new File(cacheDirectory, `${name}.${embedded?.extension ?? 'png'}`);
  if (file.exists && !forceRefresh) return file.uri;
  if (file.exists && forceRefresh) file.delete();
  cacheDirectory.create({ intermediates: true, idempotent: true });
  try {
    if (embedded) {
      file.write(embedded.base64, { encoding: 'base64' });
      return file.uri;
    }
    const downloaded = await File.downloadFileAsync(uri, file, { headers: headers ?? {}, idempotent: true });
    return downloaded.uri;
  } catch (error) {
    if (file.exists) file.delete();
    throw error;
  }
}

/** 相同地址的并发下载只发一次请求，其余调用共享同一个任务。 */
function deduped(uri: string, start: () => Promise<string>): Promise<string> {
  const pending = inFlight.get(uri);
  if (pending) return pending;
  const task = start().finally(() => { inFlight.delete(uri); });
  inFlight.set(uri, task);
  return task;
}

/**
 * 部分平台的答题卡图片要求会话 Cookie 和来源请求头，而 React Native 的 Image 组件在 Android 上不会发送自定义请求头，
 * 因此先按请求头把图片下载到缓存目录，再交给 Image 渲染本地文件。没有请求头时保持远程 URL 不变。
 */
export function fetchSheetImage(uri: string, headers?: Record<string, string>, forceRefresh = false): Promise<string> {
  if (embeddedImageData(uri)) return Promise.resolve(uri);
  if (!headers) return Promise.resolve(uri);
  return deduped(uri, () => downloadToCache(uri, headers, forceRefresh));
}

/** 把图片下载到缓存并返回本地文件路径（保存到相册用）；重复调用复用缓存与去重。 */
export function downloadSheetImage(uri: string, headers?: Record<string, string>): Promise<string> {
  return deduped(uri, () => downloadToCache(uri, headers, false));
}
