/* No credentials or response bodies are persisted. Uses the actual app Provider. */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Only the Provider and its trusted local runtime dependencies are transpiled.
const allowed = new Set([
  'src/domain/models.ts', 'src/providers/haofenshu.ts', 'src/providers/codec.ts',
  'src/services/http.ts', 'src/services/diagnostics.ts',
].map((file) => path.resolve(__dirname, '..', file)));
require.extensions['.ts'] = (module, filename) => {
  if (!allowed.has(path.resolve(filename))) throw new Error('MODULE_NOT_ALLOWED');
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  module._compile(compiled.outputText, filename);
};
const { createHaofenshuProvider } = require('../src/providers/haofenshu.ts');
const { ProviderError } = require('../src/domain/models.ts');

async function hiddenInput() {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw new Error('TTY_REQUIRED');
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdout.write('READY: hidden one-line JSON input; credentials are not echoed.\n');
  return new Promise((resolve, reject) => {
    let input = '';
    const timer = setTimeout(() => finish(new Error('INPUT_TIMEOUT')), 60000);
    function finish(error) {
      clearTimeout(timer);
      process.stdin.off('data', consume);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      if (error) reject(error); else resolve(input.trim());
    }
    function consume(chunk) {
      if (chunk.includes('\u0003')) return finish(new Error('CANCELLED'));
      input += chunk;
      if (input.length > 10000) return finish(new Error('INPUT_TOO_LONG'));
      if (/[\r\n]/.test(input)) finish();
    }
    process.stdin.on('data', consume);
    process.stdin.resume();
  });
}

async function main() {
  const live = process.argv.slice(2).join(' ') === '--live --stdin';
  if (!live && process.argv.length > 2 && process.argv.slice(2).join(' ') !== '--offline') throw new Error('INVALID_ARGUMENTS');
  const input = live ? JSON.parse(await hiddenInput()) : { account: 'fictional-demo', password: 'fictional-demo', roleType: 2 };
  if (![1, 2].includes(input.roleType) || typeof input.account !== 'string' || typeof input.password !== 'string') throw new Error('INVALID_INPUT');
  let count = 0;
  const fixtureDirectory = path.join(__dirname, '../src/__tests__/fixtures/haofenshu');
  const readFixture = (name) => JSON.parse(fs.readFileSync(path.join(fixtureDirectory, name), 'utf8'));
  const transport = async (url, options) => {
    if (++count > 6) throw new Error('REQUEST_BUDGET');
    if (!/^https:\/\/hfs-be\.yunxiao\.com\/(v2\/users\/sessions|v2\/user-center\/user-snapshot|v2\/config\/school\/hidden-config|v4\/exam\/archives\?grade=|v4\/exam\/overview\?examId=[A-Za-z0-9_-]+|v3\/exam\/[A-Za-z0-9_-]+\/overview)$/.test(String(url))) throw new Error('ROUTE_BLOCKED');
    if (live) {
      if (count > 1) await new Promise((resolve) => setTimeout(resolve, 2000));
      return fetch(url, options);
    }
    const route = new URL(url).pathname;
    let body;
    if (route === '/v2/users/sessions') body = readFixture('login-success.json');
    else if (route === '/v2/user-center/user-snapshot') body = readFixture('user-snapshot.json');
    else if (route === '/v2/config/school/hidden-config') body = { code: 0, data: {} };
    else if (route === '/v4/exam/archives') {
      // Synthetic adaptation of the legacy fixture; only its first exam has an overview.
      const exam = readFixture('exam-list.json').data.list[0];
      body = { code: 0, data: { list: [{ examId: exam.examId, name: exam.name, eventTime: exam.time,
        score: exam.scoreS, manfen: exam.manfen, classRank: exam.classRankS, gradeRank: exam.gradeRankS }] } };
    } else if (route === '/v4/exam/overview') {
      const fixture = readFixture('exam-overview.json');
      body = { code: fixture.code, data: { ...fixture.data,
        classRank: fixture.data.classRankS, gradeRank: fixture.data.gradeRankS, groupRank: fixture.data.groupRankS } };
    } else body = readFixture('exam-overview.json');
    return { status: 200, json: async () => body };
  };
  const provider = createHaofenshuProvider(input.roleType, transport);
  const report = { mode: live ? 'live' : 'offline', provider: provider.metadata.id, steps: [], outcome: 'blocked' };
  let session;
  let stage = 'authenticate';
  try {
    session = await provider.authenticate(input.account, input.password);
    input.password = ''; input.account = '';
    report.steps.push({ stage, status: 'passed' });
    stage = 'getProfile';
    await provider.getProfile(session);
    report.steps.push({ stage, status: 'passed' });
    stage = 'getExamList';
    const exams = await provider.getExamList(session);
    report.steps.push({ stage, status: 'passed' });
    stage = 'getExamResult';
    if (exams.length) {
      const result = await provider.getExamResult(session, exams[0].id);
      report.steps.push({ stage, status: 'passed', numericTotalAvailable: result.totalScore !== undefined,
        allSubjectScoresNumeric: result.subjects.every((subject) => subject.score !== undefined) });
      report.outcome = 'api_chain_passed';
    } else {
      report.steps.push({ stage, status: 'not_available' });
      report.outcome = 'partial_empty_list';
    }
  } catch (error) {
    report.steps.push({ stage, status: 'failed', code: error instanceof ProviderError ? error.code : 'LOCAL_ERROR' });
  } finally {
    input.password = ''; input.account = '';
    if (session) { await provider.logout(session); session.accessToken = ''; session = undefined; }
    report.steps.push({ stage: 'logout', status: 'local_only' });
  }
  report.requests = count;
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exitCode = report.outcome === 'api_chain_passed' ? 0 : 1;
}
main().catch(() => { process.stderr.write('Verification could not start; no request or credential details logged.\n'); process.exitCode = 1; });
