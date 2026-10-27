import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { embeddedImageData } from '../domain/image-uri';

const cacheDirectory = new Directory(Paths.cache, 'answer-sheets');
const inFlight = new Map<string, Promise<string>>();

export const archivedSheetMessage =
  '该考试的图片已被平台归档，暂时无法读取，请前往智学网官方 App 查看。';
export const sheetImageFailureMessage = '图片无法加载或与作答区域不匹配，请关闭后重新获取。';

/** Only diagnose failed Zhixue storage reads; never forward account headers to OSS. */
export async function sheetImageErrorMessage(uri: string): Promise<string> {
  let host: string;
  try {
    const url = new URL(uri);
    if (url.protocol !== 'https:') return sheetImageFailureMessage;
    host = url.hostname;
  } catch {
    return sheetImageFailureMessage;
  }
  if (!/^zhixue(?:-[a-z0-9]+)?\.oss-[a-z0-9-]+\.aliyuncs\.com$/i.test(host))
    return sheetImageFailureMessage;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(uri, { credentials: 'omit', signal: controller.signal });
        if (response.status !== 403) return sheetImageFailureMessage;
        const body = await response.text();
        return /<Code>\s*InvalidObjectState\s*<\/Code>/.test(body)
          ? archivedSheetMessage
          : sheetImageFailureMessage;
      })(),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => {
          resolve(sheetImageFailureMessage);
          controller.abort();
        }, 8000);
      }),
    ]);
  } catch {
    return sheetImageFailureMessage;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function downloadToCache(
  uri: string,
  headers: Record<string, string> | undefined,
  forceRefresh: boolean,
): Promise<string> {
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
    const downloaded = await File.downloadFileAsync(uri, file, {
      headers: headers ?? {},
      idempotent: true,
    });
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
  const task = start().finally(() => {
    inFlight.delete(uri);
  });
  inFlight.set(uri, task);
  return task;
}

/**
 * 部分平台的答题卡图片要求会话 Cookie 和来源请求头，而 React Native 的 Image 组件在 Android 上不会发送自定义请求头，
 * 因此先按请求头把图片下载到缓存目录，再交给 Image 渲染本地文件。没有请求头时保持远程 URL 不变。
 */
export function fetchSheetImage(
  uri: string,
  headers?: Record<string, string>,
  forceRefresh = false,
): Promise<string> {
  if (embeddedImageData(uri)) return Promise.resolve(uri);
  if (!headers) return Promise.resolve(uri);
  return deduped(uri, () => downloadToCache(uri, headers, forceRefresh));
}

/** 把图片下载到缓存并返回本地文件路径（保存到相册用）；重复调用复用缓存与去重。 */
export function downloadSheetImage(uri: string, headers?: Record<string, string>): Promise<string> {
  return deduped(uri, () => downloadToCache(uri, headers, false));
}
