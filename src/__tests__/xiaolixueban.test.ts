import { createXiaolixuebanProvider } from '@/src/providers/xiaolixueban';
import type { AuthSession } from '@/src/domain/models';
import { providerRegistry } from '@/src/providers/registry';

// 全部为虚构数据（结构与真实响应一致），不含任何真实账号、学生或成绩。

const portalUserId = '1001';
const portalToken = 'portal-token-fixture';
const studentUserID = '2001';
const reportStudentId = '5001';

const loginBody = {
  code: 0,
  status: 'success',
  result: { userList: [{ userID: portalUserId, accesstoken: portalToken, identity: 'parent' }] },
};
const childerBody = {
  code: 0,
  status: 'success',
  result: {
    studentUsers: [
      {
        studentUserID,
        studentName: '测试学生',
        schoolID: 9001,
        schoolName: '示例中学',
        gradeID: 301,
        gradeName: '高三',
        classID: 401,
        className: '1班',
        regionID: 350000,
      },
      {
        studentUserID: '2002',
        studentName: '测试学生二',
        schoolID: 9001,
        schoolName: '示例中学',
        gradeID: 301,
        gradeName: '高三',
        classID: 402,
        className: '2班',
        regionID: 350000,
      },
    ],
  },
};
const ticketBody = { code: 0, status: 'success', result: 'ticket-fixture' };
const ssoBody = {
  status: 0,
  message: '成功',
  data: { dongniLoginToken: 'report-token-fixture', relativeId: '7001' },
};
const roleBody = {
  status: 0,
  message: '成功',
  data: [
    {
      userList: [
        {
          userId: '3001',
          relativeId: reportStudentId,
          parentStudentId: '7001',
          schoolId: 9001,
          classId: 401,
          gradeId: 301,
          studentName: '测试学生',
          schoolName: '示例中学',
          gradeName: '高三',
          className: '1班',
          membershipStatus: 0,
          userType: 5,
        },
      ],
    },
  ],
};

const startDate = Date.parse('2026-10-14T00:00:00+08:00');
const examListBody = {
  status: 0,
  data: {
    totalCount: 21,
    exam: [
      {
        examId: 111,
        examName: '示例月考一',
        startDate,
        endDate: startDate,
        examTypeName: '常规考试',
        stat: {
          statId: 0,
          resultStatus: 0,
          scoreChange: true,
          totalScore: 455,
          originalScore: 404.5,
          fullMark: '740.0000',
        },
      },
      {
        examId: 112,
        examName: '示例月考二',
        startDate: startDate - 86_400_000,
        examTypeName: '区域考试',
        stat: { statId: 0, resultStatus: 2 },
      },
    ],
  },
};

const statViewsBody = {
  status: 0,
  data: [{ statId: 10, statName: '示例类赋分(全体生)', statStatus: 1 }],
};
const examInfoBody = {
  status: 0,
  data: { examId: 111, examName: '示例区域考试', examStatus: 3, examType: 10 },
};
const courseInfoBody = {
  status: 0,
  data: [
    { courseId: 2, courseName: '语文', paperId: 'P2' },
    { courseId: 5, courseName: '物理', paperId: 'P5' },
  ],
};
const displayBody = {
  status: 0,
  data: {
    gradeRankingStatus: 1,
    classRankingStatus: 1,
    gradeNumStatus: 1,
    areaRankingStatus: 1,
    areaNumStatus: 1,
    scoreStatus: { scoreAndRanking: 1 },
    classAverageScoreStatus: { scoreAndRanking: 1 },
    schoolAverageScoreStatus: { scoreAndRanking: 1 },
    scoreSection: 0,
  },
};
const weixinBody = {
  status: 0,
  data: { weixinFull: { courseScoreRate: 1, courseBeatRate: 1 }, weixinSingle: {} },
};
const rankInfoBody = {
  status: 0,
  data: {
    originalVolumeStatus: 1,
    scoreRanking: [
      {
        totalScore: 455,
        fullMark: '740.0000',
        examRanking: 54,
        classRanking: 7,
        ranking: 9662,
        examRankNumber: 2100,
        schoolRankNumber: 330,
        classRankNumber: 50,
        schoolAverageScore: '408.0351',
        classAverageScore: '407.4778',
      },
      {
        courseId: 2,
        courseName: '语文',
        totalScore: 105,
        fullMark: '150',
        examRanking: 9,
        classRanking: 3,
        examRankNumber: 2000,
        schoolRankNumber: 330,
        classRankNumber: 50,
        schoolAverageScore: '90.5000',
        classAverageScore: '94.5000',
      },
    ],
  },
};
const baseIndexBody = {
  status: 0,
  data: [{ averageScore: '444.5825', participationNumber: 2100 }],
};
const levelBody = { status: 0, data: { list: [{ examId: 111, statId: 10, consistName: 'B+' }] } };
const beatBody = {
  status: 0,
  data: [
    {
      examId: 111,
      totalStudent: 330,
      totalBeatRate: '0.83987915',
      courseBeatRateList: [
        { courseId: 2, courseName: '语文', courseBeatRate: '0.96676737' },
        { courseId: 5, courseName: '物理', courseBeatRate: '0.66000000' },
      ],
    },
  ],
};
const scoreRateBody = {
  status: 0,
  data: {
    studentScoreRate: [{ courseId: 2, scoreRate: '0.70000000' }],
    scoreRate: [{ courseId: 2, averageRate: '0.63065359' }],
  },
};

