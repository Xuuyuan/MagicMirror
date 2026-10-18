# 智学网 Provider

## 接入范围

- 平台：智学网；官方入口 https://www.zhixue.com/。
- 登录：官方 WebView 登录，由用户输入密码并完成滑块，不保存密码。
- 已实现：当前学生、官方学年、考试列表、主报告、近五次成绩变化、学科诊断雷达图、单科知识点说明、逐题得分与选择题答案、多页本人答题卡及逐题多区域作答预览。真实 Android 登录、布局与手势仍待设备验收。
- 不提供官方精确排名；仅在人数比例规则得到确认时显示标明“预估”的排名范围，分数型或无法确认规则时隐藏，`capabilities.ranking` 保持 false。
- 暂不开放绑定学生切换、逐题解析和空白试卷原卷；答题卡展示原始扫描图，不合成官网另行绘制的分数与批阅笔迹。
- 不使用自有转发服务，不绕过验证码、显示权限或访问限制。

相关实现与边界：

- [附加报告与排名预估](zhixue-report-sections.md)
- [逐题多区域及合并阅卷作答预览](zhixue-question-regions.md)
- [统一 Provider 规范](provider-spec.md)

## 当前验证状态

2026-10-17 联考适配后的工作区完成 lint、typecheck、全量测试及 Android Hermes bundle 导出。测试使用虚构数据和服务替身。

