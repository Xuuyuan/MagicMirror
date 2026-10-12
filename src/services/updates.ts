import { z } from 'zod';
import * as Device from 'expo-device';
import appConfig from '../../app.json';
import { requestWithTimeout } from './http';

export const updateRepository = 'Xuuyuan/MagicMirror';
export const updateMirrorBase = 'https://gh-proxy.org';
// 每个发布版本按架构组各带一个包，第二个捕获组是架构组名（all 为兜底）。
export const updateAssetPattern = /^MagicMirror-(\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?)-(arm64-v8a|x86_64|all)-signed\.apk$/;
export const updateFallbackArchitecture = 'all';

const releaseSchema = z.object({
  tag_name: z.string(),
  name: z.string().nullable(),
  body: z.string().nullable(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  published_at: z.string().nullable(),
  assets: z.array(z.object({ name: z.string(), size: z.number(), browser_download_url: z.string().url(), digest: z.string().nullable().optional() })),
});

const releasesSchema = z.array(releaseSchema);

export type UpdateRelease = {
  version: string;
  tag: string;
  title: string;
  notes: string;
  publishedAt?: string;
  apkUrl: string;
  apkName: string;
  apkSize: number;
  checksumUrl?: string;
  checksum?: string;
};

export type UpdateCheckResult = { currentVersion: string; release?: UpdateRelease };

export function getCurrentVersion(): string {
  return appConfig.expo?.version ?? '0.0.0';
}

function stripPrefix(version: string): string {
  return version.trim().replace(/^v/i, '');
}

export function compareVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const [core, pre = ''] = stripPrefix(value).split('-', 2);
    const numbers = core.split('.').map((part) => Number(part));
    const preParts = pre ? pre.split('.') : [];
    return { numbers, preParts };
  };
  const a = parse(left); const b = parse(right);
  for (let i = 0; i < 3; i += 1) { if ((a.numbers[i] ?? 0) !== (b.numbers[i] ?? 0)) return (a.numbers[i] ?? 0) > (b.numbers[i] ?? 0) ? 1 : -1; }
  if (!a.preParts.length || !b.preParts.length) return a.preParts.length === b.preParts.length ? 0 : (a.preParts.length ? -1 : 1);
  for (let i = 0; i < Math.max(a.preParts.length, b.preParts.length); i += 1) {
    const av = a.preParts[i]; const bv = b.preParts[i]; if (av === undefined) return -1; if (bv === undefined) return 1;
    if (av === bv) continue;
    const an = /^\d+$/.test(av); const bn = /^\d+$/.test(bv);
    if (an && bn) return Number(av) > Number(bv) ? 1 : -1;
    if (an !== bn) return an ? -1 : 1;
    return av > bv ? 1 : -1;
  }
  return 0;
}

export function shouldPromptForRelease(releaseVersion: string, ignoredVersion?: string, manual = false): boolean {
  return manual || !ignoredVersion || compareVersions(releaseVersion, ignoredVersion) > 0;
}

function mirrorUrl(url: string, mirror = updateMirrorBase): string { return mirror ? `${mirror.replace(/\/$/, '')}/${url}` : url; }

export function getReleaseApiUrl(mirror = updateMirrorBase): string {
  return mirrorUrl(`https://api.github.com/repos/${updateRepository}/releases?per_page=20`, mirror);
}

export function getDownloadUrl(url: string, mirror = updateMirrorBase): string { return mirrorUrl(url, mirror); }

function hexFromBuffer(buffer: ArrayBuffer): string { return Array.from(new Uint8Array(buffer), (value) => value.toString(16).padStart(2, '0')).join(''); }

async function fetchJson(url: string): Promise<unknown> {
  const response = await requestWithTimeout(fetch, url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'MagicMirror-update-check' } }, 15000);
  if (!response.ok) throw new Error(`更新源返回 HTTP ${response.status}`);
  return response.json();
}

type ReleaseAsset = z.infer<typeof releaseSchema>['assets'][number];

