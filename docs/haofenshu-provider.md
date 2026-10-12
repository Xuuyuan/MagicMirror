# 好分数 Provider

- 平台名称：好分数（学生版 / 家长版，分别对应 `haofenshu-student` / `haofenshu-parent`）
- 官方域名：接口 `https://hfs-be.yunxiao.com`；官方 H5 页面 `https://mobile.haofenshu.com`
- 登录方式：账号密码。当前已验证可用的 H5 登录请求体为 `{ loginName, password(明文), roleType, rememberMe: 1 }`，其中学生版 `roleType=1`、家长版 `roleType=2`；请求头按当前官方形态
  （浏览器 UA 尾缀 `HFS_XS`/`HFS_JZ` + `version=`、`Origin`/`Referer: https://mobile.haofenshu.com/`、`Content-Type: application/json`）。
  登录响应返回 `token`，此后同时作为 `hfs-token` 请求头与 `hfs-session-id` Cookie 使用。
- 请求形态：登录与所有接口统一使用同一套 H5 形态请求头（浏览器 UA + `hfs-token` + `hfs-session-id` Cookie + Origin/Referer），
  不要混用原生客户端请求头（`deviceType`/`appType`/`versionName`、`YX Android …` UA）或自行拼接未知头。

## 风控处理

- 登录与后续查询保持一致的官方 H5 请求形态。
- 考试档案缓存未命中时，先调用 `/v2/config/school/hidden-config` 探测访问限制，再请求档案；探测失败不阻断后续查询。
- `code=1` 且提示含“风险”或“锁定”时，视为访问受限，不自动重新登录。
- 遇到受限请停止连续重试，等待恢复或前往官方 H5 / App 处理；恢复时间不固定。

## 支持能力

学生信息、考试档案（考试列表，`/v4/exam/archives?grade=`）、成绩总览
（`/v4/exam/overview`，失败时降级旧版 `/v3/exam/{examId}/overview`）、班级/年级/联考排名、科目详情与题目得分、答题卡。
考试档案按「会话 + 当前学生」隔离缓存 15 分钟，分页在内存中切片，每页 5 场。

科目详情通过现有 `answer-picture` 的逐题 `type`、`score`、`manfen` 生成 `questionScoreSummaries`，学生版与家长版共用实现，不增加请求。不使用总分差值推算主观题得分：仅在所有题目分类、得分与满分有效、题目 ID 不重复、逐题满分和得分合计分别与科目满分和得分一致时，按客观/主观分别累计。零分保留，小数消除浮点尾差；缺失、负分哨兵、部分数据或赋分口径不一致时不生成汇总，也不伪造不存在的题型。页面汇总不受“只看错题”筛选影响。

## 多学生切换（家长版）

家长版账号可以绑定多个孩子：`haofenshu-parent` 实现 `getProfiles` / `selectProfile`，首页右上角列出并切换绑定学生
（只有一个孩子时不显示该入口）。学生版（`roleType=1`）没有这两个端点的验证样本，不提供切换能力。

| 统一模型 | 平台接口 | 说明 |
| --- | --- | --- |
| 关联学生 | `GET /v2/user-center/related-students` | 行含 `studentId`（24 位带前导零的**字符串**）、`studentName`、`grade`、`class`、`schoolName` 等；列表**不含“当前学生”标记**；未绑定时平台返回 `code=1`，按空列表处理 |
| 切换当前学生 | `POST /v2/user-center/sessions` | body `{ deviceType: 1, studentId }`；`code=0` 的「切换学生成功」与「无需切换」都算成功，回显的学生与目标不一致时报错；未绑定的学生返回 `code=4108`，映射为 `NOT_FOUND` 并透出平台原因 |

**“当前学生”是账号级服务端状态，不是会话级**（2026-10-12 实测，记录见 `analysis/haofenshu/switch-semantics-20261012.md`，本地未入库）：

- 切换后 Cookie 不变：响应虽然带 `Set-Cookie`，但值与请求令牌完全相同，旧令牌继续可用。
- 用密码新建的会话直接落在**上次切换到的孩子**（不是默认绑定学生），两个独立会话共享同一状态 → 在 MagicMirror 里切换也会改变官方 App 的当前孩子，反之亦然。登录响应的 `studentId` 即当前孩子，Provider 直接写进会话上下文。
- 因此 `getProfiles` 的 `selected` 以 `user-snapshot.linkedStudent.studentId` 为准（发现与本会话记录不一致时顺手清掉档案缓存）；只有一个孩子时不请求 `user-snapshot`。
- 账号里保存的选择用于重登后重放：会话失效重新登录时按保存的孩子再切一次，因此不会退回默认孩子。

## 已知限制

- 只查询账号已绑定的孩子的数据，不查询他人数据；`/v2/user-center/user-snapshot` 的 `linkedStudent` 为空时提示先在官方 App 绑定。
- 在官方 App 里切换孩子后，本端最长 15 分钟的档案缓存内可能仍显示上一个孩子的分数/名次（首页挂载时的学生列表查询会清掉缓存，通常很快纠正）。
- 排名数值字段（`classRank`/`gradeRank`/`groupRank`）恒为 `-1` 哨兵，只采用官方展示串
  （`classRankS` 等，支持 `1~20/42人`、`250～300`、字母等第、`3/40人` 等形态）；屏蔽值 `**` 一律隐藏，不推测名次。
- 学生版与家长版的 UA 后缀、`versionName`、`roleType` 不同（学生：`HFS_XS`/`4.31.81`/1；家长：`HFS_JZ`/`3.32.81`/2）。
- 会话与密码只保存在设备安全存储；注销只撤销本地会话（官方注销为空操作，不发服务端请求）。
- 官方 H5 页面判断"是否绑定学生"用严格相等 `linkedStudent.isVirtual === 2`，且页面 `userInfo` 直接取
  `/v2/user-center/user-snapshot` 的 `data`；桥接与数据形态需保持原样透传。

## 诊断入口（开发用，非业务必需）

Provider 暴露 `getOfficialH5Bootstrap`（用当前会话打开官方考试档案页）与 `getOfficialH5LoginEntry`
（打开官方 H5 登录页，由页面自建会话）；配合 `/haofenshu-webview` 页面内的探针（桥接调用元数据、页面请求路径标签、
状态码、业务码、风控命中、请求头名）与「复制脱敏诊断」在真机上对照排查。
探针只记录白名单元数据，不记录请求体、响应体、认证头或令牌；该入口只影响 UI 上的一个菜单项，可随时移除。
