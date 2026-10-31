# 小力学伴 Provider

Provider ID 为 `xiaolixueban`，名称为“小力学伴”。设备直接访问官方门户 `https://school.nicezhuanye.com` 与报告服务 `https://m.nicezhuanye.com`（换票在 `https://nicezhuanye.dongni100.com`，答题卡图片在 `https://cdn.dongni100.com`）。

登录方式只有**手机号 + 密码**，走官方登录页的「手机号登录」通道（`POST /loginserv/login/login`，`{parameter:{cellphone,pwd,saveCookie:true}}`）；不使用官方 WebView 登录，也不使用「账号密码登录」（那条链路带请求加密，与手机号通道不同）。密码经项目现有 SecureStore 账号层保存，失效时由账号层重新登录并重新换票。

## 会话模型

1. 门户登录：拿到 `userID`、`accesstoken` 与 Cookie `loginToken`（门户业务接口还要求 `hqjl-user` / `hqjl-token`，缺失时返回 HTTP 911）。
2. `POST /nicezhuanye/parent/getChilder` 取家长绑定学生（`studentUsers`）。
3. `POST /nicezhuanye/ssoLogin/getTicket` 取一次性 ticket，再 `POST https://nicezhuanye.dongni100.com/api/base/data/system/auth/sso`（**必须 `clientType:1`**）换取 `dongniLoginToken`。
4. `GET /api/base/data/account/role` 才是报告接口真正使用的学生上下文：报告接口的 `studentId` 是其中的 `relativeId`，不是门户的 `studentUserID`，也不是换票返回的 `relativeId`（父关系 ID）。

`AuthSession.accessToken` 保存 `dongniLoginToken`；`providerContext` 保存门户账号、Cookie、当前学生与学校/班级/年级，用于切换学生与恢复。报告令牌有效期未验证，失效（业务码 `10051` 或 HTTP 911）后由账号层用已存密码重登 + 重新换票，不把网络错误当作凭据失效。

## 能力

| 能力 | 范围 |
| --- | --- |
| 登录、学生信息 | 家长手机号 + 密码；支持同一账号下多个绑定学生（切换会重新换票） |
| 考试列表 | 官方 `plan/student/all` 分页（每页 20 场），名称、日期、考试性质 |
| 成绩总览 | 总分（赋分）、原始总分、科目分数、总分统计、等级（`consistName`）、班级/年级/联考排名、班级/学校分数分布、预估排名与人数 |
| 报告卡片 | 学科强弱得分率（本人 vs 学校平均）、班级/学校总分分数分布（按实际返回数据） |
| 单科详情 | 分数、原始分、满分、班级/学校分数区间、班级/学校/联考均分与排名、逐题得分与作答 |
| 答题卡 | 官方异步任务生成的合成图（按页排序，CDN 免鉴权直链） |
| 不接入 | WebView 登录、逐题作答裁剪图、带分值水印答题卡、错题本、作业、分数申诉、VIP |

## 数据口径与限制

- **排名**：`classRanking`=班级、`examRanking`=年级、`ranking`=联考；接口返回排名或人数就展示，缺失字段保持缺失。老考试可能保留班级/学校均分但没有单科排名行，这是平台历史数据差异，不由均分推算精确排名。
- **联考均分**：`baseIndex` 中不带 `schoolId` 的区域汇总行提供联考均分，界面卡片显示“联考均分”；均分缺失时不生成只有人数的卡片。
- **单科统计**：卡片顺序为班级均分/排名 → 学校均分/排名 → 联考均分/排名。班级/学校均分优先取 `scoreRankInfo` 单科行的 `classAverageScore`/`schoolAverageScore`，该行缺失时从 `result/question/analysis` 各题的同名字段汇总；联考均分取 `baseIndex` 区域汇总行里同一 `courseId` 的单科均分，联考排名取 `scoreRankInfo` 单科行的 `ranking`，人数取该行的 `examRankNumber`。所有内容以实际返回数据为准，不受显示开关过滤。
- **单科报告下的其它科目**：`courseInfo` 会返回本场全部科目，但单科报告的 `paper/question` 可能只返回主导科目（例如“物理(全体)”只返回物理）。Provider 先沿用主导 `statId` 请求各科 `paper/question`，失败或没有本人记录时再按科目请求 `scoreRankInfo`，并保留 `courseInfo` 中的科目入口，避免政治等科目消失。无法取得分数时仍显示科目，但不伪造分数或满分。
- **人数展示**：均分卡片只放均分，人数只在排名卡片展示；只有当所有排名都不含人数时，才在总分区以“考生人数”补齐。
- **学科强弱得分率**：只有“本人”和“学校平均”两条。平台的 `scoreRate` 接口只返回本人各科得分率与各科平均得分率，后者是学校口径，没有班级、联考版本；班级只有分数均分（`scoreRankInfo.classAverageScore`），无法换算成单科得分率。
- **逐题得分**：`result/question/analysis` 在部分考试（实测区域赋分考试）逐题 `finallyScore` 全为 0，真实得分在 `error/analysis` 的 `finallyScore`（其合计等于科目总分），客观题正确答案为 `correctAnswer`。Provider 以题号合并两接口：得分与正确答案取 `error/analysis`，题目类型与客观/主观标记取 `result/question/analysis`（该接口缺失时退化为仅用 `error/analysis`）。
- **主观题汇总**：答题详情优先直接累加每道主观题的实际 `finallyScore`；只有逐题主观得分缺失时，才回退到“科目总分 − 客观题得分”，避免赋分考试混用口径。
- **赋分与原始分**：考试列表 `stat` 同时给出原始分与赋分时，详情页总分使用平台赋分并显示官方原始总分。科目详情在逐题得分完整时，将各小题得分合计为科目原始分；只有原始分与平台返回总分不同时才显示“原始 X”，相同时隐藏重复标签。不能据此反推出整场考试原始总分。
- **总分题分数分布与预估排名**：`school/scoreSection`、`class/scoreSection` 在 `courseId` 为空时返回总分口径（`statId=0` 即原始总分），响应含本人 `totalScore`、`participationNumber`、`totalStudent` 与 `scoreSection` 分段（`open/close/total/cumulative/ratio`，区间为 `[open, close)`）。Provider 用它：
  - 补出官方总分与满分（优先于“各科合计”推导）；
  - 官方没有班级/年级排名时，按本人总分所在分段的累计人数估算名次区间 `[cumulative-total+1, cumulative]`，下发 `Ranking.estimate=true`（界面加“（预估）”），人数取 `participationNumber`；
  - 生成“班级分数分布 / 学校分数分布”条形图卡片（非题目维度，`DistributionGroup.unitLabel=''` 隐藏“N 题”计数）。分段宽度由平台决定（实测 50 分），因此预估只能给区间；有官方排名时不使用估算值。
