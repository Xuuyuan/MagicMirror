import type { AnswerSheet, AuthSession, ClaimCandidate, EssayDetail, ExamResult, ExamSummary, ProviderCapabilities, StudentProfile, SubjectDetail, UnclaimedExam } from '@/src/domain/models';
export interface ScoreProviderMetadata { id: string; name: string; /** 仅用于平台选择界面的名称补充。 */ remark?: string; description: string; officialDomain?: string; }
export interface ProviderRequestOptions { signal?: AbortSignal; }
export interface ScoreProvider { readonly metadata: ScoreProviderMetadata; readonly capabilities: ProviderCapabilities; authenticate(account: string, password: string): Promise<AuthSession>; authenticateWithToken?(token: string): Promise<AuthSession>; getProfile(session: AuthSession, options?: ProviderRequestOptions): Promise<StudentProfile>; getProfiles?(session: AuthSession, options?: ProviderRequestOptions): Promise<StudentProfile[]>; selectProfile?(session: AuthSession, profileId: string, options?: ProviderRequestOptions): Promise<AuthSession>; getExamList(session: AuthSession, page?: { offset?: number }, options?: ProviderRequestOptions): Promise<ExamSummary[]>; getExamResult(session: AuthSession, examId: string, options?: ProviderRequestOptions): Promise<ExamResult>; logout(session: AuthSession): Promise<void>;
  /** 官方 H5 页面诊断入口；页面自行执行官方脚本与请求，Provider 只提供短期启动上下文。WebView 使用系统默认 UA 并追加 userAgentSuffix（与官方 WebView 一致）。 */
  getOfficialH5Bootstrap?(session: AuthSession): Promise<{ url: string; userAgentSuffix: string; cookie: string; userInfo: Record<string, unknown> }>;
  /** 官方 H5 登录入口（对照实验用）：页面自行完成登录与会话创建，不需要 Provider 提供任何凭据。 */
  getOfficialH5LoginEntry?(): { url: string; userAgentSuffix: string };
  /** 用户主动请求平台加载/认领一场考试时调用；平台未提供时保持省略。 */
  loadExam?(session: AuthSession, examId: string, options?: ProviderRequestOptions): Promise<void>;
  getUnclaimedExams?(session: AuthSession, options?: ProviderRequestOptions): Promise<UnclaimedExam[]>;
  getClaimCandidates?(session: AuthSession, examId: string, studentCodes: string[], options?: ProviderRequestOptions): Promise<ClaimCandidate[]>;
  claimExam?(session: AuthSession, examId: string, studentCode: string, options?: ProviderRequestOptions): Promise<void>;
  /** 可选能力：本人作答的答题卡（扫描件）地址；平台未提供时返回空数组或省略该方法。 */
  getAnswerSheets?(session: AuthSession, examId: string, subjectId: string, cachedResult?: ExamResult, options?: ProviderRequestOptions): Promise<AnswerSheet[]>;
  /** 可选能力：带分数水印的答题卡（图片上标注各题得分）；与 `getAnswerSheets` 的无水印版相互独立。 */
  getWatermarkedAnswerSheets?(session: AuthSession, examId: string, subjectId: string, cachedResult?: ExamResult, options?: ProviderRequestOptions): Promise<AnswerSheet[]>;
  getSubjectDetail?(session: AuthSession, examId: string, subjectId: string, cachedResult?: ExamResult, options?: ProviderRequestOptions): Promise<SubjectDetail>;
  /** 可选能力：本科目试卷原卷扫描图（多页）；与答题卡是独立图片集，使用独立查询键。 */
  getPaperImages?(session: AuthSession, examId: string, subjectId: string, cachedResult?: ExamResult, options?: ProviderRequestOptions): Promise<AnswerSheet[]>;
  /** 可选能力：作文题干与本人作答扫描图；平台未提供时 answerSheets 为空数组。 */
  getEssayDetail?(session: AuthSession, examId: string, subjectId: string, cachedResult?: ExamResult, options?: ProviderRequestOptions): Promise<EssayDetail>;
  /** 仅调试用途：平台未与官方 UI 对照语义的原始字段；返回空数组表示不可用，不用于正式展示。 */
  getDebugSubjectFields?(session: AuthSession, examId: string, subjectId: string, cachedResult?: ExamResult, options?: ProviderRequestOptions): Promise<{ label: string; value: string }[]>;
  /** 按需获取本人主观题作答切图；不批量预取短期链接。 */
  getQuestionAnswerSheet?(session: AuthSession, examId: string, subjectId: string, questionId: string, options?: ProviderRequestOptions): Promise<AnswerSheet>;
  refreshSession?(session: AuthSession): Promise<AuthSession>;
}
