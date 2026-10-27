import {
  downloadSheetImage,
  fetchSheetImage,
  sheetImageErrorMessage,
  archivedSheetMessage,
  sheetImageFailureMessage,
} from '@/src/services/sheet-images';

jest.mock('expo-file-system', () => {
  const files = new Map<string, string>();
  const downloads: string[] = [];
  const failures = new Set<string>();
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
    }
    create() {
      /* 测试替身不需要真实目录。 */
    }
    get exists() {
      return true;
    }
  }
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
    }
    get exists() {
      return files.has(this.uri);
    }
    delete() {
      files.delete(this.uri);
    }
    write(content: string, options?: { encoding?: string }) {
      files.set(this.uri, `${options?.encoding}:${content}`);
    }
    static async downloadFileAsync(url: string, destination: { uri: string }) {
      downloads.push(url);
      if (failures.has(url)) {
        files.set(destination.uri, 'partial');
        throw new Error('下载失败');
      }
      files.set(destination.uri, 'image');
      return destination;
    }
  }
  return {
    Directory,
    File,
    Paths: { cache: { uri: 'file:///cache' } },
    files,
    downloads,
    failures,
  };
});

describe('智学网图片错误识别', () => {
  const url = 'https://zhixue-sc.oss-cn-hangzhou.aliyuncs.com/fictional.jpg?Signature=fictional';
  let originalFetch: typeof fetch;
  let transport: jest.Mock;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    transport = jest.fn();
    globalThis.fetch = transport;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.useRealTimers();
  });
  it('识别403响应中的InvalidObjectState，不附带账号请求头', async () => {
    transport.mockResolvedValue({
      status: 403,
      text: async () => '<Error><Code>InvalidObjectState</Code></Error>',
    });
    await expect(sheetImageErrorMessage(url)).resolves.toBe(archivedSheetMessage);
    expect(transport).toHaveBeenCalledWith(url, {
      credentials: 'omit',
      signal: expect.any(AbortSignal),
    });
  });
  it.each([
    [403, '<Error><Code>AccessDenied</Code></Error>'],
    [404, '<Error><Code>NoSuchKey</Code></Error>'],
    [200, 'InvalidObjectState'],
  ])('不把其他错误误报为归档（%s）', async (status, body) => {
    transport.mockResolvedValue({ status, text: async () => body });
    await expect(sheetImageErrorMessage(url)).resolves.toBe(sheetImageFailureMessage);
  });
  it('其他平台不发起额外诊断请求', async () => {
    await expect(sheetImageErrorMessage('https://example.test/fictional.jpg')).resolves.toBe(
      sheetImageFailureMessage,
    );
    expect(transport).not.toHaveBeenCalled();
  });
  it('网络或响应体读取停滞时8秒结束诊断', async () => {
    jest.useFakeTimers();
    transport.mockResolvedValue({ status: 403, text: () => new Promise(() => {}) });
    const pending = sheetImageErrorMessage(url);
    await jest.advanceTimersByTimeAsync(8000);
    await expect(pending).resolves.toBe(sheetImageFailureMessage);
    expect(transport.mock.calls[0][1].signal.aborted).toBe(true);
  });
});

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) =>
    jest
      .requireActual<{
        createHash: (algorithm: string) => {
          update: (input: string) => { digest: (format: string) => string };
        };
      }>('node:crypto')
      .createHash('sha256')
      .update(value)
      .digest('hex'),
}));

const fileSystem = jest.requireMock('expo-file-system') as {
  files: Map<string, string>;
  downloads: string[];
  failures: Set<string>;
};

describe('答题卡图片缓存', () => {
  beforeEach(() => {
    fileSystem.files.clear();
    fileSystem.downloads.length = 0;
    fileSystem.failures.clear();
  });

  it('在不需要额外请求头时保留远程地址', async () => {
    await expect(fetchSheetImage('https://example.test/paper.png')).resolves.toBe(
      'https://example.test/paper.png',
    );
    expect(fileSystem.downloads).toEqual([]);
  });

  it('复用同一图片的缓存，不同图片使用独立缓存文件', async () => {
    const url = 'https://example.test/secure/paper.png';
    const headers = {
      Cookie: 'ASP.NET_SessionId=fictional',
      Referer: 'https://example.test/report/singleGroup/REPORT123',
    };
    const first = await fetchSheetImage(url, headers);
    expect(fileSystem.files.has(first)).toBe(true);
    await expect(fetchSheetImage(url, headers)).resolves.toBe(first);
    expect(fileSystem.downloads).toEqual([url]);
    const otherUrl = 'https://example.test/secure/other-paper.png';
    const other = await fetchSheetImage(otherUrl, headers);
    expect(other).not.toBe(first);
    expect(fileSystem.files.has(other)).toBe(true);
    await expect(fetchSheetImage(otherUrl, headers)).resolves.toBe(other);
    await expect(fetchSheetImage(url, headers)).resolves.toBe(first);
    expect(fileSystem.downloads).toEqual([url, otherUrl]);
  });

  it('强制刷新时不会复用旧缓存', async () => {
    const url = 'https://example.test/secure/refresh.png';
    const headers = { Cookie: 'ASP.NET_SessionId=fictional' };
    const first = await fetchSheetImage(url, headers);
    await expect(fetchSheetImage(url, headers, true)).resolves.toBe(first);
    expect(fileSystem.downloads).toEqual([url, url]);
  });

  it('下载失败时清理未完成文件', async () => {
    const url = 'https://example.test/expired/paper.png';
    fileSystem.failures.add(url);
    await expect(fetchSheetImage(url, { Cookie: 'ASP.NET_SessionId=fictional' })).rejects.toThrow(
      '下载失败',
    );
    expect([...fileSystem.files.keys()]).toEqual([]);
  });

  it('previews and saves embedded images without issuing a network download', async () => {
    const uri = 'data:image/jpg;base64,/9j/2Q==';
    await expect(fetchSheetImage(uri, { Referer: 'https://example.test' })).resolves.toBe(uri);
    const saved = await downloadSheetImage(uri);
    expect(saved).toMatch(/\.jpg$/);
    expect(fileSystem.files.get(saved)).toBe('base64:/9j/2Q==');
    expect(fileSystem.downloads).toEqual([]);
  });
});