- **总分**：优先用平台下发值（分数段接口的 `totalScore`、`scoreRankInfo` 总分行，或赋分考试的列表 `stat.totalScore`）。都没有时，只要所有科目的分数与满分齐全，用**各科合计**作为主分数并提示“平台未公布总分，当前总分由各科分数合计得出”；有官方值时不使用合计。满分优先官方 `fullMark`，其次各科满分之和。
- **科目分数分布与预估排名**：科目详情同时展示班级、学校分数区间；官方单科排名缺失时，按本人分数所在区间的累计人数估算班级/学校名次，并标记“预估”。
- **展示口径**：Provider 不采用平台显示开关过滤数据；总分、排名、均分、分数段和得分率只要接口实际返回就进入统一模型，缺失字段保持缺失。
- **科目识别**：报告视图名 `物理(全体)` 通过科目名 + 左括号匹配到 `courseId`；`物理类赋分(全体生)` 是整份报告，不会被当成物理单科。
- **考试标识与报告切换**：`ExamSummary.id` 是平台 `examId`；报告视图在 `getExamResult` 内用 `schoolExamStat` 现取，按官方返回顺序展示报告列表并默认选择第一条，用户切换后通过 `reportId` 重新请求该 `statId`。`SubjectScore.id` 为 `<statId>:<courseId>`，`providerContext` 另存 `paperId`，重启后仍可恢复查询。
- **答题卡**：只有合成图（无分数标注）；官方客户端的分数/批注是本地绘制，故不提供“带分值水印”版本。
- **隐私**：`paper/question` 不按学生过滤，会返回同班全部同学的分数与作答。Provider 只按当前会话 `studentId` 取本人那一条，其余数据不展示、不缓存、不记录；找不到本人时返回“未返回本人该科目的数据”，不回退到其他同学。
- **其他**：家长账号的 `weChat/result`、`weChat/course/result` 返回 `10057 当前账号无权限`；`class/course` 对家长不可用。这两类端点不参与实现。
- 赋分科目只展示平台赋分结果，未接入原始分对照（原始分只在考试列表 `stat.originalScore` 中以另一口径出现）。

## 错误语义

| 场景           | 表现                           | 映射                            |
| -------------- | ------------------------------ | ------------------------------- |
| 报告令牌失效   | HTTP 200 + `status:10051`      | `SESSION_EXPIRED`（账号层重登） |
| 门户会话失效   | HTTP 911                       | `SESSION_EXPIRED`               |
| 账号或密码错误 | `code:-1` + `用户名或密码错误` | `INVALID_CREDENTIALS`           |
| 登录过于频繁   | 与密码错误同一文案             | 同样提示，不自动重试            |
| 无权限内容     | `10057`                        | `RESTRICTED`                    |
| 学生上下文错误 | `10001 学生信息不存在`         | 重新获取学生列表后再试          |
| 网络/超时      | 传输层错误                     | `NETWORK`，不标记凭据失效       |

注销调用官方 `POST /api/base/data/logout` 并在本地撤销会话；注销失败不会阻止移除本地账号。

## 验证

离线：`src/__tests__/xiaolixueban.test.ts` 使用虚构数据覆盖手机号登录、门户 911、`10051`、分页、日期与考试性质、报告切换、区域考试总分/排名/等级/统计、按实际数据展示、校内科考试的单科报告分数、整班数据过滤、答题卡排序与学生校验、注销。

联网（默认不跑，只做只读查询）：

```powershell
$env:XIAOLIXUEBAN_ACCOUNT='<手机号>'
$env:XIAOLIXUEBAN_PASSWORD='<密码>'
npx jest --runInBand --testMatch "<rootDir>/src/__tests__/xiaolixueban.live.check.ts"
```

## Android 人工验收

1. 设置中添加账号，平台选择“小力学伴”；输入手机号与密码保存后，首页与账号列表显示“小力学伴”。
2. 打开考试列表，对照官方小程序核对考试名称与日期；进入已公布分数的区域考试，核对总分、满分、班级/年级排名、等级与“学科强弱得分率”。
3. 打开一个科目，核对逐题得分、作答、分数区间与班级/学校统计；内容以接口实际返回数据为准。
4. 进入答题卡，核对页数与内容；图片应能直接加载（CDN 直链），不要求登录请求头。
5. 打开校内科考试，核对接口实际返回的科目、分数、原始分、班级/学校均分和分数区间；不凭空生成缺失数据。
6. 切换账号再切回、重启 App 后再次查询，数据与会话不串用；家长账号只应看到本人数据。
