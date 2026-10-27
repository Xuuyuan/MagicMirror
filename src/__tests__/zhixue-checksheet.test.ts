import {
  zhixueQuestionAnswers,
  zhixueQuestions,
  zhixueSheets,
} from '../providers/zhixue-checksheet';

// Invented records following the official web client's checksheet field contract.
const records = [
  { topicNumber: 1, dispTitle: '1', score: 0, standardScore: '4' },
  { topicNumber: 2, dispTitle: '2', score: '--', standardScore: 4 },
  {
    topicNumber: 3,
    dispTitle: '选做题',
    score: 8,
    standardScore: 8,
    isCandidate: true,
    isSelected: false,
  },
  {
    topicNumber: 4,
    dispTitle: '解答题',
    score: 6,
    standardScore: 10,
    isCandidate: true,
    isSelected: true,
    subTopics: [
      { subTopicIndex: 1, score: 0 },
      { subTopicIndex: 2, score: '6' },
    ],
  },
];
const raw = {
  showSingleTopicScore: true,
  sheetDatas: JSON.stringify({ userAnswerRecordDTO: { answerRecordDetails: records } }),
  cutBlockDetail: JSON.stringify([
    {
      topicNumber: 4,
      cutBlocks: [
        { subTopicIndex: 1, subTopicScore: 4, dispTopic: '4(1)' },
        { subTopicIndex: 2, subTopicScore: 6, dispTopic: '4(2)' },
      ],
    },
  ]),
  sheetImages: JSON.stringify([
    'http://fictional-storage.example/page-2.png?signature=fictional',
    'https://fictional-storage.example/page-1.png',
  ]),
};
function classificationData(pages: unknown[][], topics = records) {
  return {
    ...raw,
    sheetDatas: JSON.stringify({
      userAnswerRecordDTO: { answerRecordDetails: topics },
      answerSheetLocationDTO: { pageSheets: pages.map((sections) => ({ sections })) },
    }),
  };
}
function section(type: string, ...ixList: (number | string)[]) {
  return { type, contents: { branch: [{ ixList }] } };
}
it.each(['SingleChoice', 'MultiChoice', 'Object'])(
  'maps official %s sections to objective questions by record position',
  (type) => {
    const topics = records.map((record, index) => ({
      ...record,
      topicNumber: index === 0 ? 42 : record.topicNumber,
    }));
    const questions = zhixueQuestions(classificationData([[section(type, '1')]], topics)).questions;
    expect(questions[0]).toMatchObject({ id: '42', kind: 'objective', score: 0 });
    expect(questions[1].kind).toBeUndefined();
  },
);
it('maps image-answer sections to subjective questions and their subtopics across pages', () => {
  const questions = zhixueQuestions(
    classificationData([
      [section('SingleChoice', 1)],
      [section('AnswerQuestion', 4), section('AnswerQuestion', 4)],
    ]),
  ).questions;
  expect(questions.map((question) => question.kind)).toEqual([
    'objective',
    undefined,
    'subjective',
  ]);
  expect(questions[2].children?.map((question) => question.kind)).toEqual([
    'subjective',
    'subjective',
  ]);
  expect(questions).toHaveLength(3);
});
it('leaves conflicting, unknown and unmatched sections unclassified', () => {
  const questions = zhixueQuestions(
    classificationData([
      [
        section('SingleChoice', 1),
        section('AnswerQuestion', 1),
        section('Object', 1),
        section('fictional-future-type', 2),
        section('SingleChoice', 999),
      ],
    ]),
  ).questions;
  expect(questions.map((question) => question.kind)).toEqual([undefined, undefined, undefined]);
});
it('keeps scores available when optional location metadata is absent or malformed', () => {
  const malformed = {
    ...raw,
    sheetDatas: JSON.stringify({
      userAnswerRecordDTO: { answerRecordDetails: records },
      answerSheetLocationDTO: { pageSheets: 'fictional-invalid' },
    }),
  };
  expect(zhixueQuestions(malformed).questions).toEqual(zhixueQuestions(raw).questions);
  const mixed = classificationData([
    [null, { type: 'Object', contents: null }, section('SingleChoice', 1)],
  ]);
  expect(zhixueQuestions(mixed).questions[0].kind).toBe('objective');
});
it('uses actual record answerType fields when section geometry contains unresolved references', () => {
  const topics = records.map((record, index) => ({
    ...record,
    answerType: index < 2 ? 's01Text' : 's02Image',
    answer: index === 0 ? 'b,a' : '',
  }));
  const data = {
    ...raw,
    sheetDatas: JSON.stringify({
      userAnswerRecordDTO: { answerRecordDetails: topics },
      answerSheetLocationDTO: { pageSheets: [{ sections: [{ $ref: '$.sections[0]' }] }] },
    }),
  };
  const questions = zhixueQuestions(data).questions;
  expect(questions.map((question) => question.kind)).toEqual([
    'objective',
    'objective',
    'subjective',
  ]);
  expect(questions[0].myAnswer).toBe('AB');
  expect(questions[1].myAnswer).toBeUndefined();
  expect(questions[2].children?.map((question) => question.kind)).toEqual([
    'subjective',
    'subjective',
  ]);
});
it('uses AnswerQuestion as subjective and never treats the answerType enum as a section type', () => {
  expect(
    zhixueQuestions(classificationData([[section('AnswerQuestion', 4)]])).questions[2].kind,
  ).toBe('subjective');
  expect(
    zhixueQuestions(classificationData([[section('s02Image', 4)]])).questions[2].kind,
  ).toBeUndefined();
});
it('reads the JSON-string paper-analysis result and associates objective answers by topic number across groups', () => {
  const questions = [
    { id: '1', label: '1', kind: 'objective' as const, myAnswer: 'B' },
    { id: '2', label: '2', kind: 'objective' as const, myAnswer: 'AB' },
    { id: '4', label: '4', kind: 'subjective' as const },
  ];
  const result = zhixueQuestionAnswers(
    questions,
    JSON.stringify({
      typeTopicAnalysis: [
        {
          topicAnalysisDTOs: [
            {
              topicNumber: 2,
              answerType: 's01Text',
              standardAnswer: 'BA',
              answerHtml: '<p>B, A</p>',
            },
          ],
        },
        {
          topicAnalysisDTOs: [
            { topicNumber: '1', answerType: 's01Text', standardAnswer: 'C' },
            {
              topicNumber: 4,
              answerType: 's02Image',
              standardAnswer: 'https://fictional-storage.example/reference.png',
            },
          ],
        },
      ],
    }),
  );
  expect(result.questions).toEqual([
    { ...questions[0], answer: 'C' },
    { ...questions[1], answer: 'AB' },
    questions[2],
  ]);
  expect(result.questionNotice).toBeUndefined();
});
it('does not turn numeric marking scores, images, conflicting answers or missing answers into correct options', () => {
  const questions = [1, 2, 3].map((number) => ({
    id: String(number),
    label: String(number),
    kind: 'objective' as const,
    myAnswer: 'A',
  }));
  const result = zhixueQuestionAnswers(questions, {
    typeTopicAnalysis: [
      {
        topicAnalysisDTOs: [
          { topicNumber: 1, answerType: 's01Text', standardAnswer: '4' },
          {
            topicNumber: 2,
            answerType: 's01Text',
            answerHtml: '<img src="https://fictional-storage.example/reference.png">',
          },
          { topicNumber: 3, answerType: 's01Text', standardAnswer: 'A' },
          { topicNumber: 3, answerType: 's01Text', standardAnswer: 'B' },
        ],
      },
    ],
  });
  expect(result.questions).toEqual(questions);
  expect(result.questionNotice).toContain('未提供部分客观题');
});
it('preserves zero and missing scores, excludes unselected optional topics and keeps subtopics nested', () => {
  const result = zhixueQuestions(raw);
  expect(result.questionNotice).toBeUndefined();
  expect(result.questions).toEqual([
    { id: '1', label: '1', score: 0, maxScore: 4 },
    { id: '2', label: '2', score: undefined, maxScore: 4 },
    {
      id: '4',
      label: '解答题',
      score: 6,
      maxScore: 10,
      children: [
        { id: '4.1', label: '4(1)', score: 0, maxScore: 4 },
        { id: '4.2', label: '4(2)', score: 6, maxScore: 6 },
      ],
    },
  ]);
});
it('keeps page order and signed image queries, upgrades HTTP and never attaches login headers', () => {
  expect(zhixueSheets(raw, 'paper', '虚构科目')).toEqual([
    {
      subjectId: 'paper',
      subject: '虚构科目',
      url: 'https://fictional-storage.example/page-2.png?signature=fictional',
      watermarked: false,
    },
    {
      subjectId: 'paper',
      subject: '虚构科目',
      url: 'https://fictional-storage.example/page-1.png',
      watermarked: false,
    },
  ]);
});
it.each([false, undefined])(
  'does not display records when official single-score visibility is %s',
  (showSingleTopicScore) => {
    expect(zhixueQuestions({ ...raw, showSingleTopicScore }).questions).toEqual([]);
    expect(zhixueQuestions({ ...raw, showSingleTopicScore }).questionNotice).toContain('未开放');
    expect(zhixueSheets({ ...raw, showSingleTopicScore }, 'paper', '虚构科目')).toHaveLength(2);
  },
);
it('does not infer scores for homework without scoring', () => {
  expect(zhixueQuestions({ ...raw, examType: 'homework_no_scoring' }).questions).toEqual([]);
});
it('allows independent image and question resources and valid empty responses', () => {
  expect(zhixueQuestions({ ...raw, sheetImages: 'not-json' }).questions).toHaveLength(3);
  expect(zhixueSheets({ ...raw, sheetDatas: 'not-json' }, 'paper', '虚构科目')).toHaveLength(2);
  expect(zhixueSheets({ sheetImages: '[]' }, 'paper', '虚构科目')).toEqual([]);
  expect(
    zhixueQuestions({
      showSingleTopicScore: true,
      sheetDatas: JSON.stringify({ userAnswerRecordDTO: { answerRecordDetails: [] } }),
    }).questions,
  ).toEqual([]);
});
it('does not invent subtopic full scores from the parent score', () => {
  expect(
    zhixueQuestions({ ...raw, cutBlockDetail: undefined }).questions[2].children?.map(
      (item) => item.maxScore,
    ),
  ).toEqual([undefined, undefined]);
});
it('accepts negative integer subtopic identifiers and matches their cut blocks without allowing negative scores', () => {
  const data = {
    showSingleTopicScore: true,
    sheetDatas: JSON.stringify({
      userAnswerRecordDTO: {
        answerRecordDetails: [
          {
            topicNumber: 11,
            dispTitle: '11',
            score: 3,
            standardScore: 6,
            subTopics: [
              { subTopicIndex: -1, score: 0 },
              { subTopicIndex: 2, score: -1 },
            ],
          },
        ],
      },
    }),
    cutBlockDetail: JSON.stringify([
      {
        topicNumber: 11,
        cutBlocks: [
          { subTopicIndex: -1, dispTopic: '11(1)', subTopicScore: 3 },
          { subTopicIndex: 2, dispTopic: '11(2)', subTopicScore: -1 },
        ],
      },
    ]),
  };
  expect(zhixueQuestions(data).questions[0].children).toEqual([
    { id: '11.-1', label: '11(1)', score: 0, maxScore: 3 },
    { id: '11.2', label: '11(2)', score: undefined, maxScore: undefined },
  ]);
});
it.each([
  'javascript:alert(1)',
  'file:///private.png',
  'https://user:password@fictional-storage.example/a.png',
  'https://fictional-storage.example:444/a.png',
])('rejects unsupported image URI %s', (url) => {
  expect(() => zhixueSheets({ sheetImages: JSON.stringify([url]) }, 'paper', '虚构科目')).toThrow();
});
it('rejects malformed nested JSON without exposing its contents', () => {
  expect(() => zhixueQuestions({ ...raw, sheetDatas: 'fictional-private-value' })).toThrow(
    '智学网答题卡格式已变化',
  );
  expect(() =>
    zhixueSheets({ sheetImages: '{"private":"fictional"}' }, 'paper', '虚构科目'),
  ).toThrow('智学网答题卡格式已变化');
});
it('identifies a failing schema field without exposing the actual response value', () => {
  const invalid = {
    ...raw,
    sheetDatas: JSON.stringify({
      userAnswerRecordDTO: {
        answerRecordDetails: [{ ...records[0], isCandidate: 'fictional-private-value' }],
      },
    }),
  };
  expect(() => zhixueQuestions(invalid)).toThrow(
    '逐题记录.userAnswerRecordDTO.answerRecordDetails.0.isCandidate，boolean',
  );
  try {
    zhixueQuestions(invalid);
  } catch (error) {
    expect((error as Error).message).not.toContain('fictional-private-value');
  }
});
