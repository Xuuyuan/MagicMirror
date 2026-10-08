import { downloadSheetImage, fetchSheetImage } from '@/src/services/sheet-images';

jest.mock('expo-file-system', () => {
  const files = new Map<string, string>();
  const downloads: string[] = [];
  const failures = new Set<string>();
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) { this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/'); }
    create() { /* 测试替身不需要真实目录。 */ }
    get exists() { return true; }
  }
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) { this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/'); }
    get exists() { return files.has(this.uri); }
    delete() { files.delete(this.uri); }
    write(content: string, options?: { encoding?: string }) { files.set(this.uri, `${options?.encoding}:${content}`); }
    static async downloadFileAsync(url: string, destination: { uri: string }) {
      downloads.push(url);
      if (failures.has(url)) { files.set(destination.uri, 'partial'); throw new Error('下载失败'); }
      files.set(destination.uri, 'image');
      return destination;
    }
  }
  return { Directory, File, Paths: { cache: { uri: 'file:///cache' } }, files, downloads, failures };
});

jest.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digestStringAsync: async (_algorithm: string, value: string) => Array.from(value, (char) => char.charCodeAt(0).toString(16).padStart(2, '0')).join('').slice(0, 16) }));

const fileSystem = jest.requireMock('expo-file-system') as { files: Map<string, string>; downloads: string[]; failures: Set<string> };

describe('答题卡图片缓存', () => {
  beforeEach(() => { fileSystem.files.clear(); fileSystem.downloads.length = 0; fileSystem.failures.clear(); });

  it('在不需要额外请求头时保留远程地址', async () => {
    await expect(fetchSheetImage('https://example.test/paper.png')).resolves.toBe('https://example.test/paper.png');
    expect(fileSystem.downloads).toEqual([]);
  });

  it('按请求头下载到缓存目录并复用已缓存文件', async () => {
    const url = 'https://example.test/secure/paper.png';
    const headers = { Cookie: 'ASP.NET_SessionId=fictional', Referer: 'https://example.test/report/singleGroup/REPORT123' };
    const first = await fetchSheetImage(url, headers);
    expect(first).toMatch(/^file:\/\/\/cache\/answer-sheets\/[0-9a-f]{16}\.png$/);
    await expect(fetchSheetImage(url, headers)).resolves.toBe(first);
    expect(fileSystem.downloads).toEqual([url]);
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
    await expect(fetchSheetImage(url, { Cookie: 'ASP.NET_SessionId=fictional' })).rejects.toThrow('下载失败');
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
