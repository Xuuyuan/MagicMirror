# Provider 规范

Provider 元数据可通过 `remark` 提供平台别名或说明，仅在平台选择控件显示为“名称（备注）”；主界面、账号切换和账号列表继续使用 `metadata.name`。

需要交互认证的平台可提供 `webLogin`（官方入口、允许的来源、最小会话桥接脚本与官方验证方法）。账号使用 `authMode=webview`，不收集密码；会话验证后展示当前学生，用户确认后才保存到安全存储。取消、迟到消息、不同家长或学生、revision/旧 Token 变化均不能覆盖原账号。该模式失效后由用户重新网页登录，不隐式降级为密码登录或手工 Token 登录。

可选 `getAcademicYears` 返回官方学年列表（默认学年排首位），`getExamList` 的 `page.academicYear` 指定学年。所选学年按本地账号保存，考试列表查询键包含学年，切换时取消旧列表请求。详情标识必须携带足以在重启后恢复查询的上下文，不能依赖进程内列表缓存。智学网实现与验收边界见 [zhixue-provider.md](zhixue-provider.md)。

每个 Provider 实现 `ScoreProvider`：`authenticate`、`getProfile`、`getExamList`、`getExamResult`、`logout`、`metadata` 和 `capabilities`。返回统一的 `StudentProfile`、`ExamSummary`、`ExamResult` 和 `AuthSession`。外部响应必须先使用 Zod 或等价校验；缺失字段保持可选，不伪造。错误使用 `ProviderError`。好分数的 `getExamList` 支持可选的 `offset` 分页参数；列表不提供可靠科目数时必须保持 `subjectCount` 未定义。未完成官方 UI 对照的排名、发布状态和统计字段不得在 capability 或界面中宣称为稳定能力。

Base64、UTF-8 字节编解码与 RSA（EME-PKCS1-v1_5）公钥加密等跨平台共用的原语统一在 `src/providers/codec.ts`（Hermes 没有 Node Buffer / btoa，勿引入 Node 专属 API）。新增 Provider 需要编码、加密或保守解析分数字符串时直接复用该模块，不要再复制实现。

Provider 可选提供 `authenticateWithToken`，账号编辑页据此显示 Token 登录入口。好分数使用官方 `https://hfs-be.yunxiao.com` 的学生信息接口验证 Token，并校验响应结构和绑定学生；验证成功后才保存账号。输入值为本人官方请求头 `hfs-token` 或 Cookie `hfs-session-id` 的值，不是整段请求头。

Provider 可选提供 `getProfiles` / `selectProfile`，支持同一账号下切换学生；账号密码不重复保存。首页右上角的学生入口只在**绑定多个学生**时显示（列表为空或只有一个学生时隐藏；首次加载尚未取到列表时不显示，读取失败时保留入口以便重试），首页平台标签沿用同一条“>1 才显示序号”的规则。`selectProfile` 返回的会话里若当前学生信息有变化，Provider 写进 `AuthSession.providerContext`（该字段会被持久化，并在重登恢复时按账号保存的选择重放）。需要按学生隔离缓存数据的平台（如好分数的 15 分钟考试档案缓存）必须把当前学生纳入缓存键：平台的当前学生状态可能不是会话级（好分数实测：切换后 Cookie 不变、新建会话直接落在上次切换到的学生）。

好分数 Provider 的全部请求（登录、`user-center`、`v3`/`v4` 成绩端点、切换学生）统一使用官方 H5/WebView 形态：浏览器 UA 尾缀 `HFS_XSversion`/`HFS_JZversion` + `hfs-token` + `hfs-session-id` Cookie + `Origin`/`Referer` 等完整浏览器头，与官方内嵌页面请求同构；不要混用原生客户端形态（`deviceType`/`appType`/`versionName` 头 + UA `YX Android <系统版本>`，认证只靠 Cookie），也不要自行拼接未知头。官方把被风控锁定的会话伪装成 `code=1`「无数据」；Provider 按 `msg` 关键词识别为访问限制，不自动重新登录，界面引导用户使用官方 H5 登录页处理。官方在浏览成绩页时会上报行为事件（`POST /v3/action/behaviors`），MagicMirror 不伪造此类事件。

好分数排名使用官方展示串 `classRankS`/`gradeRankS`/`groupRankS`（区间 `1~20/42人`、等级 `A`~`E`、屏蔽 `**`），等级带按官方百分比规则配合考生人数换算为区间，经 `Ranking.rankMax` 表达；考试列表的 `*RankPart` 备用字母（overview 不含）与区间取交集缩小范围、在屏蔽时单独兜底（Provider 内存缓存字母，15 分钟内有效）；数值字段 `classRank` 等恒为 `-1` 哨兵，不得采用。题目分析详情接口（`question-detail`）受服务端权益门控（`show=0` 只返回 1 道预览题），在权益为全量前不得接入。逐题得分（answer-picture）无门控，题目按 `type` 区分客观/主观（`QuestionScore.kind`），客观题带 `myAnswer`/`answer`。

账号记录使用 `authMode` 区分密码和 Token 登录，认证信息保存在 SecureStore 中。Token 无自动续期能力；官方返回已映射的会话失效码后，本地将该会话标记过期，后续请求提示更新 Token。网络错误不标记为过期。编辑 Token 账号默认打开 Token 模式，不回显已有 Token；换成密码登录可恢复密码自动登录能力。Token 登录不会扩大官方账号的数据权限，也不能保证考试列表返回历史考试。

