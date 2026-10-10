// 字段结构来自海豚阅卷学生端真实响应；值已替换为虚构内容，禁止写入账号、Token、姓名或图片直链。
export const haitunSubjectsResponse = {
  errno: 0,
  errmsg: 'ok',
  data: [
    { examId: 9001, subjectId: 0, subjectName: '', score: '200.00', fullScore: null, classRank: 5, gradeRank: 40, beatClass: 60.5, beatGrade: 55.2, beatUnion: null },
    { examId: 9001, subjectId: 8101, subjectName: '数学', score: '120.00', fullScore: 150, classRank: 4, gradeRank: 33, gradeAvgScore: 98.2, classAvgScore: 105.5, beatClass: 70.1, beatGrade: 62.3, beatUnion: null },
  ],
  traceId: 'fixture-trace-subjects',
} as const;

export const haitunInsightResponse = {
  errno: 0,
  errmsg: 'ok',
  data: {
    examId: 9001,
    total: { score: 200, fullScore: 250, classRank: '5', gradeRank: '40', beatClass: 60.5, beatGrade: 55.2 },
    oneLine: '本次总分 200/250 分，物理是最该补的一科。',
    focus: { subjectId: 8102, subjectName: '物理', subjectType: 'OTHER', lostScore: 20, scoreRate: 80, text: '物理是本次提分空间最大的一科。' },
    improvePriority: [{ subjectId: 8102, subjectName: '物理', subjectType: 'OTHER', lostScore: 20, scoreRate: 80 }],
    subjectMap: [{ subjectId: 8101, subjectName: '数学', subjectType: 'OTHER', score: 120, fullScore: 150, scoreRate: 80, lostScore: 30, level: 'risk' }],
  },
  traceId: 'fixture-trace-insight',
} as const;

export const haitunSubjectDetailResponse = {
  errno: 0,
  errmsg: 'ok',
  data: {
    examId: 9001, subjectId: 8101, subjectName: '数学', score: '120.00', fullScore: 150,
    classRank: 4, gradeRank: 33, banji: '3', gradeAvgScore: 98.2, classAvgScore: 105.5,
    beatClass: 70.1, beatGrade: 62.3, beatUnion: null,
    paperBrief: [
      { questionNo: '客观题', tihao: null, score: 60, fullScore: 70, questionType: '1' },
      { questionNo: '主观题', tihao: null, score: 60, fullScore: 80, questionType: '2' },
    ],
  },
  traceId: 'fixture-trace-detail',
} as const;

export const haitunQuestionAnalysisResponse = {
  errno: 0,
  errmsg: 'ok',
  data: [
    { tihao: '1.1', questionNo: '一.1', type: 1, typeName: '单选题', fullScore: 5, myScore: 5, gradeRightRate: 91.55, gradeAvgScore: 4.58, video: '' },
    { tihao: '2.3.1', questionNo: '二.3.1', type: 2, typeName: '主观题', fullScore: 10, myScore: 6, gradeRightRate: 60, gradeAvgScore: 7, video: '' },
  ],
  traceId: 'fixture-trace-question-analysis',
} as const;
