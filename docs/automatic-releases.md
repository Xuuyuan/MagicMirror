# GitHub Actions 自动发版

日常 main 提交和 PR 运行 `quality`，不签名、不发布。`Android release` 工作流有两个入口：

- Actions 页面选择 **Run workflow**，使用 main：检查、构建并签名 ARM64 APK，仅保存 `android-release` Artifact，保留 7 天。
- 推送 `v*` 标签：执行同样的检查和构建，随后创建 GitHub Release，上传 APK 和 `SHA256SUMS.txt`。标签必须属于 main 历史，且与工程版本一致。

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
- `expo prebuild` 从受 Git 管理的配置重新生成原生工程。`with-release-build` 固化 ARM64、R8 与资源压缩配置；Windows 本地构建入口保持不变。
- lint、类型检查、应用离线测试与发版脚本测试通过后才构建。发布前检查 APK 包名、版本、版本码、ARM64 架构、非 debuggable 状态、签名及预期证书，并生成 SHA-256。
- 云端检查使用 `Asia/Shanghai` 时区，与既有离线测试的固定日期一致；App 的设备本地时区日期显示行为保持不变。
- 签名 Secrets 仅用于构建 job 的配置检查和签名步骤。密钥还原到 runner 临时目录，清理步骤即使失败也运行；不上传密钥、不缓存密钥。
- 发布 job 单独获得 `contents: write`，使用工作流的 `GITHUB_TOKEN`，不需要个人 PAT。
- 发布先创建草稿，上传并校验附件后再公开。上传失败可重跑未发布的草稿；同版本已经发布则停止，不覆盖已发布附件。重试草稿前确认其属于本次工作流。
- 私有期间 Release 仅限有仓库读取权限的人访问；仓库公开后，同一流程可供公众下载。公开前确保 Secrets 正确配置，且从未将密钥或密码提交到历史中。

首次云端试跑可能暴露 Linux／runner 环境差异。本地检查通过不等于 Actions 试跑或设备验收通过。
