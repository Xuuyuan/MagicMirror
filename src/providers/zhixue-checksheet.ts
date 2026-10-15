import { z } from 'zod';
import type { AnswerSheet, QuestionScore } from '../domain/models';
import { ProviderError } from '../domain/models';
import { numericScore, parseValidated } from './codec';

const metric = z.union([z.number().finite(), z.string()]).nullish();
const topicNumber = z.union([z.number().int().positive(), z.string().min(1)]);
// Official subtopic identifiers may be negative sentinel integers; they are not scores.
const subTopicIndex = z.union([z.number().int(), z.string()]);
const subTopicSchema = z.object({ subTopicIndex: subTopicIndex.optional(), score: metric });
const topicSchema = z.object({
  topicNumber: topicNumber.optional(), dispTitle: z.union([z.string(), z.number()]).nullish(), score: metric, standardScore: metric,
  isCandidate: z.boolean().optional(), isSelected: z.boolean().optional(), subTopics: z.array(subTopicSchema).max(1000).optional(),
  answerType: z.string().nullish(), answer: z.string().nullish(),
});
const sheetDataSchema = z.object({
  userAnswerRecordDTO: z.object({ answerRecordDetails: z.array(topicSchema).max(10000) }),
  answerSheetLocationDTO: z.unknown().optional(),
});
const locationSchema = z.object({ pageSheets: z.array(z.object({ sections: z.array(z.unknown()).nullish() })).max(1000) });
const sectionSchema = z.object({
  type: z.string(), contents: z.object({ branch: z.array(z.object({
    ixList: z.array(z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/)])).max(10000),
  })).max(1000) }),
});
const cutBlockSchema = z.array(z.object({ topicNumber, cutBlocks: z.array(z.object({
  subTopicIndex, subTopicScore: metric,
  dispTopic: z.union([z.string(), z.number()]).nullish(),
})).max(1000) })).max(10000);
const responseSchema = z.object({
  sheetDatas: z.unknown().optional(), sheetImages: z.unknown().optional(), cutBlockDetail: z.unknown().optional(),
  showSingleTopicScore: z.boolean().optional(), examType: z.string().optional(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown, section: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  // Schema-owned field names/types only; never include response values or Zod's raw message.
  const path = issue.path.map(String).join('.') || 'root';
  const expected = issue.code === 'invalid_type' ? issue.expected : issue.code;
  throw new ProviderError('UNKNOWN', `智学网答题卡格式已变化（${section}.${path}，${expected}），请稍后重试`);
}
function json(value: unknown, section: string): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { throw new ProviderError('UNKNOWN', `智学网答题卡格式已变化（${section}，JSON），请稍后重试`); }
}
function score(value: z.infer<typeof metric>): number | undefined {
  return typeof value === 'number' ? value >= 0 ? value : undefined : numericScore(value ?? undefined);
}

function questionKinds(location: unknown): Map<number, QuestionScore['kind']> {
  const kinds = new Map<number, QuestionScore['kind']>();
  const parsed = locationSchema.safeParse(location);
  if (!parsed.success) return kinds;
  for (const page of parsed.data.pageSheets) {
    for (const raw of page.sections ?? []) {
      const section = sectionSchema.safeParse(raw);
      if (!section.success) continue;
      let kind: QuestionScore['kind'];
      switch (section.data.type) {
        case 'SingleChoice': case 'MultiChoice': case 'Object': kind = 'objective'; break;
        case 'AnswerQuestion': kind = 'subjective'; break;
        default: continue;
      }
      for (const branch of section.data.contents.branch) {
        for (const position of branch.ixList) {
          // The official client reads answerRecordDetails[ix - 1], not topicNumber == ix.
          const index = Number(position) - 1;
          kinds.set(index, kinds.has(index) && kinds.get(index) !== kind ? undefined : kind);
        }
      }
    }
  }
  return kinds;
}

/** The official checksheet uses JSON strings for images, records and cut blocks. */
export function zhixueQuestions(raw: unknown): { questions: QuestionScore[]; questionNotice?: string } {
  const data = parse(responseSchema, raw, '响应');
  if (data.showSingleTopicScore !== true || data.examType === 'homework_no_scoring') {
    return { questions: [], questionNotice: '智学网未开放本场考试的单题得分，可单独查看已开放的答题卡。' };
  }
  if (data.sheetDatas == null || data.sheetDatas === '') return { questions: [], questionNotice: '智学网暂无逐题得分记录，可单独查看答题卡。' };
  const sheetData = parse(sheetDataSchema, json(data.sheetDatas, 'sheetDatas'), '逐题记录');
  const records = sheetData.userAnswerRecordDTO.answerRecordDetails;
  const kinds = questionKinds(sheetData.answerSheetLocationDTO);
  const blocks = data.cutBlockDetail == null || data.cutBlockDetail === '' ? [] : parse(cutBlockSchema, json(data.cutBlockDetail, 'cutBlockDetail'), '子题');
  const questions: QuestionScore[] = [];
  records.forEach((record, index) => {
    if (record.isCandidate && !record.isSelected) return;
    const id = String(record.topicNumber ?? index + 1);
    const label = String(record.dispTitle ?? id).trim() || id;
    const kind = kinds.get(index) ?? (record.answerType === 's01Text' ? 'objective' : record.answerType === 's02Image' ? 'subjective' : undefined);
    const myAnswer = kind === 'objective' ? optionAnswer(record.answer) : undefined;
    const children = (record.subTopics ?? []).length > 1 ? record.subTopics!.map((sub, subIndex): QuestionScore => {
      const subId = String(sub.subTopicIndex ?? subIndex);
      const block = blocks.find((item) => String(item.topicNumber) === id)?.cutBlocks.find((item) => String(item.subTopicIndex) === subId);
      return { id: `${id}.${subId}`, label: String(block?.dispTopic ?? `${label}(${subIndex + 1})`), score: score(sub.score), maxScore: score(block?.subTopicScore), ...(kind ? { kind } : {}) };
    }) : undefined;
    questions.push({ id, label, score: score(record.score), maxScore: score(record.standardScore), ...(kind ? { kind } : {}), ...(myAnswer ? { myAnswer } : {}), ...(children?.length ? { children } : {}) });
  });
  return { questions, ...(!questions.length ? { questionNotice: '智学网暂无逐题得分记录，可单独查看答题卡。' } : {}) };
}

function optionAnswer(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const text = value.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ').trim().toUpperCase();
  // The official HTML answer may wrap option letters in formatting tags.
  // Do not reinterpret text answers, images, numeric marking scores or missing answers as choices.
  if (!/^[A-H](?:[\s,，、;；]*[A-H])*$/.test(text)) return undefined;
  return [...new Set(text.replace(/[\s,，、;；]/g, ''))].sort().join('');
}
const analysisSchema = z.object({ typeTopicAnalysis: z.array(z.object({ topicAnalysisDTOs: z.array(z.object({
  topicNumber: topicNumber.nullish(), answerType: z.string().nullish(), answerHtml: z.string().nullish(),
  standardAnswer: z.string().nullish(), userAnswer: z.string().nullish(),
})).max(10000) })).max(1000) });

export function zhixueQuestionAnswers(questions: QuestionScore[], raw: unknown): { questions: QuestionScore[]; questionNotice?: string } {
  const analysis = parseValidated(analysisSchema, json(raw, '选择题答案'), '智学网选择题答案格式已变化，暂无法读取正确答案');
  const answers = new Map<string, string | undefined>();
  for (const topic of analysis.typeTopicAnalysis.flatMap((group) => group.topicAnalysisDTOs)) {
    if (topic.topicNumber == null || topic.answerType !== 's01Text') continue;
    const answer = optionAnswer(topic.answerHtml) ?? optionAnswer(topic.standardAnswer);
    if (!answer) continue;
    const id = String(topic.topicNumber);
    answers.set(id, answers.has(id) && answers.get(id) !== answer ? undefined : answer);
  }
  const result = questions.map((question) => {
    const answer = question.kind === 'objective' ? answers.get(question.id) : undefined;
    return answer ? { ...question, answer } : question;
  });
  return { questions: result, ...(result.some((question) => question.kind === 'objective' && !question.answer)
    ? { questionNotice: '智学网未提供部分客观题的正确答案；已显示可用的我的答案。' } : {}) };
}

/** Raw scans only. The website draws score/stroke annotations separately. */
export function zhixueSheets(raw: unknown, subjectId: string, subject: string): AnswerSheet[] {
  const data = parse(responseSchema, raw, '响应');
  if (data.sheetImages == null || data.sheetImages === '') return [];
  const images = parse(z.array(z.string().url()).max(1000), json(data.sheetImages, 'sheetImages'), '图片列表');
  return images.map((value) => {
    const url = new URL(value);
    // Match the official client's HTTP-to-HTTPS upgrade. Never send login headers to image storage.
    if (url.protocol === 'http:') url.protocol = 'https:';
    if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new ProviderError('RESTRICTED', '智学网返回了不支持的答题卡地址');
    return { subject, subjectId, url: url.href, watermarked: false };
  });
}
