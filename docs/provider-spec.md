# Provider 规范

Provider 元数据可通过 `remark` 提供平台别名或说明，仅在平台选择控件显示为“名称（备注）”；主界面、账号切换和账号列表继续使用 `metadata.name`。

每个 Provider 实现 `ScoreProvider`：`authenticate`、`getProfile`、`getExamList`、`getExamResult`、`logout`、`metadata` 和 `capabilities`。返回统一的 `StudentProfile`、`ExamSummary`、`ExamResult` 和 `AuthSession`。外部响应必须先使用 Zod 或等价校验；缺失字段保持可选，不伪造。错误使用 `ProviderError`。好分数的 `getExamList` 支持可选的 `offset` 分页参数；列表不提供可靠科目数时必须保持 `subjectCount` 未定义。未完成官方 UI 对照的排名、发布状态和统计字段不得在 capability 或界面中宣称为稳定能力。

Base64、UTF-8 字节编解码与 RSA（EME-PKCS1-v1_5）公钥加密等跨平台共用的原语统一在 `src/providers/codec.ts`（Hermes 没有 Node Buffer / btoa，勿引入 Node 专属 API）。新增 Provider 需要编码、加密或保守解析分数字符串时直接复用该模块，不要再复制实现。

Provider 可选提供 `authenticateWithToken`，账号编辑页据此显示 Token 登录入口。好分数使用官方 `https://hfs-be.yunxiao.com` 的学生信息接口验证 Token，并校验响应结构和绑定学生；验证成功后才保存账号。输入值为本人官方请求头 `hfs-token` 或 Cookie `hfs-session-id` 的值，不是整段请求头。

好分数 Provider 请求按端点分两套官方形态：v4 端点（考试档案 `/v4/exam/archives`，2026-10 起考试列表的唯一来源）使用官方 H5/WebView 形态——浏览器 UA 尾缀 `HFS_XSversion`/`HFS_JZversion` + `hfs-token` + `Origin`/`Referer` 等完整浏览器头，与官方内嵌页面请求同构；其余端点使用官方原生形态——`deviceType`/`appType`/`versionName` 头 + UA `YX Android <系统版本>`，认证只靠 Cookie。官方把被风控锁定的会话伪装成 `code=1`「无数据」；Provider 按 `msg` 关键词识别为访问限制，不自动重新登录，界面引导用户使用官方 H5 登录页处理。官方在浏览成绩页时会上报行为事件（`POST /v3/action/behaviors`），MagicMirror 不伪造此类事件。

好分数排名使用官方展示串 `classRankS`/`gradeRankS`/`groupRankS`（区间 `1~20/42人`、等级 `A`~`E`、屏蔽 `**`），等级带按官方百分比规则配合考生人数换算为区间，经 `Ranking.rankMax` 表达；考试列表的 `*RankPart` 备用字母（overview 不含）与区间取交集缩小范围、在屏蔽时单独兜底（Provider 内存缓存字母，15 分钟内有效）；数值字段 `classRank` 等恒为 `-1` 哨兵，不得采用。题目分析详情接口（`question-detail`）受服务端权益门控（`show=0` 只返回 1 道预览题），在权益为全量前不得接入。逐题得分（answer-picture）无门控，题目按 `type` 区分客观/主观（`QuestionScore.kind`），客观题带 `myAnswer`/`answer`。

账号记录使用 `authMode` 区分密码和 Token 登录，认证信息保存在 SecureStore 中。Token 无自动续期能力；官方返回已映射的会话失效码后，本地将该会话标记过期，后续请求提示更新 Token。网络错误不标记为过期。编辑 Token 账号默认打开 Token 模式，不回显已有 Token；换成密码登录可恢复密码自动登录能力。Token 登录不会扩大官方账号的数据权限，也不能保证考试列表返回历史考试。

答题卡图片若需要会话请求头，Provider 在 `AnswerSheet.headers` 中返回所需请求头即可；界面层负责按请求头下载到缓存后再渲染，因为 React Native Android 的 `Image` 组件不会发送自定义请求头。

可选能力 `getWatermarkedAnswerSheets` 返回带分数水印的答题卡（图片上标注各题得分），与 `getAnswerSheets` 的无水印版是两套独立地址：无水印版用于「查看答题卡」页，水印版用于单科详情的逐题得分区（平台不提供逐题得分时作为替代）。两者分别使用独立的查询键，不得互相覆盖。七天学堂通过 `Question/AnswerCardUrl` 的 `isWatermark` 参数选择版本。

`ExamSummary.category` 是考试性质的展示标签（如「周测」「月考」），由平台原样下发；平台未给出时七天学堂兜底为「其它」，其他平台保持未定义。`ExamResult.participantCount` 为考生人数；含作文科目（语文/英语）的作文年级均分与最高分通过 `SubjectScore.providerContext` 的 `essayAvg`、`essayMax` 传递。
