# 海豚阅卷 Provider

Provider ID 为 `haitunyuejuan`，名称为“海豚阅卷”。

设备直接访问官方学生端服务 `https://student-api.haitunyuejuan.com`，手机号密码经 `POST /api/student/v1/auth/login`（JSON `{"phone","password","code":""}`）登录。全部接口为统一信封 `{"errno","errmsg","data","traceId"}`，`errno=0` 为成功。请求固定携带与官方小程序一致的 User-Agent（实测服务端当前不校验 UA，保持一致以降低风控收紧风险）。认证信息使用项目现有 SecureStore 账号层保存，失效恢复复用业务层机制。

## 会话与刷新

accessToken 为 JWT，有效期仅 900 秒；Provider 按 `expiresIn` 设置会话 `expiresAt`（提前 30 秒），过期后由账号业务层自动恢复：

1. 优先调用 `POST /api/student/v1/auth/refresh`（body `{"refreshToken"}`）。refreshToken 是**一次性令牌**，刷新后旧令牌立即作废（实测复用旧令牌返回 errno 401「刷新令牌已失效或被重复使用」），因此 Provider 把下发的 refreshToken 写回会话上下文并交由业务层持久化。
2. 刷新失败（errno 401，HTTP 仍为 200）时回退为保存的密码重新登录。

「登录已失效」存在两种形态：数据接口返回 HTTP 401 + errno 401，刷新接口返回 HTTP 200 + errno 401；Provider 统一按 errno 判定。手机号或密码错误返回 errno 401 +「手机号或密码错误」，登录路径将其映射为凭据错误而非会话过期。

一个账号可绑定多个学生；Provider 登录时选取 `default=1`（否则第一个）绑定并缓存 `bindingId`/`studentId` 到会话上下文。首页右上角的学生菜单可列出并切换绑定学生；切换会更新当前账号会话与查询缓存，账号密码不会重复保存。

## 能力映射

| 统一模型 | 平台接口 | 说明 |
| --- | --- | --- |
| 学生信息 | `GET /students` | 取默认绑定；学校、年级来自绑定信息 |
| 考试列表 | `GET /exams` | 无分页参数，Provider 在内存中按 5 场一页切片 |
| 成绩 | `GET /exams/{examId}/subjects` | 首行为总分汇总（`subjectId=0`、科目名为空）；科目 `score` 是字符串（如 `"107.00"`）。`classRank/gradeRank` 映射名次，`beatGrade` 映射 `gradePercentile`（“超过 X%”），班级/年级均分进入科目 `providerContext` |
| 科目明细 | `GET /exams/{examId}/subjects/{subjectId}/detail` 与 `/small-scores` | `paperBrief` 映射客观/主观题小结；小分 `tihao`（如 `1.1`、`2.15.1`）作题目标识，`questionType` `1`/`2` 映射客观/主观，客观题带 `stuAnswer`/`answer`；小分缺失不阻断科目页，仅提示 |
| 答题卡 | `GET /papers/{subjectId}/answer-sheet` | `imgs[]` 为 `ossimage.haitunyuejuan.com` 的 **http 免鉴权直链**，URL 即访问凭据；Provider 只对平台自有域名（`haitunyuejuan.com`）的直链把 scheme 升级为 https 再交给界面——App 的 Android 网络安全配置禁止明文流量（见 `plugins/with-report-network.js`，仅放行百分智），而该 OSS 主机实测同样支持 https；返回 `watermarked: false`。官方客户端的分数标注（“10分/15分”等）是覆盖层渲染，原始扫描件不含，因此不提供带水印版本 |

`ranking` 能力声明为 true（班级/年级名次），但平台不提供参考人数，`Ranking.total` 保持缺失。`score-history`（跨考试趋势）与 `insight`（AI 诊断，受会员功能门控）暂未接入。

## 能力与限制

| 能力 | 范围 |
| --- | --- |
| 登录、学生信息 | 手机号密码登录；默认选择官方标记的学生，可在首页切换绑定学生 |
| 考试、成绩 | 本人正常可查询的考试；遵守平台会员功能门控 |
| 名次 | 班级/年级名次（无参考人数）；`beatClass/beatGrade` 百分比保留在科目上下文 |
| 逐题小分 | 客观题含我的作答与正确答案；主观题仅有得分 |
| 答题卡 | 免鉴权扫描图（平台直链已升级为 https），无水印版 |
| 趋势、AI 诊断、会员购买、写操作 | 未接入 |

`code` 登录字段的用途（疑似验证码/邀请码）未确认，固定传空字符串。`member/status` 是小程序端的会员功能门控接口，Provider 不调用它，数据接口当前不要求先过该检查（非会员账号实测可取全部已接入数据）。

## 验证与复现

离线检查为 `npm run lint`、`npm run typecheck`、`npm test`。`src/__tests__/haitunyuejuan.test.ts` 使用虚构信息覆盖登录/刷新/错误映射、总分汇总行、字符串分数、题型映射、小分缺失降级、答题卡直链、会话注销与注册能力真实性。

人工联网检查位于 `src/__tests__/haitunyuejuan.live.check.ts`，默认不运行。只在本人账号授权下，将 `HAITUN_ACCOUNT`、`HAITUN_PASSWORD` 放入当前进程环境，再执行：

```powershell
npx jest --runInBand --runTestsByPath src/__tests__/haitunyuejuan.live.check.ts --testMatch '**/haitunyuejuan.live.check.ts'
```

脚本只登录及读取现有数据（含一次 refreshToken 轮换），不输出身份、分数、Token、图片地址。抓包分析产物位于 `analysis/haitun/`（已 gitignore，含真实个人信息，不得提交）。

2026-10-09 已用实际 Provider 代码只读直连验证：登录、学生信息、考试列表、成绩（含名次）、科目明细（27 题）、答题卡（2 页）与刷新链路全部通过。协议细节另见抓包与探测记录 `analysis/haitun/`。

## Android 人工验收

1. 添加账号，平台选择“海豚阅卷”，手机号+密码登录成功后主界面显示考试列表。
2. 打开一场考试，核对科目、总分、满分、班级/年级名次与官方小程序一致。
3. 进入单科，核对逐题小分题号、客观题我的答案/正确答案、客观/主观题小结；测试“只看错题”。
4. 进入答题卡，确认图片正常加载（Provider 已把平台下发的 http 直链升级为 https）、页数正确；测试放大与保存。
5. 账号放置超过 15 分钟后再查询，确认自动刷新无感恢复（不要求重输密码）；重启 App 后会话仍可用。
