# 助学帮 Provider

Provider ID 为 `zhuxuebang`，名称为“助学帮”，备注为“五岳阅卷”。备注仅显示在平台选择控件中，主界面和账号列表使用原名称。

设备直接访问官方 `https://stuquery.wylkyj.com`，账号密码通过 `/api/v1/auth/LoginByPassword` 的 `mobile`、`password` 字段登录，认证头为 `token`。认证信息使用项目现有 SecureStore 账号层保存，失效重登录复用业务层机制。

目前支持单学生账号登录、学生信息、分页考试列表、成绩、无水印答题卡和逐题明细。多学生账号暂不支持，不按未确认含义的标志自动选择学生，也不调用切换或绑定学生的写接口。

考试列表使用 `/api/v2/exam/GetStuExamList`，Provider 将统一 `offset` 转成 20 条一页的 `pageIndex`、`pageSize`。查询详情前调用 `/api/v2/exam/CheckExamState`，确认考试标识及 `isAllowQuery`，再调用 `/api/v2/Score/GetStuSubScores`（`source: 1`）。成绩请求头包含 `stuId`、`exam_no`、`exam_pno`；`examPno` 为零时按官方 H5 规则发送空字符串，不能发送 `"0"`。

按官方页面语义处理 `showScore`、`scaleScore`、`giveScore`、`rawScore`：隐藏或缺失的分数不转成零，赋分科目保留原始分。`statType=1` 的赋分行在 ID 为原科目 ID 加 `v`、名称与原科目一致时合并，以原科目名称和 ID 作为详情、逐题明细和答题卡入口；主分数显示赋分，并保留原始分。科目满分取官方 `subScore`；人数及排名保持未提供，不求和推算总分。考试日期展示为 `YYYY-MM-DD`，去掉接口附带的时间。

实际成功响应中的 `pageIndex/pageSize` 可以都是 0，这些占位值不用于拒绝响应；非零回显仍需与请求一致，`count` 用于结束加载。列表中的 `isAllowQuery=false` 也可能是占位值，同一考试的 `CheckExamState` 可以返回 true，因此列表不据此禁用点击；详情中的实际查询限制必须遵守。

答题卡使用 `/api/v1/Score/GetStuAnswersheet`，只接受 `https://data.wylkyj.com/AnswerSheet/` 下的官方签名图片地址。`statType=5` 且带 `mergeSubInfo` 时，按官方页面使用合并科目的 `esubNo`。返回 `watermarked: false`，这些图片没有评分水印，不用于推算逐题得分。签名 URL 由 TanStack Query 管理，重新查询可以获取新的临时地址。

逐题明细来自 `https://onlinexam.wylkyj.com/api/v1/subject/GetSubQueList`。该域不复用查询 Token，按本人已绑定考试调用 `student/StuLogin` 换取独立 JWT，字符串字段为 `examNo/gradeNo/schNo/stuNo`，`platform: 0`、`deviceId: 'MagicMirror'`。JWT 放在 `token` 头，不能放在 `Authorization`。JWT 只在 Provider 内存中缓存，按查询会话、学生、考试及考号隔离，校验声明归属和过期时间；内容数据继续由 TanStack Query 缓存。

查询题目之前确认考试学生信息中的 `isPassWord`；需要考试密码时提示到官方 App 查看，不请求密码校验接口。考试 Token 失效时只重换一次，不将查询 Token 标记失效。客观题映射题号、满分、得分和作答，保留零分及多选部分得分；主观题 `stuScore=-1` 保持缺失。答案数组规范化为展示字符串，题干 HTML 不注入界面。

单科详情的题型汇总使用 `questionScoreSummaries`：客观题得分为小题得分合计，主观题总得分为该科原始分减客观题合计，内部保留 `inferred: true`，页面在明细分组标题显示“客观题（得分/满分）”“主观题（得分/满分）”。仅在小题分类、满分完整、满分合计与科目满分一致、全部客观题得分有效、原始分有效且差值处于主观题满分范围内时提供汇总。赋分科目必须使用原始分，不能用赋分代替；允许零分，消除浮点尾差。题组不重复计入，汇总不受“只看错题”筛选影响，也不分配到主观小题。

