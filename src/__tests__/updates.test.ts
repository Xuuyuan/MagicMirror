import { checkForUpdate, compareVersions, getReleaseApiUrl, shouldPromptForRelease, updateAssetPattern } from '@/src/services/updates';

jest.mock('expo-constants', () => ({ expoConfig: { version: '1.0.0-beta.7' } }));
jest.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digest: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: class {}, Paths: { cache: {} } }));
jest.mock('expo-file-system/legacy', () => ({ getContentUriAsync: jest.fn() }));

const release = (tag_name: string, prerelease: boolean, name = tag_name) => ({ tag_name, name, body: `notes-${tag_name}`, draft: false, prerelease, published_at: '2026-10-12T00:00:00Z', assets: [{ name: `MagicMirror-${tag_name.replace(/^v/, '')}-signed.apk`, size: 10, browser_download_url: `https://github.com/Xuuyuan/MagicMirror/releases/download/${tag_name}/app.apk`, digest: 'sha256:fictional' }, { name: 'SHA256SUMS.txt', size: 1, browser_download_url: `https://github.com/Xuuyuan/MagicMirror/releases/download/${tag_name}/SHA256SUMS.txt` }] });

describe('update service', () => {
  afterEach(() => jest.restoreAllMocks());

  it('compares stable and prerelease versions in release order', () => {
    expect(compareVersions('1.0.0-beta.7', '1.0.0-beta.6')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0-beta.7')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-beta.7', '1.0.0')).toBeLessThan(0);
  });

  it('accepts the published APK naming contract', () => {
    expect(updateAssetPattern.test('MagicMirror-1.0.0-beta.8-signed.apk')).toBe(true);
    expect(updateAssetPattern.test('MagicMirror-1.0.0-beta.8-debug.apk')).toBe(false);
  });

  it('only bypasses an ignored version for manual checks', () => {
    expect(shouldPromptForRelease('1.0.0-beta.8', '1.0.0-beta.8')).toBe(false);
    expect(shouldPromptForRelease('1.0.0-beta.9', '1.0.0-beta.8')).toBe(true);
    expect(shouldPromptForRelease('1.0.0-beta.8', '1.0.0-beta.8', true)).toBe(true);
  });

  it('checks the newest beta when the installed version is beta', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([release('v1.0.0-beta.8', true), release('v1.0.0-beta.7', true)]), { status: 200 }));
    await expect(checkForUpdate('1.0.0-beta.7', 'https://gh-proxy.org')).resolves.toMatchObject({ release: { version: '1.0.0-beta.8', notes: 'notes-v1.0.0-beta.8' } });
    expect(getReleaseApiUrl('')).toBe('https://api.github.com/repos/Xuuyuan/MagicMirror/releases?per_page=20');
  });

  it('does not select prerelease assets for a stable installation', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([release('v1.0.0-beta.8', true), release('v1.0.0', false)]), { status: 200 }));
    await expect(checkForUpdate('1.0.0', 'https://gh-proxy.org')).resolves.toMatchObject({ release: undefined });
  });
});
