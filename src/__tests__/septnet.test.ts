import { ecb, gcm } from '@noble/ciphers/aes.js';
import {
  base64ToBytes, bytesToBase64, bytesToUtf8, createSeptnetProvider, numericScore,
  platformResponseKey, rsaEncryptPkcs1, utf8ToBytes,
} from '@/src/providers/septnet';
import type { AuthSession, ExamResult } from '@/src/domain/models';
import { providerRegistry } from '@/src/providers/registry';

/** 固定模式的伪随机源：让测试能推算出 Provider 本次使用的会话密钥。 */
const testRandom = (size: number) => Uint8Array.from({ length: size }, (_, i) => ((i * 11 + 5) % 255) + 1);
const sessionKey = testRandom(32);

const toHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

/** 模式 A：`data.bn` + `data.content`，用会话密钥 GCM。 */
function sealed(payload: unknown, key = sessionKey) {
  const nonce = Uint8Array.from({ length: 12 }, (_, i) => i + 1);
  const ciphertext = gcm(key, nonce).encrypt(utf8ToBytes(JSON.stringify(payload)));
  return { status: 200, message: 'success', data: { bn: bytesToBase64(nonce), content: bytesToBase64(ciphertext) } };
}

/** 模式 B：`data.isEncrypt` + `data.content`，用平台内置静态密钥 ECB/PKCS7（noble 自带填充）。 */
function obfuscated(payload: unknown) {
  const content = bytesToBase64(ecb(platformResponseKey).encrypt(utf8ToBytes(JSON.stringify(payload))));
  return { status: 200, message: 'success', data: { isEncrypt: true, content } };
}

function setup(bodies: unknown[], options: { status?: number; cookie?: string } = {}) {
  const transport = jest.fn(async () => ({
    status: options.status ?? 200,
    headers: { get: (name: string) => (name === 'set-cookie' ? options.cookie : null) },
    json: async () => bodies.shift(),
  }) as unknown as Response);
  return { provider: createSeptnetProvider({ transport, random: testRandom }), transport };
}

const examList = {
  total: 0,
  startIndex: 8,
  list: [
    { examGuid: 'EXAM-0001-AAAA', examName: '虚构考试', time: '2026-05-27', type: '周测', authView: 0 },
    { examGuid: 'EXAM-0002-AAAA', examName: '虚构考试（待认领）', time: '2026-05-20', authView: 2 },
  ],
};
const subjects = {
  exam_info: { studentCount: '512', queryTime: '2026/05/27 10:27:08', kmCount: 2, isUnion: false },
  list: [
    { km: '总分', code: -2, codeDesc: '总分科目', responseGuid: '' },
    { km: '语文', code: 0, codeDesc: '考试科目', responseGuid: 'GUID-1',
      ai_essay_report: { isCallEssayReport: 1, essayThInfo: { score: '40', full: '60', avg: '38.5', max: '56' } } },
    { km: '数学', code: -1, codeDesc: '科目不可用' },
  ],
};
const report = {
  km_info: { score: '238', fullScore: '300' },
  km_list: [
    { km: '语文', kmTag: 0, score: '118', fullScore: '150', grade: 'A2', rating: '优' },
    { km: '总分', kmTag: -2, score: '238', fullScore: '300', grade: 'A2', rating: '优' },
  ],
};