此前已有会话的真实只读报告与多区域验证见上述专项文档。已通过实际 Provider 验证指定联考的全科、语文及物理报告和各范围人数型规则，详见[联考适配复核](zhixue-report-sections.md#联考适配复核2026-10-17)。单科联考人数存在口径冲突，未据此推算排名。不同家长隔离、学生切换、会话自然过期及 Android 端完整登录仍保留各自的未验证边界。

## 登录与会话保护

使用 Provider 可选 `webLogin` 能力、`webview` 认证模式、官方登录页与带尝试标识的桥接验证服务。页面不渲染原生账号密码输入框；桥接接收来源、格式和长度均受限。家长/学生确认后才保存到 SecureStore，并比较登录开始时的 revision 和 Token，防止覆盖中途编辑的账号。恢复及同身份重新登录时核对原家长与已保存学生，无法确认时停止查询。取消和迟到消息不能提交，重复消息不会重复保存。新账号索引写入失败会清理孤立凭据记录。

认证材料不进入路由参数或通用诊断。登录尝试串行执行。当前 Android WebView 依赖的 incognito 实现会调用全局 removeAllCookies，因此没有启用该属性，也不通过全局清 Cookie 假装隔离。仍可能复用系统 WebView 的官方站点登录态，保存前严格核对身份；新增账号需用户在官方页面确认身份。不同 WebView Cookie 容器隔离尚未实现。

## 学生、学年与报告

注册 `zhixue`，仅支持家长账号的当前学生。没有实现 getProfiles/selectProfile，因此不开放学生切换；其他身份返回结构/支持范围错误。现有探索只证明同一账号、同一学生的两份报告 Token 可以并存，不能证明独立 Cookie 容器或跨学生 Token 行为。

流程：直接打开官方手机 `/wap_login.html` 账号密码页 → 官方页面登录/人工滑块 → 返回家长首页读取当前学生 → 自动衔接官方报告页建立报告会话 → 独立官方请求验证家长、学生、官方用户路由与学年 → 展示当前学生及学校 → 用户确认保存 → 再次确认学生后提交。手机登录页同样支持 `nextpage` 参数，直接指向家长首页，避开通用首页按手机 UA 分流；全程保留 WebView 默认手机 UA。桥接等待家长首页提供有效 currentChild 后自动打开固定官方报告地址，无需用户查找或点击“成绩报告”，每次页面加载只发起一次衔接。报告 Token 仍由官方报告页按已登录会话建立，不从首页读取旧 Token。当前学生信息来自家长首页的 currentChild，学校字段是 school.schoolName；不依赖存在历史考试。桥接只读这些明确字段，不监听登录表单或拦截完整请求。手机 UA 下的实际跳转与会话建立仍待 Android 验收。

原生请求不携带 Cookie；报告 Token 通过请求头发送。请求使用官方公开签名约定，业务时间差 9801 最多校准重试一次；3001 按会话失效处理（依据官方脚本，尚未观察自然过期的真实响应）。HTTP 400 不直接等同于过期；网络、内容未入库、未知结构和权限限制分开处理。没有伪造刷新接口，也不在后台启动隐藏登录页。

当前允许的原生服务主机是 `https://www.zhixue.com` 和 `https://ali-bg.zhixue.com`，用户与考试路由分别查询；拒绝未知主机、非 HTTPS、凭据、非默认端口和额外路径。请求禁止自动重定向。后续遇到新的官方路由应先核实再扩充允许列表。开启调试模式后，与其他平台一样完整记录原生请求和响应，包括完整 URL、Token、成绩，以及请求实际携带和响应可读取的 Cookie 头；未开启调试模式时不记录。当前原生请求不携带 Cookie，调试采集不改变这一请求行为。

学年由官方 academicYear 提供 code/name/beginTime/endTime，不硬编码日期边界。默认官方当前学年，用户可选择历史学年，选择按本地账号持久化，查询键包含学年；由于当前学生固定，相当于该账号当前学生的选择。切换年份不刷新认证，也不改其他账号。空学年仍为合法结果。

分页保留官方下一页 pageIndex/actualPosition，只存有界的分页控制状态，成绩仍由 TanStack Query 管理。hasNextPage=false 后不再请求下一页；游标丢失时要求从首屏刷新，不猜页码。考试 ID 为版本化 zx1 编码，仅包含官方考试 ID、学生 ID 和学年范围，无 Token；Provider 重建后仍可请求原考试。主报告读取前后核对当前学生，学生变化时不返回内容。该检查不能证明服务器选择与请求具有事务隔离，跨学生语义仍未验证。

主报告 userScore 是展示分，preAssignScore 是赋分前原分；满分分别使用 assignStandardScore/standardScore。单科考试复用多科考试的顶部“总分”卡：官方未提供 totalScore 对象且 paperList 只有一项时，将该科分数、满分、等第及赋分前原分映射到整场汇总；保留零分和缺分的区别，不人为填零。官方总分对象始终优先，多科缺少总分时不自行求和。不把列表 score=0 或 hasExamReport=false 映射成无成绩，不从缺分推断缺考。

main.title 是报告标题，不作为真实考试名称。Provider 未取得 totalScore.examName 时使用“考试报告”并标记 examNameIsFallback；列表跳转携带已选考试名称，考试详情和科目详情统一由 examDisplayName 优先选择接口真实名称，其次列表名称，最后通用兜底。进入科目详情继续传递已解析的考试名称，覆盖副标题及其加载/失败状态；刷新不依赖新增内存缓存，也不改变考试 ID。唯一科目卡片使用整行宽度，多科布局保持原样。附加报告及受条件限制的排名预估由 Provider 转为统一 `reportSections`，详见专项文档。

## 逐题得分与答题卡

Provider 提供 getSubjectDetail/getAnswerSheets/getQuestionAnswerSheets，并声明 subjectDetails、questionScores、answerSheets，复用已有科目详情和答题卡查看界面。答题卡接口依据官方报告页公开脚本：`https://static.zhixue.com/activity/app/web-report/2.0.1306/static/js/3.js`。此前已用已有官方会话执行只读请求核对字段与区域映射，未重放密码；真实响应与签名地址仅留在 Git 忽略的分析目录，不能提交。原生布局与交互仍待人工验收。

请求先核对当前学生和考试上下文，确认科目属于该考试，再按官方考试路由调用 `/zhixuebao/report/checksheet/`，携带 examId、paperId 和考试 ID 内保存的 startSchoolYear/endSchoolYear。读取后再次核对学生；取消、过期、撤销会话、错误学生或未知主机不能返回新内容。相同考试的主报告缓存只用于定位科目，不缓存扫描图接口响应。

接口中的 sheetDatas、sheetImages、cutBlockDetail 是 JSON 字符串，独立解析并校验：逐题记录取 userAnswerRecordDTO.answerRecordDetails 的 topicNumber/dispTitle/score/standardScore；保留 0，缺失分数保持未知，未选中的选做题不计入展示。多子题按 subTopicIndex 与 cutBlocks 匹配，显示 dispTopic 和 subTopicScore，不把父题满分复制为每个子题满分。subTopicIndex 可以是负整数标识，不对其施加分数的非负限制。没有可靠标准答案字段时不推断客观题答案。

真实题型需区分两组字段：分区 sections[].type 的 SingleChoice/MultiChoice/Object 为客观题，AnswerQuestion 为主观题；逐题记录的 answerType 则是 s01Text（文本选项作答）或 s02Image（图片作答），不能把 s02Image 当作分区类型。分区通过 contents.branch[].ixList 的 1-based 数组位置关联 answerRecordDetails；没有可用分区映射时依据记录的 answerType 分类，避免 FastJSON $ref 引用使所有主观题落入“其它题目”。复合题子题继承父题分类，重复跨页分区不会重复生成题目；无法确认时保留未分类。此前一个真实样本映射为 11 道客观题、8 道主观题、0 道未分类，不代表所有考试结构都已覆盖。

选择题“我的答案”来自逐题记录 answer 字段。正确答案独立请求 `https://www.zhixue.com/zxbReport/report/getPaperAnalysis?examId=...&paperId=...`：响应 envelope 的 result 是 JSON 字符串，解析后取 typeTopicAnalysis[].topicAnalysisDTOs[]，按 topicNumber 对应当前题目，读取 s01Text 项的 answerHtml/standardAnswer。只提取选项字母并规范多选顺序，不把 markingTopicDetail 中的批阅编号或分数当成正确答案。此前样本的 11 道选择题均取得了正确选项；不在日志、路由或文档中记录答案内容。该接口与网页版 getLostTopicAndAnalysis 是不同接口，不能由后者无数据推断选择题答案不存在。

上述原生答案接口来自 analysis/zhixue/endpoints.md §3.4 R7，并进一步核对 analysis/zhixue.apk 内 assets/zxb/H5Project/project/ZXB/PaperAnalysis/JS/analysisChoreographer.js：官方在 isForbidAnalysis 两个分支中均展示 standardAnswer，仅区别是否展示 analysis。因此此开关不等同于禁止选择题正确选项；本次不接入主观题参考图片、题干或解析。正确答案请求失败时保留得分和已取得的我的答案并明确提示；会话过期或学生变化仍阻止返回。临时结构诊断与探测请求已移除。

仅在 showSingleTopicScore=true 且非 homework_no_scoring 时显示单题分数。40219 为学校未开放，40216 为存储限制，40218/40220/-1 为原卷缺失，保留官方边界并给出提示；这些状态不会使已有科目成绩整页失败。会话过期、网络和未知结构错误仍正常上报。

sheetImages 按官方页序返回全部原始扫描图，依照官方客户端把 HTTP 升级为 HTTPS，保留签名查询参数，拒绝非 HTTPS、带凭据或非默认端口的图片地址。图片只使用官方响应下发的存储地址，不向图片主机附带账号 Token/Cookie。图片列表和逐题数据独立解析，单个资源的缺失不会阻塞另一个资源。

用户必须确认当前学生后才能保存，确认前再次核对学生；异步初始化可通过 AbortSignal 立即取消，避免页面卸载或开发模式重新挂载留下占用；登录中途修改学年也不会被旧候选覆盖。官方网页登录按钮按 Provider 能力路由。

## Android 人工验收步骤

以下真实 Android 交互仍待人工验收；需要在调试 App 中完成，不以桌面浏览器登录或 bundle 导出代替。

1. 添加账号 → 选择智学网 → 官方网页登录；无登录态时应直接出现官方账号密码框，无需再次点击“登录智学网”；确认 App 无原生密码框。已有官方登录态时官网可能直接返回家长首页。
2. 在官方页面输入账号密码，人工完成滑块；登录后应自动衔接验证并显示待确认学生，无需点击“成绩报告”。WebView 保留手机 UA。如卡在首页或下载页，应记录页面路径；如出现未允许的官方认证跳转，应记录目标主机并核实，不全放开导航。
3. 校验当前学生和学校，点击“确认保存此账号”；若身份不对，重新打开页面，在官方页面退出/切换到目标账号后再验证。不要改变学生绑定。
4. 当前学年为空应正常显示；切换到有考试的历史学年，检查多页加载、下拉刷新与末页结束。
5. 打开有赋分的全科报告、无独立总分对象的单科报告，对照官网分数和满分；单科顶部“总分”卡应展示该科汇总，科目卡占满宽度。确认考试详情标题及科目详情副标题沿用列表真实考试名称；刷新和返回后不变，再检查原分/赋分显示。
6. 退出并重新打开 App，确认账号和历史学年保留；取消一次新增或重登，确认原账号不变。
7. 同账号独立网页登录保存两条本地记录，检查独立学年、账号切换和删除其中一条不影响另一条；不同家长的隔离仍需第二个授权账号另行验证。
8. 报告 Token 真正失效时，确认停止复用旧 Token，并可从账号编辑页重新网页登录；家长/学生不同必须阻止覆盖。自然过期、主动退出、有效 Cookie 重建是不同场景，分别记录。
9. 选择历史学年考试 → 打开科目详情，对照官网核查题号、零分、缺分、选做题和复合题子题；确认“客观题 / 主观题 / 其它题目”分组及“只看错题”后的归类。显示分/赋分与单题原始得分分别核对，不要求两者直接相加一致。
10. 点击“查看答题卡”，确认全部页面顺序、缩放和返回操作；学校未开放、扫描图缺失或单题得分关闭时应给出对应提示，科目总成绩仍可查看。
11. 按[附加报告](zhixue-report-sections.md)核查总结折叠、雷达图及分数型排名隐藏，再按[逐题作答区域](zhixue-question-regions.md)核查多区域和合并题入口。