列表中的答题卡/试卷扫描图按显示尺寸解码（`AdaptiveSheetImage` 使用 `resizeMethod="resize"`），查看器保持原分辨率：A4 扫描件解码约 14.8MB/张，按原分辨率渲染多页会超出 Android 堆上限并导致图片不显示（RN 也把 `none` 标为不安全）。

答题卡图片若需要会话请求头，Provider 在 `AnswerSheet.headers` 中返回所需请求头即可；界面层负责按请求头下载到缓存后再渲染，因为 React Native Android 的 `Image` 组件不会发送自定义请求头。

逐题本人作答图优先使用可选 `getQuestionAnswerSheets(session, examId, subjectId, questionId, cachedResult?, options?)`，返回按阅读顺序排列的 `AnswerSheet[]`；`cachedResult` 仅用于已有考试与科目上下文校验，请求取消信号通过 `options.signal` 传递。不提供多区域方法的平台继续使用 `getQuestionAnswerSheet(session, examId, subjectId, questionId, options?)` 单图方法。调用方不应在多区域请求失败后擅自回退并展示不完整单图。

`AnswerSheet.region?: ImageRegion` 表示原始扫描图上的归一化区域：`x/y` 为左上位置，`width/height` 为区域尺寸；可选 `sourceAspectRatio` 用于验证原图方向与模板比例。普通整页图片不设置 `region`。Provider 负责校验区域完整性和题号映射，界面复用原图与现有预览进行裁切展示，不改写签名 URL，也不将带认证信息的请求头发送到无须认证的图片主机。区域预览不提供长按保存/复制，避免误操作底层整页原图。智学网的多区域、合并阅卷和降级行为见 [zhixue-question-regions.md](zhixue-question-regions.md)。

可选能力 `getWatermarkedAnswerSheets` 返回带分数水印的答题卡（图片上标注各题得分），与 `getAnswerSheets` 的无水印版是两套独立地址：无水印版用于「查看答题卡」页，水印版用于单科详情的逐题得分区（平台不提供逐题得分时作为替代）。两者分别使用独立的查询键，不得互相覆盖。七天学堂通过 `Question/AnswerCardUrl` 的 `isWatermark` 参数选择版本。

可选能力 `getPaperImages` 返回本科目试卷原卷的多页扫描图，与答题卡、水印答题卡同样是独立图片集，使用独立查询键；短期签名地址由界面在加载失败时重新获取，Provider 不持久化。可选能力 `getEssayDetail` 返回作文题干与本人作答扫描图，无数据时返回空 `answerSheets` 而非报错；作答图由界面以「查看本人作答」按钮直接打开放大查看，不内嵌列表。报告卡片通过可选字段 `ReportSection.placement: 'essay'` 声明并入作文卡片（不出现独立标题）；未声明 `placement` 一律按独立报告卡片渲染，未识别该字段的界面会退回独立卡片展示。可选能力 `getSubjectStatistics` 返回科目级统计（如参考人数、均分），单独懒加载以免拖慢科目详情，平台不可用时返回空数组；界面把它与 `SubjectDetail.statistics` 合并展示，不区分数据来自详情还是该方法。含具体含义的统计（如「学校参考人数」）必须先在官方界面或项目负责人处确认语义后才能展示，不得由未对照字段推断。`SubjectStatistic.rank` + `rankMax` 表达区间名次；该模型中的估算值必须带 `estimate: true`，界面据此在标签后加「（预估）」。通过 `ReportSection.highlights` 展示的估算范围没有 `estimate` 字段，Provider 必须在展示标签中明确标注「（预估）」。两种方式均须先确认等第对应人数比例及统计范围，不得将分数区间当作人数百分位；规则无法确认时不生成预估排名。平台的精确名次能力（`capabilities.ranking`）不得因此声明为可用。

`ReportSection` 将平台报告转换为通用展示数据，平台条件由 Provider 决定。`highlights` 配合 `highlightColumns` 和可选 `highlightRows` 控制指标列数及每行数量；`itemGroups` 为明细指定分组、列名及字段键。`radar` 提供学科轴 `axes` 和各序列 `series`，智学网使用 0–100 水平刻度；缺失值为 `null`，不得补成 0。`collapseNotes` 控制说明默认折叠；`notesPosition: 'bottom'` 将说明放到卡片底部，`'before-items'` 则放在指标之后、明细之前，未设置时放在卡片内容顶部。智学网的字段解释、人数型排名规则及真实请求验证边界见 [zhixue-report-sections.md](zhixue-report-sections.md)。

`ExamResult.notice` 是 Provider 解释的页面级提示（`{ id, text }`），界面显示在考试详情页顶部并提供关闭入口，关闭状态按「考试 + 提示 id」存在本地偏好里（`dismissedNotices`，键形如 `<examId>:<noticeId>`），因此同一提示在不同考试中各自独立，Provider 不得用它承载不看就会误解结果的必要信息以外的内容，也不得依赖它组织页面结构。

`ExamSummary.category` 是考试性质的展示标签（如「周测」「月考」），由平台原样下发；平台未给出时七天学堂兜底为「其它」，其他平台保持未定义。`ExamResult.participantCount` 为考生人数；含作文科目（语文/英语）的作文年级均分与最高分通过 `SubjectScore.providerContext` 的 `essayAvg`、`essayMax` 传递。