describe('Septnet 加密层（自造向量，无网络）', () => {
  it('base64 与 UTF-8 往返（含中文）', () => {
    expect(bytesToBase64(utf8ToBytes('hello'))).toBe('aGVsbG8=');
    expect(bytesToUtf8(base64ToBytes('aGVsbG8='))).toBe('hello');
    const text = '总分=语文；km=数学';
    expect(bytesToUtf8(base64ToBytes(bytesToBase64(utf8ToBytes(text))))).toBe(text);
  });

  it('RSA-1024 PKCS#1 v1.5 公钥加密给出已知答案', () => {
    // EM = 00 02 || 01..51 || 00 || 'A'×44，期望值由独立的大整数实现离线算出。
    const expected = '64b4b3be4e29d8432c1657d037f200334b0aacdca9df5d0d1b6b4edcda3a0ada'
      + 'eb8473b7e7e106692e5df431ba58d170d1d769a5d609e003675b86ee204933'
      + 'd7567300902d6e048c85904d35e08a0630caa8450300faa7ad2b3025772603c3'
      + 'c430b95c4cff6ce93b73e72f0552642088ad3f9d1b33628272db71f2797e511820';
    const message = utf8ToBytes('A'.repeat(44));
    const padding = (size: number) => Uint8Array.from({ length: size }, (_, i) => i + 1);
    expect(toHex(rsaEncryptPkcs1(message, padding))).toBe(expected);
  });

});

