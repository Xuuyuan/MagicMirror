import {
  checkForUpdate,
  compareVersions,
  getDeviceAbis,
  getReleaseApiUrl,
  selectArchitectureAsset,
  shouldPromptForRelease,
  updateAssetPattern,
} from '@/src/services/updates';

jest.mock('expo-constants', () => ({ expoConfig: { version: '1.0.0-beta.7' } }));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: jest.fn(),
}));
jest.mock('expo-file-system', () => ({ File: class {}, Paths: { cache: {} } }));
jest.mock('expo-file-system/legacy', () => ({ getContentUriAsync: jest.fn() }));

const mockDeviceState: { abis: string[] | null } = { abis: ['arm64-v8a', 'armeabi-v7a'] };
jest.mock('expo-device', () => ({
  get supportedCpuArchitectures() {
    return mockDeviceState.abis;
  },
}));

const architectureGroups = ['arm64-v8a', 'x86_64', 'all'];

// 每次请求都要给一个全新的 Response，复用同一个实例时 body 只能读一次。
const mockReleases = (...releases: unknown[]) =>
  jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response(JSON.stringify(releases), { status: 200 }));

const release = (tag_name: string, prerelease: boolean, name = tag_name) => {
  const version = tag_name.replace(/^v/, '');
  return {
    tag_name,
    name,
    body: `notes-${tag_name}`,
    draft: false,
    prerelease,
    published_at: '2026-10-12T00:00:00Z',
    assets: [
      ...architectureGroups.map((group) => ({
        name: `MagicMirror-${version}-${group}-signed.apk`,
        size: 10,
        browser_download_url: `https://github.com/Xuuyuan/MagicMirror/releases/download/${tag_name}/${group}.apk`,
        digest: 'sha256:fictional',
      })),
      {
        name: 'SHA256SUMS.txt',
        size: 1,
        browser_download_url: `https://github.com/Xuuyuan/MagicMirror/releases/download/${tag_name}/SHA256SUMS.txt`,
      },
    ],
  };
};

describe('update service', () => {
  beforeEach(() => {
    mockDeviceState.abis = ['arm64-v8a', 'armeabi-v7a'];
  });
  afterEach(() => jest.restoreAllMocks());

  it('compares stable and prerelease versions in release order', () => {
    expect(compareVersions('1.0.0-beta.7', '1.0.0-beta.6')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0-beta.7')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-beta.7', '1.0.0')).toBeLessThan(0);
  });

  it('accepts the published APK naming contract', () => {
    for (const group of architectureGroups)
      expect(updateAssetPattern.test(`MagicMirror-1.0.0-beta.8-${group}-signed.apk`)).toBe(true);
    expect(updateAssetPattern.test('MagicMirror-1.0.0-beta.8-signed.apk')).toBe(false);
    expect(updateAssetPattern.test('MagicMirror-1.0.0-beta.8-debug.apk')).toBe(false);
  });

  it('reads the device architectures from expo-device, treating an unknown device as empty', () => {
    mockDeviceState.abis = ['x86_64', 'arm64-v8a'];
    expect(getDeviceAbis()).toEqual(['x86_64', 'arm64-v8a']);
    mockDeviceState.abis = null;
    expect(getDeviceAbis()).toEqual([]);
  });

  it('picks the asset matching the device architecture, then the universal fallback', () => {
    const assets = release('v1.0.0-beta.8', true).assets;
    expect(selectArchitectureAsset(assets, '1.0.0-beta.8', ['x86_64', 'arm64-v8a'])?.name).toBe(
      'MagicMirror-1.0.0-beta.8-x86_64-signed.apk',
    );
    expect(selectArchitectureAsset(assets, '1.0.0-beta.8', ['arm64-v8a'])?.name).toBe(
      'MagicMirror-1.0.0-beta.8-arm64-v8a-signed.apk',
    );
    expect(selectArchitectureAsset(assets, '1.0.0-beta.8', ['armeabi-v7a', 'armeabi'])?.name).toBe(
      'MagicMirror-1.0.0-beta.8-all-signed.apk',
    );
    expect(selectArchitectureAsset(assets, '1.0.0-beta.8', [])?.name).toBe(
      'MagicMirror-1.0.0-beta.8-all-signed.apk',
    );
    expect(selectArchitectureAsset(assets, '1.0.0-beta.9', ['arm64-v8a'])).toBeUndefined();
  });

  it('only bypasses an ignored version for manual checks', () => {
    expect(shouldPromptForRelease('1.0.0-beta.8', '1.0.0-beta.8')).toBe(false);
    expect(shouldPromptForRelease('1.0.0-beta.9', '1.0.0-beta.8')).toBe(true);
    expect(shouldPromptForRelease('1.0.0-beta.8', '1.0.0-beta.8', true)).toBe(true);
  });

  it('checks the newest beta when the installed version is beta', async () => {
    mockReleases(release('v1.0.0-beta.8', true), release('v1.0.0-beta.7', true));
    await expect(checkForUpdate('1.0.0-beta.7', 'https://gh-proxy.org')).resolves.toMatchObject({
      release: { version: '1.0.0-beta.8', notes: 'notes-v1.0.0-beta.8' },
    });
    expect(getReleaseApiUrl('')).toBe(
      'https://api.github.com/repos/Xuuyuan/MagicMirror/releases?per_page=20',
    );
  });

  it('offers the package built for the device architecture', async () => {
    mockDeviceState.abis = ['x86_64', 'arm64-v8a', 'x86', 'armeabi-v7a'];
    mockReleases(release('v1.0.0-beta.8', true));
    await expect(checkForUpdate('1.0.0-beta.7', '')).resolves.toMatchObject({
      release: { apkName: 'MagicMirror-1.0.0-beta.8-x86_64-signed.apk' },
    });
  });

  it('offers the universal package when the device architecture is unknown or unpublished', async () => {
    mockReleases(release('v1.0.0-beta.8', true));
    mockDeviceState.abis = ['armeabi-v7a'];
    await expect(checkForUpdate('1.0.0-beta.7', '')).resolves.toMatchObject({
      release: { apkName: 'MagicMirror-1.0.0-beta.8-all-signed.apk' },
    });
    mockDeviceState.abis = null;
    await expect(checkForUpdate('1.0.0-beta.7', '')).resolves.toMatchObject({
      release: { apkName: 'MagicMirror-1.0.0-beta.8-all-signed.apk' },
    });
  });

  it('does not select prerelease assets for a stable installation', async () => {
    mockReleases(release('v1.0.0-beta.8', true), release('v1.0.0', false));
    await expect(checkForUpdate('1.0.0', 'https://gh-proxy.org')).resolves.toMatchObject({
      release: undefined,
    });
  });
});