响应经 Zod 校验，业务码 `401/101/701/702/705` 表示登录失效。`-1000` 有多种含义，结合提示区分权限限制、登录错误和其他错误，不能统一归为失效或付费。网络故障不触发凭据失效。`auth/LogOff` 是注销账号，Provider 的 `logout` 不调用该接口。

2026-10-06 已用实际 Provider 代码只读直连验证登录、学生详情、考试列表、成绩、三个科目的逐题明细及两页答题卡；签名图片 GET 返回 HTTP 200、`image/png`。HEAD 请求不适合作为签名图片可用性的判据，因为签名可能限定 GET。真实认证值、学生信息和成绩没有写入源码或测试；测试全部使用虚构数据。Android 真机界面验收仍需使用最终构建执行。

## 能力与限制

| 能力 | 范围 |
| --- | --- |
| 登录、学生信息 | 账号密码登录；暂限仅绑定一个学生的账号 |
| 考试、成绩 | 本人正常可查询的已绑定考试；遵守学校查询及分数展示开关 |
| 逐题明细 | 当前账号有权读取的在线考试数据；客观题有得分，主观题可能仅有满分 |
| 答题卡 | 官方无水印扫描图，可使用现有放大及保存入口 |
| 排名、考生人数、分析报告 | 暂不提供未经验证或受权益限制的数据 |
| 认领、答题、作业、商城 | 未接入，不执行绑定、提交、购买或广告解锁 |

查询 Token 失效由账号业务层恢复；新考试 Token 的登录或校验被拒绝只报告考试访问限制，不误触发主账号重登录。JWT 不持久化，重启 App 后需要时重新获取。跨账号内容隔离继续使用现有 TanStack Query 的账号 ID 和 revision。

## 验证与复现

离线检查为 `npm run lint`、`npm run typecheck`、`npm test`。`src/__tests__/zhuxuebang.test.ts` 使用虚构信息覆盖分页占位、查询权限、原始分/赋分、字段校验、图片域名、会话归属、过期和权益限制。

人工联网检查位于 `src/__tests__/zhuxuebang.live.check.ts`，默认不运行。只在本人账号授权下，将 `ZHUXUEBANG_ACCOUNT`、`ZHUXUEBANG_PASSWORD` 放入当前进程环境，再执行：

```powershell
npx jest --runInBand --runTestsByPath src/__tests__/zhuxuebang.live.check.ts --testMatch '**/zhuxuebang.live.check.ts'
```

脚本只登录及读取现有考试，不认领或提交答案；仅输出数量和可用性，不输出身份、分数、Token、签名 URL。结束后清除当前进程的这两个环境变量。不同账号若缺少可查询考试或逐题明细，脚本可能失败，不能把这种账号条件误判为结构解析通过。

## Android 人工验收

1. 在设置中添加账号，平台选择项及选中按钮应显示“助学帮（五岳阅卷）”，登录并保存后主界面及账号列表显示“助学帮”。
2. 打开已有考试，对照官方 App 核对考试名称、日期、科目、总分和原始分/赋分；点击列表中可查的考试应能进入详情。
3. 打开语文、数学或英语单科，核对题号、客观题满分/得分及答案；主观题未提供得分时只能显示满分，不能显示零分。测试“只看错题”。
4. 从单科进入答题卡，核对页数和本人扫描内容；测试双击放大及长按保存。图片过期后使用“重新获取答题卡”。
5. 切换其他账号再切回，重启 App 后再次查询，确认数据及会话不串用。网络中断应提示网络错误，不能被当作密码错误。

这些步骤仍需在最终 Android 安装包上执行；Node 直连和 Hermes bundle 导出不能替代真机界面验收。
