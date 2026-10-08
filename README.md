# MagicMirror 魔镜

**Filter out the dross; see yourself for who you are.**

## 这是什么？

这是开源的多阅卷平台聚合成绩查询 Android APP。如果你在使用以下阅卷平台的官方 APP 时有下列困扰，不妨尝试一下：

1. 官方 APP 广告多！ —— 开屏广告、弹窗广告、开会员提示…相信你肯定遇到过。
2. 学校使用的阅卷平台很多，东下一个、西下一个，无意中占据了很多宝贵的存储空间。
3. 官方 APP 查询信息不全，明明有开放但很难找着入口。
4. 需要查询多人成绩或频繁切换账号的特殊情况。

本项目已实现以下 Provider：

| Provider | 登录方式 | 已实现内容 |
| --- | --- | --- |
| 好分数学生版 | 账号密码 / Token | 成绩查询、答题详情、答题卡图片 |
| 好分数家长版 | 账号密码 / Token | 成绩查询、答题详情、答题卡图片 |
| 七天学堂（七天网络） | 账号密码 | 成绩查询、考试认领、答题详情（卡面形式）、答题卡图片、作文统计、选项与得分区间分布 |
| 助学帮（五岳阅卷） | 账号密码 | 成绩查询、答题详情（仅支持客观题）、答题卡图片 |
| 睿芽 | 账号密码 | 成绩查询、排名查询、学科表现、分数线、答题卡图片、答题详情、知识章节、学习能力、题组得分率、章节概览 |
| 百分智 | 账号密码 | 成绩查询、排名查询、学科表现、分数线、答题卡图片、答题详情、知识章节、学习能力、题组得分率、章节概览 |

### 声明

1. 本项目为客户端直接请求对应平台官方服务，不建设转发后端，亦不在第三方存储、处理任何数据。
2. 本项目所扮演的角色仅为各 Provider 所对应的平台的第三方客户端，访问的接口均为平台公开接口。
3. 本项目遵循 Apache 2.0 License 开源。

## 技术栈

感谢 GPT-6 Astra、GPT-6.1 Sol、DeepSeek-V4.1-Flash、GLM-5.3-Flash（排名不分先后）。**本项目 100% 的源代码由 AI 生成**，包括以下这行也是：Expo、React Native、TypeScript strict、Expo Router、TanStack Query、Zustand、Zod、expo-secure-store。

## 如何使用？

### 发布版本

访问 [Releases](https://github.com/Xuuyuan/MagicMirror/releases)。

### 以源码运行（调试）

```bash
npm install
npm run start
```

用 Expo Go 扫描终端二维码，或执行 `npm run android` 启动 Android 模拟器/已连接设备。

MuMu 调试使用 `npm run android:mumu`，会连接 Expo 调试服务并打开 App。`npm run web` 用于浏览器界面调试；`npm run doctor` 用于诊断 Expo 环境和依赖。`lint`、`typecheck`、`test` 保留为可单独运行的检查入口，`npm run check` 一次执行这三项。

### 以源码构建 APK

在已安装 Android SDK、JDK 和 Node.js 的 Windows 环境中执行：

```powershell
# 调试版：不需要发布密钥或密码
npm run build:debug

# 发布版：构建并使用发布密钥签名
npm run build:release
```

调试版输出 `dist/MagicMirror-<版本号>-debug.apk`，使用 Android 自动生成的 debug 签名，运行时需连接 Metro。发布版依次执行 lint、类型检查、离线测试、版本一致性检查、Android 构建、正式签名和签名校验；终端提示时输入发布密钥密码，输出 `dist/MagicMirror-<版本号>-signed.apk`。两者默认只构建 ARM64，并输出 SHA-256。

默认复用 `%USERPROFILE%\AndroidSigning\magicmirror-release.p12`，密钥别名为 `magicmirror`。密码不写入脚本、Git 或日志；校验通过后才替换同名发布包。请长期备份并复用同一份发布密钥。

日常检查只需：

```powershell
npm run check
```

特殊构建使用参数，不再提供多套重复 npm 命令：

```powershell
# 重建生成的 Android 工程后再签名打包
npm run build:release -- -Clean

# 构建包含所有 ABI 的包
npm run build:release -- -Architectures all

# MuMu 的 x86_64 调试包
npm run build:debug -- -Architectures x86_64
```

也可用 `-KeystorePath`、`-KeyAlias`、`-OutputPath` 指定密钥、别名和输出路径。每次发布提高 `android.versionCode`，并同步 `app.json`、`package.json` 和 `package-lock.json` 的版本；检查脚本自动读取当前版本。`dist/` 和生成的 `android/` 不提交到 Git。直接双击 `tools/build-apk.cmd` 也会构建并正式签名，但不执行 npm 质量检查。

## 测试边界

`npm test` 只运行离线单元测试和虚构数据测试，不会访问真实平台。`src/__tests__/septnet.live.check.ts` 和 `src/__tests__/zhuxuebang.live.check.ts` 是需要联网和本人账号的人工真实服务冒烟脚本，因命名不含 `.test` 默认不参与 Jest；执行前必须确认账号授权、网络环境和只读范围，输出只保留字段形状与数量，不应打印姓名、学校、成绩、Cookie 或 Token。架构细节见 [`docs/`](./docs/)。
