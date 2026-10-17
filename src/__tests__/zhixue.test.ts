import { createZhixueProvider, zhixueOfficialHost } from '../providers/zhixue';
import { zhixueLoginScript } from '../providers/zhixue-login';
import { bytesToBase64, utf8ToBytes } from '../providers/codec';
import { clearDiagnostics, diagnosticSnapshot, setDiagnosticDebugMode } from '../services/diagnostics';
import type { AuthSession } from '../domain/models';
const { runInNewContext } = jest.requireActual<{ runInNewContext: (code: string, context: object) => unknown }>('node:vm');

jest.mock('expo-crypto', () => ({
  randomUUID: () => 'fictional-guid', CryptoDigestAlgorithm: { MD5: 'MD5' },
  digestStringAsync: async (_algorithm: string, value: string) => jest.requireActual<{ createHash: (algorithm: string) => { update: (input: string) => { digest: (format: string) => string } } }>('node:crypto').createHash('md5').update(value).digest('hex'),
}));
// All identities, dates, scores and tokens here are invented fixtures.
const www = 'https://www.zhixue.com';
const user = { userId: 'fictional-parent', curChildId: 'fictional-student', userType: 'PARENT' };
const years = [
  { code: '2098-2099', name: '2098–2099学年', beginTime: '4069872000000', endTime: '4101407999000' },
  { code: '2020-2021', name: '虚构历史学年', beginTime: '1596240000000', endTime: '1627775999000' },
];
const token = `fictional.${bytesToBase64(utf8ToBytes(JSON.stringify({ exp: 4102444800 })))}.fictional`;
const payload = { token, student: { id: user.curChildId, name: '虚构学生', schoolName: '虚构中学' } };
const session: AuthSession = { providerId: 'zhixue', accountId: user.userId, accessToken: token, providerContext: { studentId: user.curChildId, studentName: payload.student.name, host: www } };
const exam = (index: number) => ({ examId: `fictional-exam-${index}`, examName: `虚构考试${index}`, examCreateDateTime: 1600000000000, examType: 'monthlyExam', hasExamReport: false, score: 0 });
type Handler = (url: URL, init: RequestInit) => unknown;
function setup(handler?: Handler) {
  const transport = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    let body = handler?.(url, init ?? {});
    if (body === undefined) {
      if (url.pathname.endsWith('/getUserInfo')) body = { errorCode: 0, result: user };
      else if (url.pathname.endsWith('/academicYear')) body = { errorCode: 0, result: years };
      else if (url.pathname.includes('RoutingHost') || url.pathname.endsWith('/getHostByBusinessId')) body = { code: 200, data: { host: www + '/' } };
      else throw new Error('Unexpected fictional request');
    }
    return { ok: true, status: 200, json: async () => body } as Response;
  });
  return { provider: createZhixueProvider(transport), transport };
}
afterEach(() => { setDiagnosticDebugMode(false); clearDiagnostics(); });
it('opens the official mobile login form and returns directly to the parent page', () => {
  const { provider } = setup();
  const entry = new URL(provider.webLogin!.url);
  expect(entry.origin).toBe(www);
  expect(entry.pathname).toBe('/wap_login.html');
  expect(entry.searchParams.get('nextpage')).toBe(`${www}/container/container/parent/index/`);
});
it('validates web session and profile without requiring exams, passwords or cookies', async () => {
  const { provider, transport } = setup();
  const value = await provider.webLogin!.authenticate(payload);
  expect(value).toMatchObject({ accountId: user.userId, accessToken: token, expiresAt: 4102444800000 });
  expect(await provider.getProfile(value)).toMatchObject({ id: user.curChildId, displayName: payload.student.name });
  for (const [url, init] of transport.mock.calls) {
    expect(String(url)).not.toContain(token);
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'error' });
    const headers = new Headers(init!.headers);
    expect(headers.get('XToken')).toBe(token);
    expect(headers.get('Cookie')).toBeNull();
    expect(headers.get('authtoken')).toMatch(/^[a-f0-9]{32}$/);
  }
  expect(provider.getProfiles).toBeUndefined();
  expect(provider.selectProfile).toBeUndefined();
  expect(provider.refreshSession).toBeUndefined();
});
it('rejects a mismatched current student and refuses password login', async () => {
  const { provider } = setup();
  await expect(provider.webLogin!.authenticate({ ...payload, student: { ...payload.student, id: 'other' } })).rejects.toMatchObject({ code: 'RESTRICTED' });
  await expect(provider.authenticate('fictional', 'fictional')).rejects.toMatchObject({ code: 'UNSUPPORTED' });
});
it.each(['https://evil.test/', 'http://www.zhixue.com/', 'https://www.zhixue.com.evil.test/', 'https://user@www.zhixue.com/', 'https://www.zhixue.com:444/', 'https://ali-bg.zhixue.com/arbitrary'])('refuses unsafe route %s', (host) => {
  expect(() => zhixueOfficialHost(host)).toThrow();
});
it('follows the official next cursor for 10/10/8 exams, preserves historical context and stops at the end', async () => {
  const queries: URL[] = [];
  const { provider, transport } = setup((url) => {
    if (!url.pathname.endsWith('/getUserExamList')) return;
    queries.push(url);
    const page = Number(url.searchParams.get('pageIndex'));
    return { errorCode: 0, result: { examList: Array.from({ length: page === 3 ? 8 : 10 }, (_, i) => exam((page - 1) * 10 + i)), hasNextPage: page < 3, pagination: { pageIndex: page + 1, actualPosition: page * 3 } } };
  });
  const all = [];
  for (const offset of [0, 10, 20, 28]) all.push(...await provider.getExamList(session, { offset, academicYear: years[1].code }));
  expect(all).toHaveLength(28);
  expect(new Set(all.map((value) => value.id)).size).toBe(28);
  expect(all[0].hasResult).toBeUndefined();
  expect(all[0].availability).toBeUndefined();
  expect(queries.map((url) => url.searchParams.get('actualPosition'))).toEqual(['0', '3', '6']);
  expect(queries.map((url) => url.searchParams.get('startSchoolYear'))).toEqual([years[1].beginTime, years[1].beginTime, years[1].beginTime]);
  expect(transport.mock.calls.length).toBeGreaterThan(3);
  expect((await provider.getAcademicYears!(session)).map((value) => value.id)).toContain(years[1].code);
});
async function examId() {
  const { provider } = setup((url) => url.pathname.endsWith('/getUserExamList') ? { errorCode: 0, result: { examList: [exam(1)], hasNextPage: false, pagination: { pageIndex: 2, actualPosition: 0 } } } : undefined);
  return (await provider.getExamList(session, { academicYear: years[1].code }))[0].id;
}
const sheetFixture = {
  showSingleTopicScore: true,
  sheetDatas: JSON.stringify({ userAnswerRecordDTO: { answerRecordDetails: [{ topicNumber: 1, dispTitle: '1', score: 0, standardScore: 4 }] } }),
  sheetImages: JSON.stringify(['https://fictional-storage.example/page-1.png', 'https://fictional-storage.example/page-2.png']),
};
const objectiveSheetFixture = { ...sheetFixture, sheetDatas: JSON.stringify({ userAnswerRecordDTO: { answerRecordDetails: [
  { topicNumber: 1, dispTitle: '1', score: 0, standardScore: 4, answerType: 's01Text', answer: 'B' },
  { topicNumber: 2, dispTitle: '2', score: 2, standardScore: 6, answerType: 's02Image' },
] } }) };
async function sheetSetup(handler?: Handler) {
  const encoded = await examId();
  const fixture = setup((url, init) => {
    const handled = handler?.(url, init);
    if (handled !== undefined) return handled;
    if (url.pathname.endsWith('/getReportMain')) return { errorCode: 0, result: { paperList: [{ paperId: 'paper', subjectName: '虚构化学', userScore: 80, standardScore: 100 }] } };
    if (url.pathname.endsWith('/checksheet/')) return { errorCode: 0, result: sheetFixture };
  });
  return { ...fixture, encoded, cached: await fixture.provider.getExamResult(session, encoded) };
}
const multiRegionFixture = { ...sheetFixture, sheetDatas: JSON.stringify({
  userAnswerRecordDTO: { answerRecordDetails: [{ topicNumber: 1, dispTitle: '作文', score: 12, standardScore: 20, answerType: 's02Image' }] },
  answerSheetLocationDTO: { comeFrom: 0, paperType: 'A3', pageSheets: [{ pageIndex: 1, sections: [{ type: 'AnswerQuestion',
    contents: { branch: [20, 140, 260].map((left) => ({ ixList: [1], position: { left, top: 30, width: 100, height: 220 } })) },
  }] }] },
}) };
it('loads every essay region through the web session and uses cached subject membership', async () => {
  const { provider, transport, encoded, cached } = await sheetSetup((url) => url.pathname.endsWith('/checksheet/') ? { errorCode: 0, result: multiRegionFixture } : undefined);
  const detail = await provider.getSubjectDetail!(session, encoded, 'paper', cached);
  expect(detail.questions?.[0].providerContext?.answerImageAvailable).toBe('true');
  const signal = new AbortController().signal;
  const sheets = await provider.getQuestionAnswerSheets!(session, encoded, 'paper', '1', cached, { signal });
  expect(sheets).toHaveLength(3);
  expect(sheets.every((sheet) => sheet.url === 'https://fictional-storage.example/page-2.png' && !sheet.headers)).toBe(true);
  expect(sheets.map((sheet) => sheet.region!.x)).toEqual([20 / 420, 140 / 420, 260 / 420]);
  expect(transport.mock.calls.filter(([url]) => String(url).includes('/getReportMain'))).toHaveLength(1);
  await expect(provider.getQuestionAnswerSheets!(session, encoded, 'other-paper', '1', cached)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(provider.getQuestionAnswerSheets!(session, encoded, 'paper', 'missing', cached)).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
it('does not expose question regions when the current student changes during checksheet retrieval', async () => {
  let changed = false;
  const { provider, encoded, cached } = await sheetSetup((url) => {
    if (url.pathname.endsWith('/checksheet/')) { changed = true; return { errorCode: 0, result: multiRegionFixture }; }
    if (changed && url.pathname.endsWith('/getUserInfo')) return { errorCode: 0, result: { ...user, curChildId: 'other-student' } };
  });
  await expect(provider.getQuestionAnswerSheets!(session, encoded, 'paper', '1', cached)).rejects.toMatchObject({ code: 'RESTRICTED' });
});
it('adds report sections through the same authenticated transport without reading module configuration', async () => {
  const { provider, transport, encoded, cached } = await sheetSetup((url) => {
    if (url.pathname.endsWith('/getLevelTrend')) return { errorCode: 0, result: { list: [{ tag: { code: 'clazz' }, dataList: [{ name: '虚构考试', level: 'B等', statTotalNum: 12 }] }] } };
    if (url.pathname.endsWith('/getSubjectDiagnosis')) return { errorCode: 0, result: { tips: '虚构学科建议', list: [] } };
    if (url.pathname.endsWith('/getExamPointsAndScoringAbility')) return { errorCode: 0, result: { tip: '虚构知识点建议', dataList: [] } };
  });
  expect(cached.reportSections?.map((section) => section.id)).toEqual(['zhixue-trend', 'zhixue-subject-diagnosis']);
  const detail = await provider.getSubjectDetail!(session, encoded, 'paper', cached);
  expect(detail.questions).toHaveLength(1);
  expect(detail.reportSections?.map((section) => section.id)).toEqual(['zhixue-trend', 'zhixue-knowledge']);
  const [input, init] = transport.mock.calls.find(([url]) => String(url).includes('/paper/getLevelTrend'))!;
  const url = new URL(String(input));
  expect(Object.fromEntries(url.searchParams)).toEqual({ examId: 'fictional-exam-1', paperId: 'paper', pageIndex: '1', pageSize: '5', startSchoolYear: years[1].beginTime, endSchoolYear: years[1].endTime });
  expect(new Headers(init!.headers).get('XToken')).toBe(token);
  expect(String(input)).not.toContain(token);
  expect(transport.mock.calls.some(([url]) => String(url).includes('getModules'))).toBe(false);
});
it('preserves subject reports when school checksheet access is closed', async () => {
  const { provider, encoded, cached } = await sheetSetup((url) => {
    if (url.pathname.endsWith('/checksheet/')) return { errorCode: 40219 };
    if (url.pathname.endsWith('/getLevelTrend')) return { errorCode: 1111 };
    if (url.pathname.endsWith('/getSubjectDiagnosis')) return { errorCode: 40217 };
    if (url.pathname.endsWith('/getExamPointsAndScoringAbility')) return { errorCode: 0, result: { tip: '虚构知识点说明', dataList: [] } };
  });
  const detail = await provider.getSubjectDetail!(session, encoded, 'paper', cached);
  expect(detail).toMatchObject({ score: 80, questions: [], questionNotice: expect.any(String) });
  expect(detail.reportSections).toHaveLength(1);
  expect(detail.reportSections![0].notes).toContain('虚构知识点说明');
});
it('does not return report sections if the current student changes during an optional request', async () => {
  let changed = false;
  const { provider } = setup((url) => {
    if (url.pathname.endsWith('/getUserInfo')) return { errorCode: 0, result: changed ? { ...user, curChildId: 'other-student' } : user };
    if (url.pathname.endsWith('/getReportMain')) return { errorCode: 0, result: { paperList: [] } };
    if (url.pathname.endsWith('/getLevelTrend')) { changed = true; return { errorCode: 0, result: { list: [] } }; }
    if (url.pathname.endsWith('/getSubjectDiagnosis')) return { errorCode: 0, result: { tips: '虚构受保护说明', list: [] } };
  });
  await expect(provider.getExamResult(session, await examId())).rejects.toMatchObject({ code: 'RESTRICTED' });
});
it('loads historical question scores and all answer-sheet pages through the official exam route', async () => {
  const { provider, transport, encoded, cached } = await sheetSetup((url) => url.pathname.endsWith('/getHostByBusinessId') ? { code: 200, data: { host: 'https://ali-bg.zhixue.com/' } } : undefined);
  expect(provider.capabilities).toMatchObject({ subjectDetails: true, questionScores: true, answerSheets: true });
  const detail = await provider.getSubjectDetail!(session, encoded, 'paper', cached);
  expect(detail).toMatchObject({ subject: '虚构化学', score: 80, maxScore: 100, questions: [{ label: '1', score: 0, maxScore: 4 }] });
  expect(await provider.getAnswerSheets!(session, encoded, 'paper', cached)).toHaveLength(2);
  const calls = transport.mock.calls.filter(([url]) => String(url).includes('/checksheet/'));
  expect(calls).toHaveLength(2);
  for (const [input, init] of calls) {
    const url = new URL(String(input));
    expect(url.origin).toBe('https://ali-bg.zhixue.com');
    expect(Object.fromEntries(url.searchParams)).toEqual({ examId: 'fictional-exam-1', paperId: 'paper', startSchoolYear: years[1].beginTime, endSchoolYear: years[1].endTime });
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'error' });
    expect(new Headers(init?.headers).get('XToken')).toBe(token);
  }
  expect(transport.mock.calls.filter(([url]) => String(url).includes('/getReportMain'))).toHaveLength(1);
});
it('loads objective correct answers from the actual zxbReport endpoint and parses its JSON-string result', async () => {
  setDiagnosticDebugMode(true);
  const { provider, transport, encoded, cached } = await sheetSetup((url) => {
    if (url.pathname.endsWith('/checksheet/')) return { errorCode: 0, result: objectiveSheetFixture };
    if (url.pathname === '/zxbReport/report/getPaperAnalysis') return { errorCode: 0, result: JSON.stringify({
      isForbidAnalysis: true, typeTopicAnalysis: [{ topicAnalysisDTOs: [
        { topicNumber: 1, answerType: 's01Text', standardAnswer: 'A', userAnswer: 'B' },
      ] }],
    }) };
  });
  const result = await provider.getSubjectDetail!(session, encoded, 'paper', cached);
  expect(result.questions).toMatchObject([
    { kind: 'objective', myAnswer: 'B', answer: 'A', score: 0 }, { kind: 'subjective', score: 2 },
  ]);
  expect(result.questionNotice).toBeUndefined();
  const [input, init] = transport.mock.calls.find(([url]) => String(url).includes('/getPaperAnalysis'))!;
  const url = new URL(String(input));
  expect(url.origin).toBe(www);
  expect(Object.fromEntries(url.searchParams)).toEqual({ examId: 'fictional-exam-1', paperId: 'paper' });
  expect(init).toMatchObject({ credentials: 'omit', redirect: 'error' });
  expect(new Headers(init?.headers).get('XToken')).toBe(token);
  expect(diagnosticSnapshot()).toEqual([]);
});
it('preserves scores and my answers if the correct-answer resource is unavailable', async () => {
  const { provider, encoded, cached } = await sheetSetup((url) => {
    if (url.pathname.endsWith('/checksheet/')) return { errorCode: 0, result: objectiveSheetFixture };
    if (url.pathname.endsWith('/getPaperAnalysis')) return { errorCode: 40217 };
  });
  expect(await provider.getSubjectDetail!(session, encoded, 'paper', cached)).toMatchObject({
    score: 80, questions: [{ kind: 'objective', myAnswer: 'B' }, { kind: 'subjective' }], questionNotice: expect.stringContaining('选择题正确答案'),
  });
});
it('never hides expiry or a changed student during the separate correct-answer request', async () => {
  let changed = false;
  const { provider, encoded, cached } = await sheetSetup((url) => {
    if (url.pathname.endsWith('/checksheet/')) return { errorCode: 0, result: objectiveSheetFixture };
    if (url.pathname.endsWith('/getPaperAnalysis')) {
      changed = true;
      return { errorCode: 0, result: JSON.stringify({ typeTopicAnalysis: [] }) };
    }
    if (changed && url.pathname.endsWith('/getUserInfo')) return { errorCode: 0, result: { ...user, curChildId: 'fictional-other-student' } };
  });
  await expect(provider.getSubjectDetail!(session, encoded, 'paper', cached)).rejects.toMatchObject({ code: 'RESTRICTED' });
  const expired = await sheetSetup((url) => {
    if (url.pathname.endsWith('/checksheet/')) return { errorCode: 0, result: objectiveSheetFixture };
    if (url.pathname.endsWith('/getPaperAnalysis')) return { errorCode: 3001 };
  });
  await expect(expired.provider.getSubjectDetail!(session, expired.encoded, 'paper', expired.cached)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
});
it('resolves subject membership without cache and ignores a cache for another exam', async () => {
  const { provider, encoded, cached, transport } = await sheetSetup();
  await expect(provider.getSubjectDetail!(session, encoded, 'paper')).resolves.toMatchObject({ subjectId: 'paper' });
  await expect(provider.getAnswerSheets!(session, encoded, 'paper', { ...cached, examId: 'different-exam', subjects: [] })).resolves.toHaveLength(2);
  expect(transport.mock.calls.filter(([url]) => String(url).includes('/getReportMain'))).toHaveLength(3);
  await expect(provider.getAnswerSheets!(session, encoded, 'other-paper', cached)).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
it.each([[40216, 'RESTRICTED'], [40219, 'RESTRICTED'], [40218, 'NOT_FOUND'], [40220, 'NOT_FOUND'], [-1, 'NOT_FOUND']] as const)('keeps the subject score usable when checksheet returns %s', async (code, expected) => {
  const { provider, encoded, cached } = await sheetSetup((url) => url.pathname.endsWith('/checksheet/') ? { errorCode: code } : undefined);
  expect(await provider.getSubjectDetail!(session, encoded, 'paper', cached)).toMatchObject({ score: 80, questions: [], questionNotice: expect.any(String) });
  await expect(provider.getAnswerSheets!(session, encoded, 'paper', cached)).rejects.toMatchObject({ code: expected });
});
it('does not hide expiry or return private content if the current student changes while fetching sheets', async () => {
  let changed = false;
  const { provider, encoded, cached } = await sheetSetup((url) => {
    if (url.pathname.endsWith('/checksheet/')) { changed = true; return { errorCode: 0, result: sheetFixture }; }
    if (changed && url.pathname.endsWith('/getUserInfo')) return { errorCode: 0, result: { ...user, curChildId: 'other-student' } };
  });
  await expect(provider.getAnswerSheets!(session, encoded, 'paper', cached)).rejects.toMatchObject({ code: 'RESTRICTED' });
  const expired = await sheetSetup((url) => url.pathname.endsWith('/checksheet/') ? { errorCode: 3001 } : undefined);
  await expect(expired.provider.getSubjectDetail!(session, expired.encoded, 'paper', expired.cached)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
});
it('rejects a different-student exam and revoked sessions before fetching checksheets', async () => {
  const { provider, encoded, cached, transport } = await sheetSetup();
  const other = `zx1.${bytesToBase64(utf8ToBytes(JSON.stringify({ v: 1, examId: 'fictional-exam-1', studentId: 'other-student', start: years[1].beginTime, end: years[1].endTime })))}`;
  await expect(provider.getAnswerSheets!(session, other, 'paper', cached)).rejects.toMatchObject({ code: 'RESTRICTED' });
  await provider.logout(session);
  await expect(provider.getSubjectDetail!(session, encoded, 'paper', cached)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  expect(transport.mock.calls.some(([url]) => String(url).includes('/checksheet/'))).toBe(false);
});
it('uses the only paper as the exam summary after provider restart and keeps both raw/scaled full-score bases', async () => {
  const encoded = await examId();
  const main = { paperList: [{ paperId: 'paper', subjectName: '虚构化学', hasAssignScore: true, userScore: 80, preAssignScore: 40, standardScore: 70, assignStandardScore: 100 }], title: '虚构单科考试' };
  const { provider } = setup((url) => url.pathname.endsWith('/getReportMain') ? { errorCode: 0, result: main } : undefined);
  const value = await provider.getExamResult(session, encoded);
  expect(value).toMatchObject({ totalScore: 80, maxTotalScore: 100, originalTotalScore: 40, originalMaxTotalScore: 70, examName: '考试报告', examNameIsFallback: true });
  expect(value.subjects[0]).toMatchObject({ score: 80, maxScore: 100, providerContext: { originalScore: '40', scaledScore: '80' } });
  expect(value.ranking).toBeUndefined();
});
it('does not sum multiple papers when the official total is absent', async () => {
  const { provider } = setup((url) => url.pathname.endsWith('/getReportMain') ? { errorCode: 0, result: {
    title: '学情报告', paperList: [{ paperId: 'p1', subjectName: '虚构化学', userScore: 80 }, { paperId: 'p2', subjectName: '虚构数学', userScore: 90 }],
  } } : undefined);
  const result = await provider.getExamResult(session, await examId());
  expect(result.totalScore).toBeUndefined();
  expect(result.examNameIsFallback).toBe(true);
  expect(result.examName).not.toBe('学情报告');
});
it.each([
  [{ userScore: 0, standardScore: 100, userLevel: 'A' }, { totalScore: 0, maxTotalScore: 100, grade: 'A' }],
  [{ userLevel: 'B' }, { totalScore: undefined, maxTotalScore: undefined, grade: 'B' }],
] as const)('preserves zero or grade-only single-paper summaries', async (paper, expected) => {
  const { provider } = setup((url) => url.pathname.endsWith('/getReportMain') ? { errorCode: 0, result: {
    paperList: [{ paperId: 'p1', subjectName: '虚构化学', ...paper }],
  } } : undefined);
  expect(await provider.getExamResult(session, await examId())).toMatchObject(expected);
});
it('keeps the official total and true exam name authoritative even for a single-paper exam', async () => {
  const { provider } = setup((url) => url.pathname.endsWith('/getReportMain') ? { errorCode: 0, result: {
    title: '学情报告', paperList: [{ paperId: 'p1', subjectName: '虚构化学', userScore: 80, standardScore: 100 }],
    totalScore: { examName: '虚构真实考试名称', userScore: 70, standardScore: 90 },
  } } : undefined);
  const result = await provider.getExamResult(session, await examId());
  expect(result).toMatchObject({ examName: '虚构真实考试名称', totalScore: 70, maxTotalScore: 90 });
  expect(result.examNameIsFallback).toBeUndefined();
});
it('preserves zero, missing scores and explicit total with independent full-score bases', async () => {
  const encoded = await examId();
  const { provider } = setup((url) => url.pathname.endsWith('/getReportMain') ? { errorCode: 0, result: {
    paperList: [{ paperId: 'zero', subjectName: '虚构数学', userScore: 0, standardScore: 150 }, { paperId: 'missing', subjectName: '虚构英语', userScore: '--' }],
    totalScore: { examName: '虚构总分考试', hasAssignScore: true, userScore: 100, preAssignScore: 70, standardScore: 200, assignStandardScore: 250 },
  } } : undefined);
  const value = await provider.getExamResult(session, encoded);
  expect(value).toMatchObject({ totalScore: 100, originalTotalScore: 70, maxTotalScore: 250, originalMaxTotalScore: 200 });
  expect(value.subjects[0].score).toBe(0);
  expect(value.subjects[1].score).toBeUndefined();
  expect(value.subjects[1].status).toBeUndefined();
});
it('rejects a server-side student change before querying reports', async () => {
  const { provider, transport } = setup((url) => url.pathname.endsWith('/getUserInfo') ? { errorCode: 0, result: { ...user, curChildId: 'other' } } : undefined);
  await expect(provider.getExamResult(session, await examId())).rejects.toMatchObject({ code: 'RESTRICTED' });
  expect(transport.mock.calls.some(([url]) => String(url).includes('getReportMain'))).toBe(false);
});
it('does not return exam content if the official current student changed while reading it', async () => {
  let calls = 0;
  const { provider } = setup((url) => {
    if (url.pathname.endsWith('/getUserInfo')) return { errorCode: 0, result: ++calls === 1 ? user : { ...user, curChildId: 'changed' } };
    if (url.pathname.endsWith('/getUserExamList')) return { errorCode: 0, result: { examList: [exam(1)], hasNextPage: false, pagination: { pageIndex: 2, actualPosition: 0 } } };
  });
  await expect(provider.getExamList(session)).rejects.toMatchObject({ code: 'RESTRICTED' });
});
it('does not clear another token session pagination on local logout', async () => {
  const { provider } = setup((url) => url.pathname.endsWith('/getUserExamList') ? { errorCode: 0, result: { examList: [exam(Number(url.searchParams.get('pageIndex')))], hasNextPage: true, pagination: { pageIndex: Number(url.searchParams.get('pageIndex')) + 1, actualPosition: 3 } } } : undefined);
  const other = { ...session, accessToken: 'fictional-other-token' };
  await provider.getExamList(session);
  await provider.getExamList(other);
  await provider.logout(session);
  await expect(provider.getExamList(other, { offset: 1 })).resolves.toHaveLength(1);
});
it('distinguishes empty lists, expiry, content absence and schema errors', async () => {
  const { provider } = setup((url) => url.pathname.endsWith('/getUserExamList') ? { errorCode: 0, result: { examList: [], hasNextPage: false, pagination: { pageIndex: 2, actualPosition: 0 } } } : undefined);
  expect(await provider.getExamList(session)).toEqual([]);
  for (const [code, expected] of [[3001, 'SESSION_EXPIRED'], [40217, 'NOT_FOUND'], [9999, 'UNKNOWN']] as const) {
    const fixture = setup(() => ({ errorCode: code }));
    await expect(fixture.provider.getProfile(session)).rejects.toMatchObject({ code: expected });
  }
  await expect(setup(() => ({ unexpected: true })).provider.getProfile(session)).rejects.toMatchObject({ code: 'UNKNOWN' });
});
it('limits official time calibration to one retry and never exports sensitive diagnostics', async () => {
  setDiagnosticDebugMode(true);
  const { provider, transport } = setup(() => ({ errorCode: 9801, result: [{ systime: String(Date.now()) }] }));
  await expect(provider.getProfile(session)).rejects.toThrow('时间校准失败');
  expect(transport).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(diagnosticSnapshot())).not.toContain(token);
  expect(diagnosticSnapshot()).toEqual([]);
});
it('automatically opens the report after reading the parent student, then emits only its explicit payload', () => {
  const local = new Map([['xToken', token]]);
  const storage = new Map<string, string>();
  const postMessage = jest.fn();
  let tick = () => {};
  const window = { top: undefined as unknown, currentChild: { id: user.curChildId, name: payload.student.name, school: { schoolName: payload.student.schoolName } }, ReactNativeWebView: { postMessage }, addEventListener: jest.fn() };
  window.top = window;
  const location = { pathname: '/container/container/parent/index/', replace: jest.fn() };
  const environment = { window, location, localStorage: { getItem: (key: string) => local.get(key) }, sessionStorage: { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) }, setInterval: (callback: () => void) => { tick = callback; }, clearInterval: jest.fn() };
  runInNewContext(zhixueLoginScript('fictional-attempt'), environment);
  tick();
  expect(postMessage).not.toHaveBeenCalled();
  expect(location.replace).toHaveBeenCalledTimes(1);
  expect(location.replace).toHaveBeenCalledWith('/activitystudy/web-report/index.html?from=web-container_top#/');
  location.pathname = '/activitystudy/web-report/index.html';
  tick(); tick();
  expect(postMessage).toHaveBeenCalledTimes(1);
  expect(JSON.parse(postMessage.mock.calls[0][0])).toEqual({ kind: 'official-session', attemptId: 'fictional-attempt', payload });
});
it.each(['/login.html', '/mobile_download.html', '/activitystudy/web-report/index.html'])('does not collect a student from %s or reuse a token without a parent snapshot', (pathname) => {
  const postMessage = jest.fn();
  const replace = jest.fn();
  const setItem = jest.fn();
  const window = { top: undefined as unknown, currentChild: { id: user.curChildId, name: payload.student.name }, ReactNativeWebView: { postMessage }, addEventListener: jest.fn() };
  window.top = window;
  runInNewContext(zhixueLoginScript('fictional-attempt'), {
    window, location: { pathname, replace },
    localStorage: { getItem: () => 'fictional-stale-token' },
    sessionStorage: { getItem: () => null, setItem },
    setInterval: jest.fn(), clearInterval: jest.fn(),
  });
  expect(replace).not.toHaveBeenCalled();
  expect(postMessage).not.toHaveBeenCalled();
  expect(setItem).not.toHaveBeenCalled();
});
it('waits for student metadata before automatically continuing from the parent page', () => {
  const replace = jest.fn();
  let tick = () => {};
  const window = { top: undefined as unknown, currentChild: undefined as unknown, addEventListener: jest.fn() };
  window.top = window;
  const setItem = jest.fn();
  runInNewContext(zhixueLoginScript('fictional-attempt'), {
    window, location: { pathname: '/container/container/parent/index/', replace },
    sessionStorage: { setItem }, setInterval: (callback: () => void) => { tick = callback; }, clearInterval: jest.fn(),
  });
  expect(replace).not.toHaveBeenCalled();
  window.currentChild = { id: user.curChildId, name: '' };
  tick();
  expect(replace).not.toHaveBeenCalled();
  window.currentChild = { id: user.curChildId, name: payload.student.name };
  tick(); tick();
  expect(setItem).toHaveBeenCalledWith('magicmirror.zhixue.login.fictional-attempt', JSON.stringify({ id: user.curChildId, name: payload.student.name }));
  expect(replace).toHaveBeenCalledTimes(1);
});
