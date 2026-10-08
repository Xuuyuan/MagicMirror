const { test } = require('node:test');
const assert = require('node:assert/strict');
const { releaseInfo, releaseNotes, verifyVersionCode } = require('../release-metadata.cjs');
const { verifyBadging } = require('../verify-release-apk.cjs');

function input(version = '1.0.0-beta.5', versionCode = 5) {
  return [{ version, private: true }, { version, packages: { '': { version } } }, { expo: { version, android: { versionCode } } }];
}

test('beta tags map to current changelog headings, stable versions remain stable', () => {
  assert.equal(releaseInfo(...input(), 'v1.0.0-beta.5').title, '1.0.0_beta5');
  assert.equal(releaseInfo(...input('1.0.0'), 'v1.0.0').prerelease, false);
});
test('reject mismatched tags, lockfiles and Android version codes', () => {
  assert.throws(() => releaseInfo(...input(), 'v1.0.0-beta.4'));
  const data = input(); data[1].packages[''].version = '1.0.0';
  assert.throws(() => releaseInfo(...data, 'v1.0.0-beta.5'));
  assert.throws(() => releaseInfo(...input('1.0.0-beta.5', 0), 'v1.0.0-beta.5'));
});
test('extract exactly the requested changelog section', () => {
  const text = '# Changes\r\n\r\n## 1.0.0_beta5 — today\r\n\r\n- New report\r\n\r\n## 1.0.0_beta4\r\n\r\n- Old report\r\n';
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
test('reject wrong package, wrong version, debuggable or extra ABIs', () => {
  const info = releaseInfo(...input(), 'v1.0.0-beta.5');
  const text = "package: name='com.magicmirror.app' versionCode='5' versionName='1.0.0-beta.5'\nnative-code: 'arm64-v8a'\n";
  verifyBadging(text, info);
  assert.throws(() => verifyBadging(text.replace('com.magicmirror.app', 'com.example.test'), info));
  assert.throws(() => verifyBadging(text.replace("versionCode='5'", "versionCode='4'"), info));
  assert.throws(() => verifyBadging(text + 'application-debuggable\n', info));
  assert.throws(() => verifyBadging(text.replace("'arm64-v8a'", "'arm64-v8a' 'x86_64'"), info));
});
