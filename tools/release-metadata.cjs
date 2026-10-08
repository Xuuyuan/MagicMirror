const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function releaseInfo(pkg, lock, app, tag) {
  const version = pkg.version;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.(0|[1-9]\d*))?$/.exec(version);
  if (!match || pkg.private !== true) throw new Error('Invalid release version or private package flag.');
  if (lock.version !== version || lock.packages?.['']?.version !== version || app.expo?.version !== version) {
    throw new Error('Release versions differ between package, lockfile and Expo config.');
  }
  const versionCode = app.expo.android?.versionCode;
  if (!Number.isSafeInteger(versionCode) || versionCode < 1) throw new Error('Invalid Android versionCode.');
  if (tag !== `v${version}`) throw new Error(`Tag must be v${version}.`);
  const title = match[4] ? `${match[1]}.${match[2]}.${match[3]}_${match[4]}${match[5]}` : version;
  return { version, versionCode, tag, title, prerelease: !!match[4], apk: `MagicMirror-${version}-signed.apk` };
}

function releaseNotes(changelog, title) {
  const sections = changelog.split(/^##\s+/m).slice(1);
  const found = sections.filter((section) => section.split(/\r?\n/, 1)[0].split(/\s/)[0] === title);
  if (found.length !== 1) throw new Error(`Expected one CHANGELOG section for ${title}.`);
  const body = found[0].replace(/^[^\n]*(?:\n|$)/, '').trim();
  if (!body || !/^-\s+\S/m.test(body)) throw new Error(`CHANGELOG section for ${title} has no changes.`);
  return `${body}\n`;
}

function verifyVersionCode(current, previous) {
  if (previous.some((code) => !Number.isSafeInteger(code) || code < 1 || current <= code)) {
    throw new Error('Android versionCode must exceed every published release versionCode.');
  }
}

function main() {
  const root = path.resolve(__dirname, '..');
  const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  const tag = process.argv[2];
  const info = releaseInfo(read('package.json'), read('package-lock.json'), read('app.json'), tag);
  const notes = releaseNotes(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), info.title);
  if (process.env.GITHUB_ACTIONS === 'true') {
    execFileSync('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/main'], { cwd: root });
    const releases = JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp', `repos/${process.env.GITHUB_REPOSITORY}/releases?per_page=100`], { encoding: 'utf8' })).flat();
    if (releases.some((release) => !release.draft && release.tag_name === tag)) throw new Error('This version is already published.');
    const previousCodes = releases.filter((release) => !release.draft).map((release) => {
      if (!/^v\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/.test(release.tag_name)) throw new Error('Unexpected published release tag.');
      return JSON.parse(execFileSync('git', ['show', `${release.tag_name}:app.json`], { cwd: root, encoding: 'utf8' })).expo.android.versionCode;
    });
    verifyVersionCode(info.versionCode, previousCodes);
  }
  const outputDirectory = path.join(root, 'dist');
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, 'release-notes.md'), notes);
  fs.writeFileSync(path.join(outputDirectory, 'release-metadata.json'), `${JSON.stringify(info, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(info).map(([key, value]) => `${key}=${value}\n`).join(''));
  }
  console.log(`Validated ${tag}, Android versionCode ${info.versionCode}.`);
}

module.exports = { releaseInfo, releaseNotes, verifyVersionCode };
if (require.main === module) main();
