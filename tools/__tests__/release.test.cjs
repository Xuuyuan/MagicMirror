const { test } = require('node:test');
const assert = require('node:assert/strict');
const { releaseInfo, releaseNotes, verifyVersionCode } = require('../release-metadata.cjs');
const { verifyBadging, parseNativeCode } = require('../verify-release-apk.cjs');

function input(version = '1.0.0-beta.5', versionCode = 5) {
  return [
    { version, private: true },
    { version, packages: { '': { version } } },
    { expo: { version, android: { versionCode } } },
  ];
}

function variant(info, group) {
  const found = info.apks.find((apk) => apk.group === group);
  assert.ok(found, `release metadata must describe the ${group} variant`);
  return found;
}

function badging(abis) {
  return `package: name='com.magicmirror.app' versionCode='5' versionName='1.0.0-beta.5'\nnative-code: ${abis.map((abi) => `'${abi}'`).join(' ')}\n`;
}

test('beta tags map to current changelog headings, stable versions remain stable', () => {
  assert.equal(releaseInfo(...input(), 'v1.0.0-beta.5').title, '1.0.0_beta5');
  assert.equal(releaseInfo(...input('1.0.0'), 'v1.0.0').prerelease, false);
});
test('reject mismatched tags, lockfiles and Android version codes', () => {
  assert.throws(() => releaseInfo(...input(), 'v1.0.0-beta.4'));
  const data = input();
  data[1].packages[''].version = '1.0.0';
  assert.throws(() => releaseInfo(...data, 'v1.0.0-beta.5'));
  assert.throws(() => releaseInfo(...input('1.0.0-beta.5', 0), 'v1.0.0-beta.5'));
});
test('extract exactly the requested changelog section', () => {
  const text =
    '# Changes\r\n\r\n## 1.0.0_beta5 — today\r\n\r\n- New report\r\n\r\n## 1.0.0_beta4\r\n\r\n- Old report\r\n';
  assert.equal(releaseNotes(text, '1.0.0_beta5'), '- New report\n');
  assert.throws(() => releaseNotes(text, '1.0.0_beta6'));
  assert.throws(() => releaseNotes(text + '\n## 1.0.0_beta5\n- Duplicate', '1.0.0_beta5'));
  assert.throws(() => releaseNotes('## 1.0.0_beta5\nNo actual entries.', '1.0.0_beta5'));
});
test('reject versionCode reuse or downgrade across published versions', () => {
  verifyVersionCode(6, [4, 5]);
  assert.throws(() => verifyVersionCode(5, [5]));
  assert.throws(() => verifyVersionCode(4, [5]));
  assert.throws(() => verifyVersionCode(6, [undefined]));
});
test('name one APK per architecture group, keyed for the workflow outputs', () => {
  const info = releaseInfo(...input(), 'v1.0.0-beta.5');
  assert.deepEqual(
    info.apks.map((apk) => apk.file),
    [
      'MagicMirror-1.0.0-beta.5-arm64-v8a-signed.apk',
      'MagicMirror-1.0.0-beta.5-x86_64-signed.apk',
      'MagicMirror-1.0.0-beta.5-all-signed.apk',
    ],
  );
  assert.deepEqual(variant(info, 'all').abis, ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64']);
});
test('accept the ABI set of each variant and reject a mismatch or a missing native-code', () => {
  const info = releaseInfo(...input(), 'v1.0.0-beta.5');
  for (const apk of info.apks) verifyBadging(badging(apk.abis), info, apk.abis);
  const arm64 = variant(info, 'arm64-v8a');
  const all = variant(info, 'all');
  assert.throws(() => verifyBadging(badging(all.abis), info, arm64.abis));
  assert.throws(() => verifyBadging(badging(arm64.abis), info, all.abis));
  assert.throws(() =>
    verifyBadging(
      "package: name='com.magicmirror.app' versionCode='5' versionName='1.0.0-beta.5'\n",
      info,
      arm64.abis,
    ),
  );
  assert.deepEqual(parseNativeCode(badging(all.abis)), [
    'arm64-v8a',
    'armeabi-v7a',
    'x86',
    'x86_64',
  ]);
});
test('reject wrong package, wrong version or a debuggable build', () => {
  const info = releaseInfo(...input(), 'v1.0.0-beta.5');
  const abis = variant(info, 'arm64-v8a').abis;
  const text = badging(abis);
  assert.throws(() =>
    verifyBadging(text.replace('com.magicmirror.app', 'com.example.test'), info, abis),
  );
  assert.throws(() =>
    verifyBadging(text.replace("versionCode='5'", "versionCode='4'"), info, abis),
  );
  assert.throws(() => verifyBadging(text + 'application-debuggable\n', info, abis));
});
