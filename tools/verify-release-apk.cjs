const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

function verifyBadging(text, info) {
  if (!text.includes("name='com.magicmirror.app'") || !text.includes(`versionCode='${info.versionCode}'`) || !text.includes(`versionName='${info.version}'`)) {
    throw new Error('APK package/version does not match release metadata.');
  }
  if (/^application-debuggable/m.test(text) || !/^native-code: 'arm64-v8a'\s*$/m.test(text)) {
    throw new Error('APK must be a non-debuggable ARM64-only release.');
  }
}

function main() {
  const info = JSON.parse(fs.readFileSync('dist/release-metadata.json', 'utf8'));
  const apk = path.resolve('dist', info.apk);
  const tools = path.join(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT, 'build-tools', '36.0.0');
  const executable = path.join(tools, process.platform === 'win32' ? 'aapt.exe' : 'aapt');
  const result = spawnSync(executable, ['dump', 'badging', apk], { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error('aapt could not inspect the release APK.');
  verifyBadging(result.stdout, info);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex');
  fs.writeFileSync('dist/SHA256SUMS.txt', `${hash}  ${info.apk}\n`);
  console.log(`Verified ${info.apk}: ${hash}`);
}

module.exports = { verifyBadging };
if (require.main === module) main();
