import { z } from 'zod';
export const capabilitiesSchema = z.object({ profile: z.boolean(), exams: z.boolean(), results: z.boolean(), ranking: z.boolean(), subjectDetails: z.boolean().optional(), questionScores: z.boolean().optional(), answerSheets: z.boolean().optional() });
export type ProviderCapabilities = z.infer<typeof capabilitiesSchema>;
export interface StudentProfile { id: string; displayName: string; schoolName?: string; grade?: string; selected?: boolean; providerContext?: Record<string, string>; }
export interface AcademicYear { id: string; label: string; }
export interface ExamSummary { isUnion?: boolean; id: string; name: string; date?: string; /** 考试性质（如「周测」「月考」），平台未给出时由 Provider 兜底为「其它」。 */ category?: string; subjectCount?: number; hasResult?: boolean; availability?: 'unavailable'; }
export interface UnclaimedExam { id: string; name: string; date?: string; studentCodes: string[]; }
export interface ClaimCandidate { studentCode: string; url?: string; }
export interface SearchableExam { id: string; name: string; }
export interface ExamBindingCandidate { examId: string; examName: string; studentId: string; studentCode: string; displayName: string; schoolName: string; className: string; }
export type ExamBindingPreview = { status: 'ready'; candidate: ExamBindingCandidate } | { status: 'already-bound' };
export type ExamBindingResult = { status: 'bound' | 'already-bound' };
export interface SubjectScore { id?: string; subject: string; score?: number; maxScore?: number; grade?: string; /** 平台明确标记缺考时设置；不能由分数缺失推断。 */ status?: 'absent'; providerContext?: Record<string, string>; }
export interface Ranking { rank: number; total?: number; /** 区间排名的上界（如官方下发「1~20」时 rank=1、rankMax=20）；缺省表示精确名次。 */ rankMax?: number; label?: string; scope?: 'class' | 'grade' | 'group'; }
export interface DefeatRate { scope: 'class' | 'grade'; value: number; }
/** Provider 解释的页面级提示：显示在详情页顶部，用户可关闭，关闭状态按 id 记忆。 */
export interface ProviderNotice { id: string; text: string; }
export interface ExamResult { isUnion?: boolean; grade?: string; gradePercentile?: string; defeatRates?: DefeatRate[]; examId: string; examName: string; /** True when the Provider only supplied a generic display name. */ examNameIsFallback?: boolean; subjects: SubjectScore[]; totalScore?: number; originalTotalScore?: number; maxTotalScore?: number; /** 与原始总分同口径的卷面满分。 */ originalMaxTotalScore?: number; /** 参加该场考试的考生人数。 */ participantCount?: number; statistics?: SubjectStatistic[]; /** 页面级提示（如联考等第口径说明）。 */ notice?: ProviderNotice; ranking?: Ranking; rankings?: Ranking[]; publishedAt?: string; reportSections?: ReportSection[]; }
export interface AnswerSheet { subject: string; subjectId?: string; url: string; watermarked: boolean; headers?: Record<string, string>; }
/** 作文：题干全文与本人作答扫描图；平台未提供时 answerSheets 为空数组。 */
export interface EssayDetail { prompt?: string; answerSheets: AnswerSheet[]; }
export interface SubjectStatistic { scope: string; averageScore?: number; participantCount?: number; rank?: number; /** 区间排名上界：与 rank 组成名次范围（如 164~211）。 */ rankMax?: number; /** 估算值：界面在标签上加「（预估）」，表示不是平台下发的精确名次。 */ estimate?: boolean; }
export interface SubjectAnalysisItem { label: string; values: Record<string, string>; scoreBreakdown?: { score?: number; maxScore?: number; grade?: string; benchmarks: { label: string; score: number }[] }; }
/** Provider 已解释字段含义；UI 只负责展示，不识别平台字段。 */
export interface ReportSection { id: string; title: string; /** 分区归属：界面把同一分区的报告卡片并入该功能卡片展示（当前仅 `essay`）；缺省时作为独立报告卡片。 */ placement?: 'essay'; items?: SubjectAnalysisItem[]; distributions?: DistributionGroup[]; notes?: string[]; /** 说明随明细一起展开收起。 */ collapseNotes?: boolean; highlightColumns?: 3; highlights?: { label: string; value: string; unit?: string }[]; comparisonMetric?: '得分率' | '超过比例'; comparisons?: { label: string; series: { label: string; percent: number }[] }[]; }
/** percent 使用 0–100 刻度；无法解释的原值只显示 value，不绘制条形。 */
export interface DistributionGroup { id: string; title: string; layout: 'options' | 'bars'; questions: { label: string; bins: { label: string; value: string; percent?: number }[] }[]; }
export interface QuestionScore { id: string; label: string; score?: number; maxScore?: number; children?: QuestionScore[]; providerContext?: Record<string, string>; /** 题目类型：objective=客观题（带作答与正确答案），subjective=主观题。平台未区分时缺省。 */ kind?: 'objective' | 'subjective'; /** 我的作答（客观题）。 */ myAnswer?: string; /** 正确答案（客观题）。 */ answer?: string; }
export interface QuestionScoreSummary { kind: 'objective' | 'subjective'; score: number; maxScore: number; inferred?: boolean; }
export interface SubjectDetail { subjectId: string; subject: string; score?: number; maxScore?: number; grade?: string; defeatRates?: DefeatRate[]; providerContext?: Record<string, string>; statistics?: SubjectStatistic[]; chapterAnalysis?: SubjectAnalysisItem[]; abilityAnalysis?: SubjectAnalysisItem[]; abilityScoreAnalysis?: SubjectAnalysisItem[]; questions?: QuestionScore[]; questionScoreSummaries?: QuestionScoreSummary[]; answerSheets?: AnswerSheet[]; reportSections?: ReportSection[]; questionNotice?: string; }
export interface LocalAccount { id: string; revision: string; label: string; providerId: string; login: string; authMode?: 'password' | 'token' | 'webview'; loginMethod?: string; password?: string; session?: AuthSession; selectedProfile?: StudentProfile; academicYear?: string; }
export interface AuthSession { providerId: string; accountId: string; accessToken: string; expiresAt?: number; providerContext?: Record<string, string>; }
export type ProviderErrorCode = 'INVALID_CREDENTIALS' | 'SESSION_EXPIRED' | 'NETWORK' | 'NOT_FOUND' | 'UNSUPPORTED' | 'RESTRICTED' | 'UNKNOWN';
export class ProviderError extends Error { constructor(public readonly code: ProviderErrorCode, message: string, public readonly retryable = false) { super(message); this.name = 'ProviderError'; } }