// 取不到架构信息（例如非 Android）时返回空数组，选包时自然回退到 all 包。
export function getDeviceAbis(): string[] { return Device.supportedCpuArchitectures ?? []; }

export function selectArchitectureAsset(assets: ReleaseAsset[], version: string, deviceAbis: string[]): ReleaseAsset | undefined {
  const byGroup = new Map<string, ReleaseAsset>();
  for (const asset of assets) {
    const matched = updateAssetPattern.exec(asset.name);
    if (matched && stripPrefix(matched[1]) === version) byGroup.set(matched[2], asset);
  }
  for (const abi of deviceAbis) { const sameArchitecture = byGroup.get(abi); if (sameArchitecture) return sameArchitecture; }
  return byGroup.get(updateFallbackArchitecture);
}

export async function checkForUpdate(currentVersion = getCurrentVersion(), mirror = updateMirrorBase): Promise<UpdateCheckResult> {
  const parsed = releasesSchema.parse(await fetchJson(getReleaseApiUrl(mirror)));
  const deviceAbis = getDeviceAbis();
  const currentIsPreRelease = /-(?:alpha|beta|rc)\./.test(currentVersion);
  const candidates = parsed.filter((release) => !release.draft && (currentIsPreRelease || !release.prerelease));
  const releases = candidates.map((release): UpdateRelease | undefined => {
    const version = stripPrefix(release.tag_name);
    const apk = selectArchitectureAsset(release.assets, version, deviceAbis);
    if (!apk) return undefined;
    const checksum = release.assets.find((asset) => asset.name === 'SHA256SUMS.txt');
    const digestValue = apk.digest?.replace(/^sha256:/i, '').toLowerCase();
    return { version, tag: release.tag_name, title: release.name?.trim() || release.tag_name, notes: release.body?.trim() || '暂无更新日志。', publishedAt: release.published_at ?? undefined, apkUrl: apk.browser_download_url, apkName: apk.name, apkSize: apk.size, checksumUrl: checksum?.browser_download_url, checksum: digestValue };
  }).filter((release): release is UpdateRelease => !!release).sort((a, b) => compareVersions(b.version, a.version));
  const latest = releases.find((release) => compareVersions(release.version, currentVersion) > 0);
  return { currentVersion, release: latest };
}

function parseChecksum(text: string, assetName: string): string | undefined { return text.split(/\r?\n/).map((line) => line.trim().split(/\s+/, 2)).find((parts) => parts[1] === assetName)?.[0]?.toLowerCase(); }

export async function downloadUpdate(release: UpdateRelease, onProgress: (progress: number) => void, mirror = updateMirrorBase): Promise<string> {
  const { CryptoDigestAlgorithm, digest } = await import('expo-crypto');
  const { File, Paths } = await import('expo-file-system');
  const destination = new File(Paths.cache, release.apkName);
  try { destination.delete(); } catch { /* 缓存文件不存在。 */ }
  const task = File.createDownloadTask(getDownloadUrl(release.apkUrl, mirror), destination, { onProgress: ({ bytesWritten, totalBytes }) => onProgress(totalBytes > 0 ? bytesWritten / totalBytes : 0) });
  const file = await task.downloadAsync();
  if (!file) throw new Error('更新下载未完成。');
  const digestValue = release.checksum ?? (release.checksumUrl ? parseChecksum(await (await requestWithTimeout(fetch, getDownloadUrl(release.checksumUrl, mirror), {}, 15000)).text(), release.apkName) : undefined);
  if (!digestValue) throw new Error('更新包缺少 SHA-256 校验值。');
  const actual = hexFromBuffer(await digest(CryptoDigestAlgorithm.SHA256, new Uint8Array(await file.arrayBuffer())));
  if (actual !== digestValue) throw new Error('更新包校验失败，文件可能已损坏。');
  onProgress(1);
  return file.uri;
}

export async function getInstallerUri(fileUri: string): Promise<string> { const LegacyFileSystem = await import('expo-file-system/legacy'); return LegacyFileSystem.getContentUriAsync(fileUri); }