describe('Septnet Provider（无网络）', () => {
  it.each([true, false, undefined])('列表补取联考属性 %s，未返回时不猜测，待认领考试不发附加请求', async (isUnion) => {
    const session: AuthSession = { providerId: 'septnet', accountId: 'fictional', accessToken: 'TEST_TOKEN_0123456789',
      providerContext: { schoolGuid: 'SCHOOL-GUID-0001', grade: 'a10' } };
    const { provider, transport } = setup([obfuscated(examList), sealed({ ...subjects, exam_info: { isUnion } })]);
    const exams = await provider.getExamList(session);
    expect(exams[0].isUnion).toBe(isUnion);
    expect(exams[1].isUnion).toBeUndefined();
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('列表附加属性不可用仍返回考试，登录失效仍抛出', async () => {
    const session: AuthSession = { providerId: 'septnet', accountId: 'fictional', accessToken: 'TEST_TOKEN_0123456789',
      providerContext: { schoolGuid: 'SCHOOL-GUID-0001', grade: 'a10' } };
    const denied = setup([obfuscated(examList), { status: 405 }]);
    expect(await denied.provider.getExamList(session)).toHaveLength(2);
    const expired = setup([obfuscated(examList), { status: 401 }]);
    await expect(expired.provider.getExamList(session)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  it('跑通登录/资料/列表/成绩/注销全链路', async () => {
    const profileBody = sealed({ schoolGuid: 'SCHOOL-GUID-0001', grade: 'a10', currentGrade: 'a10',
      ruCode: 'FICTIONAL-RU-CODE', studentGuid: 'STUDENT-GUID-0001', nickName: '虚构昵称', schoolName: '虚构学校' });
    const { provider, transport } = setup([
      { status: 200, message: 'success', data: { token: 'TEST_TOKEN_0123456789' } },
      { status: 200, message: 'success' },
      profileBody,                       // authenticate 内部获取上下文
      profileBody,                       // getProfile
      obfuscated(examList),              // getExamList
      sealed(subjects),                  // 列表联考属性
      obfuscated(examList),              // getExamResult → findExam
      sealed({ config: { CloseCF: false }, charge: { ShowPosition: false } }),
      sealed(subjects),
      sealed(report),   // ScoreReport(km=总分) 返回全部行
    ], { cookie: 'aliyungf_tc=FICTIONAL; Path=/; HttpOnly' });

    const auth = await provider.authenticate('fictional-account', 'fictional-password');
    expect(auth.providerContext).toEqual({
      schoolGuid: 'SCHOOL-GUID-0001', grade: 'a10', ruCode: 'FICTIONAL-RU-CODE', wafCookie: 'aliyungf_tc=FICTIONAL',
    });
    expect(await provider.getProfile(auth)).toEqual({
      id: 'STUDENT-GUID-0001', displayName: '虚构昵称', schoolName: '虚构学校', grade: 'a10',
    });
    expect(await provider.getExamList(auth)).toEqual([
      { id: 'EXAM-0001-AAAA', name: '虚构考试', date: '2026-05-27', category: '周测', hasResult: true, isUnion: false },
      { id: 'EXAM-0002-AAAA', name: '虚构考试（待认领）', date: '2026-05-20', category: '其它', hasResult: false },
    ]);
    const result = await provider.getExamResult(auth, 'EXAM-0001-AAAA');
    expect(result).toMatchObject({
      examId: 'EXAM-0001-AAAA', examName: '虚构考试', totalScore: 238, maxTotalScore: 300,
      participantCount: 512, publishedAt: '2026-05-27 10:27:08', ranking: undefined,
      subjects: [{ subject: '语文', score: 118, maxScore: 150, grade: 'A2', providerContext: { essayAvg: '38.5', essayMax: '56', gradePercentile: '1-3%' } }],
    });
    expect(result.subjects).toHaveLength(1); // code === -1 的数学被丢弃

    const calls = transport.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toContain('/login');
    expect(decodeURIComponent(String(calls[0][1].body))).toMatch(/^userCode=fictional-account&password=/);
    const password = String(calls[0][1].body).split('password=')[1];
    expect(bytesToUtf8(base64ToBytes(decodeURIComponent(password)))).toMatch(/^fictional-password.{10,}$/);
    // 加密请求：Carries bk/bn/bp，且 body 为空 JSON。
    const encrypted = calls.filter(([, init]) => init.method === 'POST' && init.body === '{}');
    expect(encrypted).toHaveLength(5);   // 密钥协商 + 列表 Subjects + Config + Subjects + ScoreReport(km=总分)
    for (const [, init] of encrypted) {
      const headers = init.headers as Record<string, string>;
      expect(headers.bk).toHaveLength(172);
      expect(headers.Token).toBe('TEST_TOKEN_0123456789');
    }
    expect(calls[1][0]).toContain('/user');           // 密钥协商（失败可忽略）
    // 上下文（含 WAF cookie）在 authenticate 之后写入，故此后每个请求都带着它。
    const cookieHeader = (calls[3][1].headers as Record<string, string>).Cookie;
    expect(cookieHeader).toBe('aliyungf_tc=FICTIONAL');

    await provider.logout(auth);
    await expect(provider.getProfile(auth)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  it.each([
    ['A1', '前1%'], ['A2', '1-3%'], ['A3', '3-6%'], ['A4', '6-10%'], ['A5', '10-15%'],
    ['B1', '15-21%'], ['B2', '21-28%'], ['B3', '28-36%'], ['B4', '36-43%'], ['B5', '43-50%'],
    ['C1', '50-56%'], ['C2', '56-64%'], ['C3', '64-71%'], ['C4', '71-78%'], ['C5', '78-84%'],
    ['D1', '84-89%'], ['D2', '89-93%'], ['D3', '93-96%'], ['D4', '96-98%'], ['D5', '98-99%'],
    ['E', '99-100%'], [' c4 ', '71-78%'], ['-', undefined], ['未知', undefined],
  ])('等第 %s 对应百分比 %s，未知等第不推算', async (grade, percentile) => {
    const session: AuthSession = { providerId: 'septnet', accountId: 'fictional', accessToken: 'TEST_TOKEN_0123456789',
      providerContext: { schoolGuid: 'SCHOOL-GUID-0001', grade: 'a10' } };
    const { provider } = setup([
      obfuscated(examList), sealed({ charge: {} }), sealed({ list: [{ km: '语文', code: 0 }] }),
      sealed({ km_list: [{ km: '语文', score: '118', fullScore: 150, grade, rating: '良' }] }),
    ]);
    const result = await provider.getExamResult(session, 'EXAM-0001-AAAA');
    expect(result.subjects[0].providerContext?.gradePercentile).toBe(percentile);
    expect(result.subjects[0].grade).toBe(percentile ? grade!.trim().toUpperCase() : '良');
    expect(result.ranking).toBeUndefined();
  });

  it.each([false, true])('兼容数字科目满分与总分满分（数字总分：%s）', async (numericTotal) => {
    const session: AuthSession = { providerId: 'septnet', accountId: 'fictional', accessToken: 'TEST_TOKEN_0123456789',
      providerContext: { schoolGuid: 'SCHOOL-GUID-0001', grade: 'a10' } };
    const { provider } = setup([
      obfuscated(examList),
      sealed({ config: { CloseCF: false }, charge: { ShowPosition: false } }),
      sealed(subjects),
      sealed({
        km_info: { score: '238', fullScore: numericTotal ? 300 : '300' },
        km_list: [
          { ...report.km_list[0], fullScore: 150 },
          { ...report.km_list[1], fullScore: numericTotal ? 300 : '300' },
        ],
      }),
    ]);
    const result = await provider.getExamResult(session, 'EXAM-0001-AAAA');
    expect(result.totalScore).toBe(238);
    expect(result.maxTotalScore).toBe(300);
    expect(result.subjects).toMatchObject([{ subject: '语文', score: 118, maxScore: 150 }]);
  });

  it.each([{ isFu: 1 }, { fuTag: true }])('赋分标记 %j：总分及单科以赋分展示并保留原始分', async (flag) => {
    const session: AuthSession = { providerId: 'septnet', accountId: 'fictional', accessToken: 'TEST_TOKEN_0123456789',
      providerContext: { schoolGuid: 'SCHOOL-GUID-0001', grade: 'a10' } };
    const { provider } = setup([
      obfuscated(examList),
      sealed({ config: { CloseCF: false }, charge: { ShowPosition: false } }),
      sealed({ list: [{ km: '化学', code: 0 }, { km: '地理', code: 0 }] }),
      sealed({ km_list: [
        { km: '化学', score: '20', fullScore: 100, fuScore: '65', fuFullScore: 100, ...flag },
        { km: '地理', score: '0', fullScore: 100, fuScore: '0', fuFullScore: '100', ...flag },
        { km: '总分', score: '20', fullScore: '200', fuScore: '65', fuFullScore: '200', ...flag },
      ] }),
    ]);
    expect(await provider.getExamResult(session, 'EXAM-0001-AAAA')).toMatchObject({
      totalScore: 65, originalTotalScore: 20, maxTotalScore: 200,
      subjects: [
        { subject: '化学', score: 65, maxScore: 100, providerContext: { originalScore: '20', scaledScore: '65' } },
        { subject: '地理', score: 0, maxScore: 100, providerContext: { originalScore: '0', scaledScore: '0' } },
      ],
    });
  });

  it.each([
    { isFu: 0, fuTag: false, fuScore: '0' },
    { isFu: 1, fuTag: true, fuScore: '-' },
    { isFu: 1, fuTag: true, fuScore: '-1' },
  ])('无有效赋分 %j 时保留原始分，不伪造赋分', async (fields) => {
    const session: AuthSession = { providerId: 'septnet', accountId: 'fictional', accessToken: 'TEST_TOKEN_0123456789',
      providerContext: { schoolGuid: 'SCHOOL-GUID-0001', grade: 'a10' } };
    const { provider } = setup([
      obfuscated(examList), sealed({ charge: {} }), sealed(subjects),
      sealed({ km_list: report.km_list.map((row) => ({ ...row, ...fields })) }),
    ]);
    const result = await provider.getExamResult(session, 'EXAM-0001-AAAA');
    expect(result.totalScore).toBe(238);
    expect(result.originalTotalScore).toBeUndefined();
    expect(result.subjects[0].score).toBe(118);
    expect(result.subjects[0].providerContext?.scaledScore).toBeUndefined();
  });

  it('仅明确缺考才标记状态，缺考没有成绩行也保留，且不补取不可用科目', async () => {
    const session: AuthSession = { providerId: 'septnet', accountId: 'fictional', accessToken: 'TEST_TOKEN_0123456789',
      providerContext: { schoolGuid: 'SCHOOL-GUID-0001', grade: 'a10' } };
    const { provider, transport } = setup([
      obfuscated(examList), sealed({ charge: {} }),
      sealed({ list: [
        { km: '生物', code: -1, codeDesc: '缺考科目' },
        { km: '政治', code: -1, codeDesc: '缺考科目' },
        { km: '历史', code: -1, codeDesc: '缺考科目' },
        { km: '数学', code: -1, codeDesc: '科目不可用' },
      ] }),
      sealed({ km_list: [
        { km: '生物', score: '缺考', fullScore: 100, grade: 'C4', isFu: 0, fuScore: '0' },
        { km: '历史', score: '缺考', fullScore: 100, grade: '-' },
        { km: '数学', score: '', fullScore: 100 },
      ] }),
    ]);
    const result = await provider.getExamResult(session, 'EXAM-0001-AAAA');
    for (const name of ['生物', '政治', '历史']) {
      expect(result.subjects.find((item) => item.subject === name)).toMatchObject({ status: 'absent', score: undefined, grade: undefined });
      expect(result.subjects.find((item) => item.subject === name)?.providerContext?.gradePercentile).toBeUndefined();
    }
    expect(result.subjects.find((item) => item.subject === '数学')?.status).toBeUndefined();
    expect(transport.mock.calls).toHaveLength(4);
  });

  it('总分行响应缺少科目行时逐科目兜底补取', async () => {
    const session: AuthSession = { providerId: 'septnet', accountId: 'fictional', accessToken: 'TEST_TOKEN_0123456789',
      providerContext: { schoolGuid: 'SCHOOL-GUID-0001', grade: 'a10' } };
    const totalOnly = { km_info: { score: '238', fullScore: '300' }, km_list: [
      { km: '总分', kmTag: -2, score: '238', fullScore: '300', grade: 'A2', rating: '优' }] };
    const { provider, transport } = setup([
      obfuscated(examList),
      sealed({ config: { CloseCF: false }, charge: { ShowPosition: false } }),
      sealed(subjects),
      sealed(totalOnly),                                   // km=总分 只给了总分行
      sealed({ km_info: { score: '118', fullScore: '150' }, km_list: [report.km_list[0]] }),  // 兜底补取
    ]);
    const result = await provider.getExamResult(session, 'EXAM-0001-AAAA');
    expect(result.totalScore).toBe(238);
    expect(result.participantCount).toBe(512);
    expect(result.subjects).toEqual([
      { subject: '语文', score: 118, maxScore: 150, grade: 'A2', providerContext: {
        essayAvg: '38.5', essayMax: '56', gradePercentile: '1-3%', responseGuid: 'GUID-1', rating: '优', hasEssayInfo: 'true',
        essay_score: '40', essay_full: '60', essay_avg: '38.5', essay_max: '56',
      } },
    ]);
    const calls = transport.mock.calls as unknown as [string, RequestInit][];
    expect(calls.filter(([url]) => url.includes('ScoreReport'))).toHaveLength(2);
  });

  it('答题卡：按科目取扫描件，跳过无 responseGuid 的行', async () => {
    const session: AuthSession = { providerId: 'septnet', accountId: 'fictional', accessToken: 'TEST_TOKEN_0123456789',
      providerContext: { schoolGuid: 'SCHOOL-GUID-0001', grade: 'a10', ruCode: 'FICTIONAL-RU-CODE' } };
    const { provider, transport } = setup([
      sealed(subjects),   // 总分(code -2，无 responseGuid) / 语文(code 0) / 数学(code -1)
      sealed({ answerUrls: ['https://static.example.invalid/fictional/answer-1.png'], isWatermark: true }),
    ]);
    expect(await provider.getAnswerSheets!(session, 'EXAM-0001-AAAA', '语文')).toEqual([
      { subject: '语文', url: 'https://static.example.invalid/fictional/answer-1.png', watermarked: true },
    ]);
    const calls = transport.mock.calls as unknown as [string, RequestInit][];
    const card = calls.find(([url]) => url.includes('AnswerCardUrl'))!;
    expect(card[0]).toContain('AnswerCardUrl');
    // 请求参数经 GCM 加密进 bp，因此只断言头与调用次数：总分/不可用科目不应发起请求
    expect(calls.filter(([url]) => url.includes('AnswerCardUrl'))).toHaveLength(1);
    expect((card[1].headers as Record<string, string>).bk).toHaveLength(172);
  });

  it('水印答题卡：与无水印版独立取回且标记为 watermarked', async () => {
    const session: AuthSession = { providerId: 'septnet', accountId: 'fictional', accessToken: 'TEST_TOKEN_0123456789',
      providerContext: { schoolGuid: 'SCHOOL-GUID-0001', grade: 'a10', ruCode: 'FICTIONAL-RU-CODE' } };
    const { provider, transport } = setup([
      sealed(subjects),
      sealed({ answerUrls: ['https://static.example.invalid/fictional/answer-marked-1.png'], isWatermark: true }),
    ]);
    expect(await provider.getWatermarkedAnswerSheets!(session, 'EXAM-0001-AAAA', '语文')).toEqual([
      { subject: '语文', url: 'https://static.example.invalid/fictional/answer-marked-1.png', watermarked: true },
    ]);
    const calls = transport.mock.calls as unknown as [string, RequestInit][];
    expect(calls.filter(([url]) => url.includes('AnswerCardUrl'))).toHaveLength(1);
  });

  it('authView >= 1 的考试按要求拒绝并提示官方 App', async () => {
    const session: AuthSession = { providerId: 'septnet', accountId: 'fictional', accessToken: 'TEST_TOKEN_0123456789',
      providerContext: { schoolGuid: 'SCHOOL-GUID-0001', grade: 'a10' } };
    const { provider } = setup([obfuscated(examList)]);
    await expect(provider.getExamResult(session, 'EXAM-0002-AAAA')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('成绩查询会按平台返回的下一页偏移查找较早考试', async () => {
    const session: AuthSession = { providerId: 'septnet', accountId: 'fictional', accessToken: 'TEST_TOKEN_0123456789',
      providerContext: { schoolGuid: 'SCHOOL-GUID-0001', grade: 'a10' } };
    const firstPage = Array.from({ length: 8 }, (_, index) => ({ ...examList.list[0], examGuid: `EXAM-PAGE-${index.toString().padStart(2, '0')}` }));
    const secondPage = { startIndex: 16, list: [{ ...examList.list[0], examGuid: 'EXAM-OLD-AAAA', examName: '较早考试' }] };
    const { provider, transport } = setup([obfuscated({ startIndex: 8, list: firstPage }), obfuscated(secondPage)]);
    await expect(provider.getExamResult(session, 'EXAM-OLD-AAAA')).rejects.toMatchObject({ code: 'UNKNOWN' });
    const urls = (transport.mock.calls as unknown as [string, RequestInit][]).map(([url]) => url);
    expect(urls).toEqual(expect.arrayContaining(['https://szone-score.7net.cc/exam/getClaimExams?startIndex=0&rows=8&schoolGuid=SCHOOL-GUID-0001&grade=a10', 'https://szone-score.7net.cc/exam/getClaimExams?startIndex=8&rows=8&schoolGuid=SCHOOL-GUID-0001&grade=a10']));
  });

  it('缺少学校/年级上下文时要求重新登录', async () => {
    const session: AuthSession = { providerId: 'septnet', accountId: 'fictional', accessToken: 'TEST_TOKEN_0123456789' };
    const { provider, transport } = setup([]);
    await expect(provider.getExamList(session)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('不把平台错误原文或密文透给调用方', async () => {
    const session: AuthSession = { providerId: 'septnet', accountId: 'fictional', accessToken: 'TEST_TOKEN_0123456789',
      providerContext: { schoolGuid: 'SCHOOL-GUID-0001', grade: 'a10' } };
    const cases: unknown[] = [
      { status: 404, message: '未认领~', data: null },
      { status: '500', message: 'System.Security.Cryptography.CryptographicException', data: null },
      { status: 4033, message: '参数校验失败！', data: null },
    ];
    for (const body of cases) {
      const { provider } = setup([body]);
      try {
        await provider.getExamList(session);
        throw new Error('expected failure');
      } catch (error) {
        expect(error).toHaveProperty('name', 'ProviderError');
        const text = String(error);
        expect(text).not.toContain('未认领~');
        expect(text).not.toContain('CryptographicException');
        expect(text).not.toContain('参数校验');
      }
    }
  });

  it('响应被篡改时报错且不回显密文', async () => {
    const session: AuthSession = { providerId: 'septnet', accountId: 'fictional', accessToken: 'TEST_TOKEN_0123456789',
      providerContext: { schoolGuid: 'SCHOOL-GUID-0001', grade: 'a10' } };
    const tampered = sealed(examList);
    const data = tampered.data as { bn: string; content: string };
    const bytes = base64ToBytes(data.content);
    bytes[bytes.length - 1] ^= 0xff;
    data.content = bytesToBase64(bytes);
    const { provider } = setup([tampered]);
    await expect(provider.getExamList(session)).rejects.toMatchObject({ code: 'UNKNOWN' });
  });

  it.each([403, 429, 451])('HTTP %s 不重试', async (status) => {
    const session: AuthSession = { providerId: 'septnet', accountId: 'fictional', accessToken: 'TEST_TOKEN_0123456789',
      providerContext: { schoolGuid: 'SCHOOL-GUID-0001', grade: 'a10' } };
    const { provider, transport } = setup([], { status });
    await expect(provider.getExamList(session)).rejects.toHaveProperty('name', 'ProviderError');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('分数字符串解析保守：非数字一律视为缺失', () => {
    expect(numericScore('118')).toBe(118);
    expect(numericScore('118.5')).toBe(118.5);
    expect(numericScore('0')).toBe(0);
    expect(numericScore('')).toBeUndefined();
    expect(numericScore('优')).toBeUndefined();
    expect(numericScore(undefined)).toBeUndefined();
  });

  it('注册进 Provider 注册表且能力如实（不提供排名）', () => {
    const found = providerRegistry.get('septnet');
    expect(found?.metadata.name).toBe('七天学堂');
    expect(found?.capabilities).toEqual({ profile: true, exams: true, results: true, ranking: false, subjectDetails: true, answerSheets: true });
  });

  const detailSession: AuthSession = { providerId: 'septnet', accountId: 'fictional', accessToken: 'TEST_TOKEN_0123456789',
    providerContext: { schoolGuid: 'SCHOOL-GUID-0001', grade: 'a10', ruCode: 'FICTIONAL-RU-CODE' } };
  const cachedResult: ExamResult = { examId: 'EXAM-0001-AAAA', examName: '虚构考试', subjects: [{ subject: '语文', score: 90, maxScore: 150,
    grade: 'B2', providerContext: { rating: '良', ruleHash: 'FICTIONAL-HASH', responseGuid: 'GUID-1', srcKm: '语文原卷',
      hasEssayInfo: 'true', essayAvg: '20' } }] };

  it('科目详情按真实科目参数获取作文和分布，不伪造本人答案', async () => {
    const { provider, transport } = setup([
      sealed({ essayThInfo: { score: '0', full: '60', avg: '35.5', max: '55', diff: '55', highCount: '500' } }),
      sealed([{ th: '2', sort: 2, distri: [{ key: '零分', value: '0.12' }] },
        { th: '1', sort: 1, distri: [{ key: 'A', value: '0.25' }, { key: 'B', value: '0' }] }]),
    ]);
    const detail = await provider.getSubjectDetail!(detailSession, cachedResult.examId, '语文', cachedResult);
    expect(detail.score).toBe(90);
    expect(detail.questions).toBeUndefined();
    expect(detail.providerContext?.essayAvg).toBeUndefined();
    expect(detail.reportSections?.find(s => s.id === 'septnet-subject-info')).toBeUndefined();
    expect(detail.reportSections?.find(s => s.id === 'septnet-essay')?.highlights).toEqual(expect.arrayContaining([
      { label: '个人得分', value: '0', unit: '分' }, { label: '满分', value: '60', unit: '分' },
      { label: '更高分人数', value: '500', unit: '人' }, { label: '距最高分', value: '55', unit: '分' },
    ]));
    expect(detail.reportSections?.some(s => s.title === '考试小结')).toBe(false);
    expect(detail.reportSections?.find(s => s.id === 'septnet-distribution')?.distributions).toEqual([
      { id: 'options', title: '选项分布', layout: 'options', questions: [{ label: '第 1 题', bins: [{ label: 'A', value: '0.25%', percent: 0.25 }, { label: 'B', value: '0%', percent: 0 }] }] },
      { id: 'scores', title: '得分区间分布', layout: 'bars', questions: [{ label: '第 2 题', bins: [{ label: '零分', value: '0.12%', percent: 0.12 }] }] },
    ]);
    const calls = transport.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url]) => url.split('/').at(-1))).toEqual(['ThScoreInfo', 'SubjectTHDistri']);
    const h = calls[1][1].headers as Record<string, string>;
    const params = bytesToUtf8(gcm(sessionKey, base64ToBytes(h.bn)).decrypt(base64ToBytes(h.bp)));
    expect(params).toContain('srcKm=语文原卷');
    expect(params).toContain('responseGuid=GUID-1');
    expect(params).toContain('ruleHash=FICTIONAL-HASH');
    expect(params).not.toMatch(/isVip|ShowWrong/);
  });

  it('附加报告被拒绝或结构无效不阻断科目成绩，且不回显原始响应', async () => {
    const { provider } = setup([{ status: 405, message: 'PRIVATE_RESPONSE' }, sealed({ invalid: 'PRIVATE_RESPONSE' })]);
    const detail = await provider.getSubjectDetail!(detailSession, cachedResult.examId, '语文', cachedResult);
    expect(detail.score).toBe(90);
    expect(detail.reportSections?.find(s => s.id === 'septnet-extra-status')?.notes).toHaveLength(2);
    expect(JSON.stringify(detail.reportSections)).not.toContain('PRIVATE_RESPONSE');
  });

  it('附加报告发现登录失效时不吞掉统一会话错误', async () => {
    const { provider } = setup([{ status: 401 }, sealed([])]);
    await expect(provider.getSubjectDetail!(detailSession, cachedResult.examId, '语文', cachedResult)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  it('总分字段保留等级、完整发布时间与联考属性，不再请求或返回小结和考试信息', async () => {
    const { provider, transport } = setup([
      obfuscated(examList), sealed({ config: { ShowQuanKe_DanKeSummary: true }, charge: {} }),
      sealed({ ...subjects, exam_info: { ...subjects.exam_info, isUnion: true }, list: [{ ...subjects.list[0], summary: { conclusion: '虚构摘要' } }, subjects.list[1]] }),
      sealed({ ...report, other: { totalSubjects: '语文+数学', fuTotalSubjects: '语文+数学', tips: '虚构提示' } }),
    ]);
    const result = await provider.getExamResult(detailSession, 'EXAM-0001-AAAA');
    expect(result).toMatchObject({ grade: 'A2', gradePercentile: '1-3%', publishedAt: '2026-05-27 10:27:08', isUnion: true });
    expect(result.reportSections).toBeUndefined();
    const calls = transport.mock.calls as unknown as [string, RequestInit][];
    expect(calls.some(([url]) => url.endsWith('/Conclusion'))).toBe(false);
  });
});
