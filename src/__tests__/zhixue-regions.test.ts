import { zhixueRegions } from '../providers/zhixue-regions';
import { zhixueQuestionSheets, zhixueQuestions } from '../providers/zhixue-checksheet';

// Fictional template, questions and image addresses only.
const section = (ixList: number[], left = 20, top = 30) => ({ type: 'AnswerQuestion', enabled: true,
  contents: { branch: [{ ixList, position: { left, top, width: 60, height: 80 } }] } });
const layout = () => ({ comeFrom: 0, paperType: 'A3', pageSheets: [
  { pageIndex: 1, sections: [section([1], 20), section([1], 100)] },
  { pageIndex: 0, sections: [section([1]), section([2], 100)] },
] });
const fixture = () => ({ showSingleTopicScore: true,
  sheetImages: JSON.stringify(['https://fictional-storage.example/page-a.jpg', 'https://fictional-storage.example/page-b.jpg']),
  sheetDatas: JSON.stringify({ answerSheetLocationDTO: layout(), userAnswerRecordDTO: { answerRecordDetails: [
    { topicNumber: 41, dispTitle: '虚构作文', answerType: 's02Image', score: 12, standardScore: 20 },
    { topicNumber: 52, dispTitle: '虚构问答', answerType: 's02Image', score: 3, standardScore: 6 },
  ] } }),
});

it('keeps every region of one question across pages, in page and template order', () => {
  const result = zhixueRegions(layout(), 2, 2);
  expect(result.get(0)!.map((r) => r.pageIndex)).toEqual([0, 1, 1]);
  expect(result.get(0)![2].region.x).toBeCloseTo(100 / 420);
  expect(result.get(1)).toHaveLength(1);
  const data = fixture();
  const questions = zhixueQuestions(data).questions;
  expect(questions[0]).toMatchObject({ id: '41', label: '虚构作文', providerContext: { answerImageAvailable: 'true' } });
  const sheets = zhixueQuestionSheets(data, 'fictional-paper', '虚构科目', '41');
  expect(sheets.map((sheet) => sheet.url)).toEqual([
    'https://fictional-storage.example/page-a.jpg', 'https://fictional-storage.example/page-b.jpg', 'https://fictional-storage.example/page-b.jpg',
  ]);
  expect(sheets.every((sheet) => sheet.headers === undefined && sheet.region?.sourceAspectRatio === 420 / 297)).toBe(true);
});

it('deduplicates repeated metadata without merging distinct regions on the same page', () => {
  const value = layout();
  value.pageSheets[0].sections.push(section([1], 20));
  expect(zhixueRegions(value, 2, 2).get(0)).toHaveLength(3);
});

it('does not advertise an incomplete answer when one region is invalid', () => {
  const value = layout();
  value.pageSheets[0].sections[0] = section([1], 410);
  expect(zhixueRegions(value, 2, 2).has(0)).toBe(false);
  expect(zhixueRegions(value, 2, 2).has(1)).toBe(true);
  value.pageSheets[0].sections[0] = section([1, 3]);
  expect(zhixueRegions(value, 2, 2).has(0)).toBe(false);
});

it('opens the complete shared block for each grouped subjective question without guessing individual crops', () => {
  const data = fixture();
  const body = JSON.parse(data.sheetDatas);
  body.userAnswerRecordDTO.answerRecordDetails = [12, 13, 14].map((label, index) => ({ topicNumber: 40 + index, dispTitle: String(label), answerType: 's02Image', score: 2, standardScore: 5 }));
  body.answerSheetLocationDTO.pageSheets = [
    { pageIndex: 0, sections: [section([1, 2, 3])] },
    { pageIndex: 1, sections: [section([1, 2, 3], 100)] },
  ];
  data.sheetDatas = JSON.stringify(body);
  expect(zhixueQuestions(data).questions.map((question) => question.providerContext?.answerImageAvailable)).toEqual([undefined, undefined, 'true']);
  for (const id of ['40', '41']) expect(() => zhixueQuestionSheets(data, 'fictional-paper', '虚构数学', id)).toThrow('暂无此题');
  for (const id of ['42']) {
    const sheets = zhixueQuestionSheets(data, 'fictional-paper', '虚构数学', id);
    expect(sheets).toHaveLength(2);
    expect(sheets[0].subject).toBe('虚构数学 · 第12、13、14题（合并作答区域）');
    expect(sheets[0].region?.width).toBeCloseTo(60 / 420);
    expect(sheets[0].headers).toBeUndefined();
  }
  body.userAnswerRecordDTO.answerRecordDetails[2].isCandidate = true;
  body.userAnswerRecordDTO.answerRecordDetails[2].isSelected = false;
  const unselected = { ...data, sheetDatas: JSON.stringify(body) };
  expect(zhixueQuestions(unselected).questions.map((question) => question.providerContext?.answerImageAvailable)).toEqual([undefined, 'true']);
  body.answerSheetLocationDTO.pageSheets[1].sections[0] = section([1, 2, 3], 410);
  expect(zhixueQuestions({ ...data, sheetDatas: JSON.stringify(body) }).questions.every((question) => !question.providerContext?.answerImageAvailable)).toBe(true);
});

it('does not expose partial regions if a page or a reference cannot be resolved', () => {
  expect(zhixueRegions(layout(), 2, 1).has(0)).toBe(false);
  expect(zhixueRegions({ ...layout(), pageSheets: [{ pageIndex: 0, sections: [section([1]), { $ref: '$.unverified' }] }] }, 2, 2).size).toBe(0);
  expect(zhixueRegions({ ...layout(), comeFrom: 1 }, 2, 2).size).toBe(0);
  expect(zhixueRegions({ ...layout(), paperType: 'unknown' }, 2, 2).size).toBe(0);
});

it('supports verified A4 geometry and preserves existing scores when optional image metadata is missing', () => {
  const result = zhixueRegions({ ...layout(), paperType: 'A4' }, 2, 2);
  expect(result.get(0)![0].region.width).toBeCloseTo(60 / 210);
  const data = { ...fixture(), sheetImages: 'invalid-json' };
  expect(zhixueQuestions(data).questions[0]).toMatchObject({ id: '41', score: 12 });
  expect(zhixueQuestions(data).questions[0].providerContext).toBeUndefined();
  expect(() => zhixueQuestionSheets(data, 'fictional-paper', '虚构科目', '41')).toThrow('暂无此题');
});

it('refuses unknown IDs, optional questions not selected, and unverified child-question crops', () => {
  const data = fixture();
  expect(() => zhixueQuestionSheets(data, 'fictional-paper', '虚构科目', 'not-present')).toThrow('暂无此题');
  expect(() => zhixueQuestionSheets(data, 'fictional-paper', '虚构科目', '41.1')).toThrow('暂无此题');
  const body = JSON.parse(data.sheetDatas);
  body.userAnswerRecordDTO.answerRecordDetails[0].isCandidate = true;
  body.userAnswerRecordDTO.answerRecordDetails[0].isSelected = false;
  expect(() => zhixueQuestionSheets({ ...data, sheetDatas: JSON.stringify(body) }, 'fictional-paper', '虚构科目', '41')).toThrow('暂无此题');
});
