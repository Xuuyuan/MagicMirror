# GitHub Actions 自动发版

日常 main 提交和 PR 运行 `quality`，不签名、不发布。`Android release` 工作流有两个入口：

- Actions 页面选择 **Run workflow**，使用 main：检查、构建并签名各架构组的 APK，仅保存 `android-release` Artifact，保留 7 天。
- 推送 `v*` 标签：执行同样的检查和构建，随后创建 GitHub Release，上传全部 APK 和 `SHA256SUMS.txt`。标签必须属于 main 历史，且与工程版本一致。

## 发布产物

每个版本按架构组各出一个包，App 检查更新时按设备架构挑选，取不到架构信息（或没有对应包）时回退 `all`：

| 架构组 | 文件名 | ABI |
| --- | --- | --- |
| arm64-v8a | `MagicMirror-<版本>-arm64-v8a-signed.apk` | arm64-v8a |
| x86_64 | `MagicMirror-<版本>-x86_64-signed.apk` | x86_64 |
| all | `MagicMirror-<版本>-all-signed.apk` | arm64-v8a, armeabi-v7a, x86, x86_64 |

三个包的 `versionCode` 相同（都是 `app.json` 里的值），发版校验会逐个确认包名、版本、versionCode、非 debuggable，以及**该变体自己的 ABI 集合**。

## 一次性配置

使用现有发布密钥，保持与 beta5 的签名一致。仓库 Settings → Secrets and variables → Actions 需要三个 Secrets：

| Secret | 内容 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | 发布 `.p12` 文件的 Base64 |
| `ANDROID_KEYSTORE_PASSWORD` | 密钥库密码 |
| `ANDROID_KEY_PASSWORD` | 私钥密码，通常与密钥库密码相同 |

Windows 下可运行以下命令。脚本会安全提示输入密码，先在本地验证签名与证书，再通过已登录的 GitHub CLI 配置这三个 Secrets；不会把密码写入文件或命令参数。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/configure-release-secrets.ps1
```

默认密钥位于 `%USERPROFILE%\AndroidSigning\magicmirror-release.p12`，也可通过 `-KeystorePath` 指定。脚本固定配置 `Xuuyuan/MagicMirror`，需已运行 `gh auth login`，且本地存在用于验证的 release APK。

工作流固定校验 beta5 发布证书的 SHA-256 指纹。将来主动更换签名密钥时，需要同时调整工作流及配置脚本中的预期指纹，并单独处理用户安装升级兼容性。

## 每次发布

1. 同步 `package.json`、`package-lock.json` 和 `app.json` 的版本，例如 `1.0.0-beta.6`。
2. 提高 Android `versionCode`，必须大于所有已发布版本；更新 `diagnosticsBuild`。
3. 为 CHANGELOG 新增 `## 1.0.0_beta6 — 日期`，至少包含一条改动；正式版标题为 `## 1.0.0 — 日期`。
4. 提交并推送 main。第一次接入时先手动试跑，下载 Artifact，验证能够覆盖安装 beta5。
5. 确认准备发布后，创建并推送对应标签：

```bash
git tag -a v1.0.0-beta.6 -m "1.0.0_beta6"
git push origin v1.0.0-beta.6
```

工作流从对应 CHANGELOG 段落提取说明。alpha、beta、rc 版本自动标为 Pre-release 且不设为 Latest；正式版本设为 Latest。不要把手动试跑当作已发布版本。

## 构建与失败处理

- GitHub 托管 Ubuntu 24.04，Node 22、Temurin JDK 21、Android SDK 36、Build Tools 36.0.0、NDK 27.1.12297006；Gradle 使用 Expo 生成工程内的 Wrapper。
- `expo prebuild` 从受 Git 管理的配置重新生成原生工程（一次性），随后按架构组各跑一次 `assembleRelease` 并分别签名；`with-release-build` 固化 R8 与资源压缩配置；Windows 本地构建入口保持不变。
- lint、类型检查、应用离线测试与发版脚本测试通过后才构建。发布前逐个检查 APK 包名、版本、版本码、该变体的 ABI 集合、非 debuggable 状态、签名及预期证书，并生成 SHA-256。
- 云端检查使用 `Asia/Shanghai` 时区，与既有离线测试的固定日期一致；App 的设备本地时区日期显示行为保持不变。
- 签名 Secrets 仅用于构建 job 的配置检查和签名步骤。密钥还原到 runner 临时目录，清理步骤即使失败也运行；不上传密钥、不缓存密钥。
- 发布 job 单独获得 `contents: write`，使用工作流的 `GITHUB_TOKEN`，不需要个人 PAT。
- 发布先创建草稿，上传并校验附件后再公开。上传失败可重跑未发布的草稿；同版本已经发布则停止，不覆盖已发布附件。重试草稿前确认其属于本次工作流。
- 私有期间 Release 仅限有仓库读取权限的人访问；仓库公开后，同一流程可供公众下载。公开前确保 Secrets 正确配置，且从未将密钥或密码提交到历史中。

首次云端试跑可能暴露 Linux／runner 环境差异。本地检查通过不等于 Actions 试跑或设备验收通过。

## 本地验证更新流程

验证 App 的更新提示、下载与安装界面时，不要为此改动云端已发布版本，而是临时降低本地版本：

1. 同步降低 `package.json`、`package-lock.json`（两处）与 `app.json` 的版本及 `versionCode`，使其低于云端最新版本。`check-release.ps1` 要求三者一致，不一致会直接构建失败。
2. `npm run build:debug:mumu` 构建 MuMu 调试包。MuMu 是 x86_64，并靠原生桥接运行 ARM 包；只含 arm64-v8a 的包能装上但启动即白屏，因此调试包固定使用 x86_64。发布包按架构组各出一个，真机取 `arm64-v8a` 那个。
3. `npm run android:mumu` 会用 `adb install -r -d` 安装当前版本的调试包（`-d` 允许 `versionCode` 回退），随后启动 Metro 并打开 App。安装失败会直接抛错；APK 缺少设备架构时会先警告再安装，不会静默使用旧包。加 `-SkipInstall` 可跳过安装。
4. 在 App 中依次验证：启动后的更新弹窗 → 下载并校验 SHA-256 → 安装按钮 → 系统安装界面。

调试包使用自动生成的 debug 签名，与发布包签名不同，覆盖安装必然冲突，因此验收以“进入系统安装界面”为终点，不要继续确认安装。

安装界面出现前可能先弹出应用选择框（其他 App 也声明了处理 APK），选择“软件包安装程序”即可。该流程依赖 `app.json` 中声明的 `android.permission.REQUEST_INSTALL_PACKAGES`；缺少该权限时系统会拒绝安装请求，日志表现为 `InstallStart: ... needs to declare permission android.permission.REQUEST_INSTALL_PACKAGES`。

验证完成后，必须把三处版本号与 `versionCode` 改回云端版本，避免误发布。
