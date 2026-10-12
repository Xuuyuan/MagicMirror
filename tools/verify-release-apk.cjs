const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

function parseNativeCode(text) {
  const line = /^native-code:(.*)$/m.exec(text);
  return line ? [...line[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]).sort() : [];
}

function verifyBadging(text, info, expectedAbis) {
  if (!text.includes("name='com.magicmirror.app'") || !text.includes(`versionCode='${info.versionCode}'`) || !text.includes(`versionName='${info.version}'`)) {
    throw new Error('APK package/version does not match release metadata.');
  }
  if (/^application-debuggable/m.test(text)) {
    throw new Error('APK must not be debuggable.');
  }
  const actual = parseNativeCode(text);
  const expected = [...expectedAbis].sort();
  if (actual.length !== expected.length || actual.some((abi, index) => abi !== expected[index])) {
    throw new Error(`APK native-code must be exactly ${expected.join(', ')}, found ${actual.length ? actual.join(', ') : 'none'}.`);
  }
}

function main() {
  const info = JSON.parse(fs.readFileSync('dist/release-metadata.json', 'utf8'));
  const tools = path.join(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT, 'build-tools', '36.0.0');
  const executable = path.join(tools, process.platform === 'win32' ? 'aapt.exe' : 'aapt');
  const sums = [];
  for (const apk of info.apks) {
    const file = path.resolve('dist', apk.file);
    const result = spawnSync(executable, ['dump', 'badging', file], { encoding: 'utf8' });
    if (result.error || result.status !== 0) throw new Error(`aapt could not inspect ${apk.file}.`);
    try {
      verifyBadging(result.stdout, info, apk.abis);
    } catch (error) {
      throw new Error(`${apk.file}: ${error.message}`);
    }
    const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    sums.push(`${hash}  ${apk.file}`);
    console.log(`Verified ${apk.file}: ${hash}`);
  }
  fs.writeFileSync('dist/SHA256SUMS.txt', `${sums.join('\n')}\n`);
}

module.exports = { verifyBadging, parseNativeCode };
if (require.main === module) main();