const paperQuestionRoster = {
  status: 0,
  data: {
    student: [
      {
        studentId: '9999',
        studentName: '其他同学',
        courseName: '物理',
        totalScore: 99,
        questions: [{ questionNumber: 1, scoreValue: 4, finallyScore: 4 }],
      },
      {
        studentId: reportStudentId,
        studentName: '测试学生',
        courseName: '物理',
        totalScore: 5,
        questions: [
          { questionNumber: 1, scoreValue: 4, finallyScore: 4, structureNumber: '1' },
          { questionNumber: 2, scoreValue: 6, finallyScore: 1, structureNumber: '2' },
        ],
      },
    ],
  },
};

function response(body: unknown, init: { status?: number; setCookie?: string[] } = {}) {
  return {
    status: init.status ?? 200,
    headers: {
      get: () => null,
      getSetCookie: () => init.setCookie ?? [],
      entries: () => [],
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

interface Route {
  match: string;
  body?: unknown;
  status?: number;
  setCookie?: string[];
}

function setup(routes: Route[]) {
  const transport = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const route = routes.find((candidate) => url.includes(candidate.match));
    if (!route) throw new Error(`unexpected url: ${url}`);
    return response(route.body, { status: route.status, setCookie: route.setCookie });
  });
  return {
    provider: createXiaolixuebanProvider({ transport, pollIntervalMs: 0 }),
    transport,
  };
}

const loginRoutes = (extra: Route[] = []): Route[] => [
  ...extra,
  {
    match: '/loginserv/login/login',
    body: loginBody,
    setCookie: ['loginToken=portal-cookie; Path=/'],
  },
  { match: '/nicezhuanye/parent/getChilder', body: childerBody },
  { match: '/ssoLogin/getTicket', body: ticketBody },
  { match: '/api/base/data/system/auth/sso', body: ssoBody },
  { match: '/api/base/data/account/role', body: roleBody },
];

const freshSession = (): AuthSession => ({
  providerId: 'xiaolixueban',
  accountId: '13800000000',
  accessToken: 'report-token-fixture',
  providerContext: {
    portalUserId,
    portalToken,
    portalCookie: 'loginToken=portal-cookie',
    studentUserID,
    studentId: reportStudentId,
    reportUserId: '3001',
    schoolId: '9001',
    classId: '401',
    gradeId: '301',
    studentName: '测试学生',
    membershipStatus: '0',
  },
});

describe('小力学伴 Provider（无网络，虚构数据）', () => {
  it('登录：手机号通道、收集门户 Cookie、换票后写入报告学生上下文', async () => {
    const { provider, transport } = setup(loginRoutes());
    const session = await provider.authenticate(' 13800000000 ', 'fake-password');

    expect(session.providerId).toBe('xiaolixueban');
    expect(session.accountId).toBe('13800000000');
    expect(session.accessToken).toBe('report-token-fixture');
    expect(session.providerContext).toMatchObject({
      portalUserId,
      portalToken,
      portalCookie: 'loginToken=portal-cookie',
      studentUserID,
      studentId: reportStudentId,
      reportUserId: '3001',
      schoolId: '9001',
      classId: '401',
      gradeId: '301',
      studentName: '测试学生',
    });

    const calls = transport.mock.calls as unknown as [string, RequestInit][];
    const login = calls.find((call) => call[0].includes('/loginserv/login/login'))!;
    expect(JSON.parse(String(login[1].body))).toEqual({
      parameter: { cellphone: '13800000000', pwd: 'fake-password', saveCookie: true },
    });
    const childer = calls.find((call) => call[0].includes('getChilder'))!;
    const childerHeaders = childer[1].headers as Record<string, string>;
    expect(childerHeaders['hqjl-user']).toBe(portalUserId);
    expect(childerHeaders['hqjl-token']).toBe(portalToken);
    expect(childerHeaders.Cookie).toContain('loginToken=portal-cookie');
    const sso = calls.find((call) => call[0].includes('/auth/sso'))!;
    expect(JSON.parse(String(sso[1].body))).toMatchObject({
      ticket: 'ticket-fixture',
      clientType: 1,
    });
  });

  it('登录失败映射为凭据错误，并保留平台提示', async () => {
    const { provider } = setup([
      {
        match: '/loginserv/login/login',
        body: { code: -1, status: 'fail', errorMessage: '用户名或密码错误' },
      },
    ]);
    await expect(provider.authenticate('13800000000', 'bad')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: '用户名或密码错误',
    });
  });

  it('空账号或空密码直接拒绝，不发请求', async () => {
    const { provider, transport } = setup([]);
    await expect(provider.authenticate('  ', 'x')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    await expect(provider.authenticate('13800000000', '')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it('门户返回 911 视为会话失效', async () => {
    const { provider } = setup([
      ...loginRoutes().filter((route) => !route.match.includes('getChilder')),
      { match: '/nicezhuanye/parent/getChilder', status: 911 },
    ]);
    await expect(provider.authenticate('13800000000', 'password')).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
  });

  it('学生列表标记当前学生，切换学生后重建报告会话', async () => {
    const { provider } = setup(loginRoutes());
    const session = freshSession();
    const profiles = await provider.getProfiles!(session);
    expect(profiles.map((profile) => profile.id)).toEqual([studentUserID, '2002']);
    expect(profiles[0].selected).toBe(true);
    expect(profiles[1].selected).toBeUndefined();

    const switched = await provider.selectProfile!(session, '2002');
    expect(switched.providerContext?.studentUserID).toBe('2002');
    expect(switched.providerContext?.studentName).toBe('测试学生二');
    expect(switched.accessToken).toBe('report-token-fixture');
  });

  it('考试列表：分页参数、日期与考试性质', async () => {
    const { provider, transport } = setup([
      ...loginRoutes(),
      { match: '/api/exam/plan/student/all', body: examListBody },
    ]);
    const exams = await provider.getExamList(freshSession());
    expect(exams).toEqual([
      { id: '111', name: '示例月考一', date: '2026-10-14', category: '常规考试', hasResult: true },
      { id: '112', name: '示例月考二', date: '2026-10-13', category: '区域考试' },
    ]);
    const calls = transport.mock.calls as unknown as [string, RequestInit][];
    const list = calls.find((call) => call[0].includes('/api/exam/plan/student/all'))!;
    const url = new URL(list[0]);
    expect(url.searchParams.get('pageNo')).toBe('1');
    expect(url.searchParams.get('pageSize')).toBe('20');
    expect(url.searchParams.get('examType')).toBe('2,3,4,5,7,9,10');
    expect(url.searchParams.get('studentId')).toBe(reportStudentId);
    expect(url.searchParams.get('schoolId')).toBe('9001');

    await provider.getExamList(freshSession(), { offset: 20 });
    const second = (transport.mock.calls as unknown as [string, RequestInit][])
      .filter((call) => call[0].includes('/api/exam/plan/student/all'))
      .at(-1)!;
    expect(new URL(second[0]).searchParams.get('pageNo')).toBe('2');
  });

  it('报告令牌失效（业务 10051）映射为会话过期', async () => {
    const { provider } = setup([
      ...loginRoutes(),
      { match: '/api/exam/plan/student/all', body: { status: 10051, message: '登录已过期' } },
    ]);
    await expect(provider.getExamList(freshSession())).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
  });

  it('区域考试：总分、单科、班级/年级排名、等级与统计', async () => {
    const { provider, transport } = setup([
      ...loginRoutes(),
      { match: '/api/exam/plan/student/all', body: examListBody },
      { match: '/weChat/all/schoolExamStat', body: statViewsBody },
      { match: '/weChat/info', body: examInfoBody },
      { match: '/weChat/courseInfo', body: courseInfoBody },
      { match: '/api/exam/display/student/get', body: displayBody },
      { match: '/api/exam/display/weixinDisplay', body: weixinBody },
      { match: '/weChat/scoreRankInfo', body: rankInfoBody },
      { match: '/api/analysis/view/monitor/exam/stat/baseIndex', body: baseIndexBody },
      { match: '/weChat/scoreLevel', body: levelBody },
      { match: '/weChat/beatRate', body: beatBody },
      { match: '/api/analysis/data/monitor/exam/student/scoreRate', body: scoreRateBody },
    ]);
    const result = await provider.getExamResult(freshSession(), '111');

    // 平台要求 statId；缺失时联考均分会静默丢失，只剩人数。
    const calls = transport.mock.calls as unknown as [string, RequestInit][];
    const baseIndex = calls.find((call) => call[0].includes('/stat/baseIndex'))!;
    expect(new URL(baseIndex[0]).searchParams.get('statId')).toBe('10');

    expect(result.examName).toBe('示例区域考试');
    expect(result.reports).toEqual([{ id: '10', name: '示例类赋分(全体生)' }]);
    expect(result.totalScore).toBe(455);
    // 原始分只在赋分考试的列表 stat 上（官方文案“我的得分”），赋分为主分数。
    expect(result.originalTotalScore).toBe(404.5);
    expect(result.maxTotalScore).toBe(740);
    expect(result.isUnion).toBe(true);
    // 排名卡片已经显示人数，不再单独下发“考生人数”。
    expect(result.participantCount).toBeUndefined();
    expect(result.grade).toBe('B+');
    expect(result.rankings).toEqual([
      { rank: 7, total: 50, scope: 'class', label: '班级排名' },
      { rank: 54, total: 330, scope: 'grade', label: '年级排名' },
      { rank: 9662, total: 2100, scope: 'group', label: '联考排名' },
    ]);
    expect(result.statistics).toEqual([
      { scope: '班级', averageScore: 407.48 },
      { scope: '年级', averageScore: 408.04 },
      { scope: '联考', averageScore: 444.58 },
    ]);
    // 学校击败率不再随排名卡片下发。
    expect(result.defeatRates).toBeUndefined();
    // “示例类赋分(全体生)”不是单科报告，不能当成“语文/物理”单科分数。
    expect(result.subjects).toHaveLength(1);
    expect(result.subjects[0]).toMatchObject({
      id: '10:2',
      subject: '语文',
      score: 105,
      maxScore: 150,
    });
    // 学科强弱得分率以雷达图展示。
    expect(result.reportSections?.map((section) => section.id)).toEqual([
      'xiaolixueban-score-rate',
    ]);
    expect(result.reportSections?.[0].radar).toEqual({
      scale: { min: 0, max: 100 },
      axes: ['语文'],
      series: [
        { label: '本人', values: [70] },
        { label: '学校平均', values: [63.1] },
      ],
    });
  });

  it('单场考试按报告列表切换，并使用所选报告 statId', async () => {
    const { provider, transport } = setup([
      ...loginRoutes(),
      {
        match: '/api/exam/plan/student/all',
        body: examListBody,
      },
      {
        match: '/weChat/all/schoolExamStat',
        body: {
          status: 0,
          data: [
            { statId: 10, statName: '报告一', statStatus: 1 },
            { statId: 11, statName: '报告二', statStatus: 1 },
          ],
        },
      },
      { match: '/weChat/info', body: examInfoBody },
      { match: '/weChat/courseInfo', body: courseInfoBody },
      { match: '/api/exam/display/student/get', body: displayBody },
      { match: '/api/exam/display/weixinDisplay', body: weixinBody },
      { match: '/weChat/scoreRankInfo', body: rankInfoBody },
      { match: '/api/analysis/view/monitor/exam/stat/baseIndex', body: baseIndexBody },
      { match: '/weChat/scoreLevel', body: levelBody },
      { match: '/weChat/beatRate', body: beatBody },
      { match: '/api/analysis/data/monitor/exam/student/scoreRate', body: scoreRateBody },
    ]);
    const result = await provider.getExamResult(freshSession(), '111', { reportId: '11' });
    const calls = transport.mock.calls as unknown as [string, RequestInit][];
    const baseIndex = calls.find((call) => call[0].includes('/stat/baseIndex'))!;
    expect(new URL(baseIndex[0]).searchParams.get('statId')).toBe('11');
    expect(result.reports).toEqual([
      { id: '10', name: '报告一' },
      { id: '11', name: '报告二' },
    ]);
  });

  it('联考均分缺失时不生成只有人数的联考卡片', async () => {
    const { provider } = setup([
      ...loginRoutes(),
      { match: '/weChat/all/schoolExamStat', body: statViewsBody },
      { match: '/weChat/info', body: examInfoBody },
      { match: '/weChat/courseInfo', body: courseInfoBody },
      { match: '/api/exam/display/student/get', body: displayBody },
      { match: '/api/exam/display/weixinDisplay', body: { status: 0, data: {} } },
      { match: '/weChat/scoreRankInfo', body: rankInfoBody },
      {
        match: '/api/analysis/view/monitor/exam/stat/baseIndex',
        body: { status: 0, data: [{ schoolId: 9001, averageScore: '408.5000' }] },
      },
      { match: '/weChat/scoreLevel', body: levelBody },
      { match: '/weChat/beatRate', body: beatBody },
      {
        match: '/api/analysis/data/monitor/exam/student/scoreRate',
        body: { status: 0, data: {} },
      },
    ]);
    const result = await provider.getExamResult(freshSession(), '111');
    expect(result.statistics?.map((stat) => stat.scope)).toEqual(['班级', '年级']);
  });

  it('显示开关关闭分数时仍按实际数据下发总分', async () => {
    const { provider } = setup([
      ...loginRoutes(),
      { match: '/api/exam/plan/student/all', body: examListBody },
      { match: '/weChat/all/schoolExamStat', body: statViewsBody },
      { match: '/weChat/info', body: examInfoBody },
      { match: '/weChat/courseInfo', body: courseInfoBody },
      {
        match: '/api/exam/display/student/get',
        body: { status: 0, data: { scoreStatus: { scoreAndRanking: 0 } } },
      },
      { match: '/api/exam/display/weixinDisplay', body: weixinBody },
      { match: '/weChat/scoreRankInfo', body: rankInfoBody },
      { match: '/weChat/scoreLevel', body: levelBody },
      { match: '/weChat/beatRate', body: beatBody },
      { match: '/api/analysis/data/monitor/exam/student/scoreRate', body: scoreRateBody },
    ]);
    const result = await provider.getExamResult(freshSession(), '111');
    expect(result.totalScore).toBe(455);
    expect(result.maxTotalScore).toBe(740);
    expect(result.originalTotalScore).toBe(404.5);
    expect(result.subjects[0].score).toBe(105);
  });

  it('只剩年级排名时也走 rankings（不落到会显示“联考”的 ranking 字段）', async () => {
    const { provider } = setup([
      ...loginRoutes(),
      { match: '/weChat/all/schoolExamStat', body: statViewsBody },
      { match: '/weChat/info', body: examInfoBody },
      { match: '/weChat/courseInfo', body: courseInfoBody },
      {
        match: '/api/exam/display/student/get',
        body: {
          status: 0,
          data: {
            gradeRankingStatus: 1,
            classRankingStatus: 0,
            gradeNumStatus: 0,
            areaRankingStatus: 0,
            scoreStatus: { scoreAndRanking: 1 },
          },
        },
      },
      { match: '/api/exam/display/weixinDisplay', body: { status: 0, data: {} } },
      { match: '/weChat/scoreRankInfo', body: rankInfoBody },
      { match: '/weChat/scoreLevel', body: levelBody },
      { match: '/weChat/beatRate', body: beatBody },
      {
        match: '/api/analysis/data/monitor/exam/student/scoreRate',
        body: { status: 0, data: {} },
      },
    ]);
    const result = await provider.getExamResult(freshSession(), '111');
    expect(result.ranking).toBeUndefined();
    expect(result.rankings).toEqual([
      { rank: 7, total: 50, scope: 'class', label: '班级排名' },
      { rank: 54, total: 330, scope: 'grade', label: '年级排名' },
      { rank: 9662, total: 2100, scope: 'group', label: '联考排名' },
    ]);
  });

  it('校内科考试：分数取自该科报告视图（statName → courseId）', async () => {
    const { provider } = setup([
      ...loginRoutes(),
      {
        // 非赋分考试：列表 stat 只有发布状态，没有赋分/原始分字段。
        match: '/api/exam/plan/student/all',
        body: {
          status: 0,
          data: {
            totalCount: 1,
            exam: [
              {
                examId: 111,
                examName: '示例校考',
                startDate,
                examTypeName: '常规考试',
                stat: { statId: 0, resultStatus: 0 },
              },
            ],
          },
        },
      },
      {
        match: '/weChat/all/schoolExamStat',
        body: {
          status: 0,
          data: [
            { statId: 0, statName: '原始报告', statStatus: 1 },
            { statId: 2, statName: '物理(全体)', statStatus: 1 },
          ],
        },
      },
      {
        match: '/weChat/info',
        body: { status: 0, data: { examId: 111, examName: '示例校考', examType: 2 } },
      },
      { match: '/weChat/courseInfo', body: courseInfoBody },
      { match: '/api/exam/display/student/get', body: { status: 0, data: { scoreSection: 1 } } },
      { match: '/api/exam/display/weixinDisplay', body: { status: 0, data: {} } },
      { match: '/weChat/scoreRankInfo', body: { status: 0, data: { originalVolumeStatus: 1 } } },
      { match: '/weChat/scoreLevel', body: { status: 0, data: { list: [] } } },
      { match: '/weChat/beatRate', body: { status: 0, data: [] } },
      {
        match: '/api/analysis/data/monitor/exam/student/scoreRate',
        body: { status: 0, data: {} },
      },
      {
        match: '/api/analysis/view/monitor/exam/school/scoreSection',
        body: {
          status: 0,
          data: {
            fullMark: '20',
            totalStudent: 30,
            participationNumber: 25,
            totalScore: 10,
            scoreSection: [
              { open: '20', close: null, total: 0, cumulative: 0, ratio: 0 },
              { open: '15', close: '20', total: 2, cumulative: 2, ratio: 0.08 },
              { open: '10', close: '15', total: 3, cumulative: 5, ratio: 0.2 },
              { open: '0', close: '10', total: 20, cumulative: 25, ratio: 0.8 },
            ],
          },
        },
      },
      {
        match: '/api/analysis/view/monitor/exam/class/scoreSection',
        body: {
          status: 0,
          data: [
            {
              classId: '401',
              fullMark: '20',
              totalStudent: 6,
              participationNumber: 5,
              totalScore: 10,
              scoreSection: [
                { open: '20', close: null, total: 0, cumulative: 0, ratio: 0 },
                { open: '15', close: '20', total: 1, cumulative: 1, ratio: 0.2 },
                { open: '10', close: '15', total: 2, cumulative: 3, ratio: 0.4 },
                { open: '0', close: '10', total: 2, cumulative: 5, ratio: 0.4 },
              ],
            },
          ],
        },
      },
      { match: '/weChat/paper/question', body: paperQuestionRoster },
    ]);
    const result = await provider.getExamResult(freshSession(), '111');
    // 分数段接口自带本人总分，官方口径优先于“各科合计”，因此不再提示推导来源。
    expect(result.totalScore).toBe(10);
    expect(result.maxTotalScore).toBe(20);
    expect(result.notice).toBeUndefined();
    // 非赋分考试没有原始分口径，不能凭空生成。
    expect(result.originalTotalScore).toBeUndefined();
    // 官方没有班级/年级排名，按分数段累计人数估算区间名次，并带人数。
    expect(result.rankings).toEqual([
      { rank: 2, rankMax: 3, total: 5, scope: 'class', label: '预估班级排名', estimate: true },
      { rank: 3, rankMax: 5, total: 25, scope: 'grade', label: '预估年级排名', estimate: true },
    ]);
    // 只有“物理(全体)”有单科报告；语文没有报告视图，用逐题接口补出分数（按课程顺序排列）。
    expect(result.subjects).toEqual([
      {
        id: '0:2',
        subject: '语文',
        score: 5,
        maxScore: 10,
        providerContext: { statId: '0', courseId: '2', paperId: 'P2' },
      },
      {
        id: '2:5',
        subject: '物理',
        score: 5,
        maxScore: 10,
        providerContext: { statId: '2', courseId: '5', paperId: 'P5' },
      },
    ]);
    const distribution = result.reportSections?.find(
      (section) => section.id === 'xiaolixueban-score-distribution',
    );
    expect(distribution?.distributions?.map((group) => group.title)).toEqual([
      '班级分数分布',
      '学校分数分布',
    ]);
    expect(distribution?.distributions?.every((group) => group.layout === 'bars')).toBe(true);
    expect(
      distribution?.distributions?.every((group) =>
        group.questions[0].bins.some((bin) => bin.highlight),
      ),
    ).toBe(true);
    expect(distribution?.notes).toBeUndefined();
  });

  it('单科详情：只取本人一条、题型/区间与逐题答案（得分取 error/analysis）', async () => {
    const { provider, transport } = setup([
      ...loginRoutes(),
      { match: '/weChat/courseInfo', body: courseInfoBody },
      {
        match: '/weChat/result/question/analysis',
        body: {
          status: 0,
          data: {
            // 区域赋分考试的该接口逐题 finallyScore 全为 0，不能当真实得分。
            question: [
              {
                questionNumber: 1,
                structureNumber: '1',
                scoreValue: 4,
                finallyScore: 0,
                recognitionValue: 'D',
                isObjective: true,
                questionTypeName: '选择题',
              },
              {
                questionNumber: 2,
                structureNumber: '2',
                scoreValue: 6,
                finallyScore: 0,
                isObjective: false,
                questionTypeName: '解答题',
              },
            ],
          },
        },
      },
      {
        match: '/weChat/paper/questionType',
        body: {
          status: 0,
          data: {
            student: [
              {
                studentId: reportStudentId,
                questionType: [
                  {
                    questionTypeName: '选择题',
                    finallyScore: '4.0000',
                    scoreValue: '4.0000',
                    scoreRate: '1.00000000',
                    correctRate: 0.5,
                  },
                ],
              },
            ],
          },
        },
      },
      {
        match: 'school/course/scoreSection',
        body: {
          status: 0,
          data: [
            {
              courseId: 5,
              fullMark: '10',
              participationNumber: 40,
              scoreSection: [
                { open: '8', close: '10', total: 10, ratio: 0.25 },
                { open: '0', close: '8', total: 30, ratio: 0.75 },
              ],
            },
          ],
        },
      },
      {
        match: 'school/course/scoreRate',
        body: {
          status: 0,
          data: [
            {
              courseId: 5,
              averageScore: '5.5000',
              highestScore: '10',
              participationNumber: 40,
              passRate: '0.50000000',
              excellentRate: '0.10000000',
            },
          ],
        },
      },
      {
        match: '/weChat/scoreRankInfo',
        body: {
          status: 0,
          data: {
            scoreRanking: [
              {
                courseId: 5,
                totalScore: 5,
                fullMark: '10',
                examRanking: 9,
                classRanking: 3,
                ranking: 1234,
                examRankNumber: 4000,
                schoolRankNumber: 100,
                classRankNumber: 50,
                schoolAverageScore: '5.5000',
                classAverageScore: '6.0000',
              },
            ],
          },
        },
      },
      {
        match: '/api/analysis/view/monitor/exam/stat/baseIndex',
        body: {
          status: 0,
          data: [
            {
              averageScore: '444.5825',
              participationNumber: 4000,
              course: [{ courseId: 5, averageScore: '43.8640', participationNumber: 3900 }],
            },
            {
              schoolId: 9001,
              averageScore: '408.5000',
              course: [{ courseId: 5, averageScore: '41.0000' }],
            },
          ],
        },
      },
      { match: '/weChat/beatRate', body: beatBody },
      {
        match: 'question/error/analysis',
        body: {
          status: 0,
          data: [
            {
              questionNumber: 1,
              structureNumber: '1',
              scoreValue: 4,
              finallyScore: 4,
              recognitionValue: 'D',
              correctAnswer: 'C',
            },
            { questionNumber: 2, structureNumber: '2', scoreValue: 6, finallyScore: 1 },
          ],
        },
      },
      { match: '/weChat/paper/question', body: paperQuestionRoster },
      {
        match: '/api/exam/display/student/get',
        body: { ...displayBody, data: { ...displayBody.data, scoreSection: 1 } },
      },
    ]);
    const detail = await provider.getSubjectDetail!(freshSession(), '111', '2:5');

    // 逐题得分接口要求 paperId，缺失时平台返回空数据。
    const calls = transport.mock.calls as unknown as [string, RequestInit][];
    const call = calls.find((item) => item[0].includes('question/error/analysis'))!;
    expect(new URL(call[0]).searchParams.get('paperId')).toBe('P5');

    expect(detail.score).toBe(5);
    expect(detail.maxScore).toBe(10);
    expect(detail.questions).toEqual([
      {
        id: '1',
        label: '1',
        score: 4,
        maxScore: 4,
        kind: 'objective',
        myAnswer: 'D',
        answer: 'C',
      },
      { id: '2', label: '2', score: 1, maxScore: 6, kind: 'subjective' },
    ]);
    expect(detail.questionScoreSummaries).toEqual([
      { kind: 'objective', score: 4, maxScore: 4 },
      { kind: 'subjective', score: 1, maxScore: 6, inferred: true },
    ]);
    // 班级在前、学校在后，联考（区域）补充均分与排名。
    expect(detail.statistics).toEqual([
      { scope: '班级', averageScore: 6, rank: 3, participantCount: 50 },
      { scope: '年级', averageScore: 5.5, rank: 9, participantCount: 100 },
      { scope: '联考', averageScore: 43.86, rank: 1234, participantCount: 4000 },
    ]);
    // 学校击败率与题型分析卡片已移除，只保留分数区间。
    expect(detail.defeatRates).toBeUndefined();
    expect(detail.reportSections?.map((section) => section.id)).toEqual([
      'xiaolixueban-score-section',
    ]);
    expect(detail.reportSections?.[0].items).toBeUndefined();
    expect(detail.reportSections?.[0].distributions?.[0].layout).toBe('bars');
    expect(detail.reportSections?.[0].distributions?.[0].questions[0].bins).toContainEqual(
      expect.objectContaining({ highlight: true }),
    );
  });

  it('单科详情在整班数据中找不到本人时拒绝，不回退到其他同学', async () => {
    const { provider } = setup([
      ...loginRoutes(),
      { match: '/weChat/courseInfo', body: courseInfoBody },
      {
        match: '/weChat/paper/question',
        body: {
          status: 0,
          data: { student: [{ studentId: '9999', courseName: '物理', totalScore: 99 }] },
        },
      },
    ]);
    await expect(provider.getSubjectDetail!(freshSession(), '111', '2:5')).rejects.toMatchObject({
      code: 'RESTRICTED',
    });
  });

  it('答题卡：按页码排序并拼 CDN 地址；学生不一致时拒绝', async () => {
    const routes: Route[] = [
      ...loginRoutes(),
      { match: '/weChat/courseInfo', body: courseInfoBody },
      {
        match: '/api/exam/answerCard/view/student/async',
        body: { status: 0, data: { uuid: 'task-1' } },
      },
      {
        match: '/api/common/my/async',
        body: {
          status: 0,
          data: {
            status: 40,
            data: {
              studentInfo: { studentId: reportStudentId },
              answerCardList: [
                { pageNumber: 2, filePath: 'upload/card-b.jpg' },
                {
                  pageNumber: 1,
                  filePath: 'upload/card-a.jpg',
                  originFilePath: 'upload/raw-a.png',
                },
              ],
            },
          },
        },
      },
    ];
    const { provider } = setup(routes);
    const sheets = await provider.getAnswerSheets!(freshSession(), '111', '2:5');
    expect(sheets.map((sheet) => sheet.url)).toEqual([
      'https://cdn.dongni100.com/upload/card-a.jpg',
      'https://cdn.dongni100.com/upload/card-b.jpg',
    ]);
    expect(sheets.every((sheet) => !sheet.watermarked)).toBe(true);

    const mismatch = setup(
      routes.map((route) =>
        route.match === '/api/common/my/async'
          ? {
              ...route,
              body: {
                status: 0,
                data: {
                  status: 40,
                  data: {
                    studentInfo: { studentId: '9999' },
                    answerCardList: [{ pageNumber: 1, filePath: 'upload/other.jpg' }],
                  },
                },
              },
            }
          : route,
      ),
    );
    await expect(
      mismatch.provider.getAnswerSheets!(freshSession(), '111', '2:5'),
    ).rejects.toMatchObject({ code: 'RESTRICTED' });
  });

  it('注销撤销本地会话并调用官方注销接口', async () => {
    const { provider, transport } = setup([
      ...loginRoutes(),
      { match: '/api/base/data/logout', body: { status: 0, data: null } },
    ]);
    const session = freshSession();
    await provider.logout(session);
    expect(transport).toHaveBeenCalledWith(
      'https://m.nicezhuanye.com/api/base/data/logout',
      expect.objectContaining({ method: 'POST' }),
    );
    await expect(provider.getProfiles!(session)).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
  });

  it('已注册到平台列表', () => {
    expect(providerRegistry.get('xiaolixueban')?.metadata.name).toBe('小力学伴');
  });
});
