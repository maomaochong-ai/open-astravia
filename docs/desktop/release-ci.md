# 发版下载与失败恢复

实现入口：[desktop-release.yml](../../.github/workflows/desktop-release.yml)。

## 各平台构建完即发布安装包，全部成功后自动上线更新清单

流水线先执行 `prepare` → `quality`，再并行构建 `build <platform>` 与正式渠道的 `android`。
桌面全部平台成功后执行 `promote`；Android 独立发布，不参与桌面更新清单上线的门禁。每个桌面平台构建成功后在同一个任务里：

1. 校验更新清单与安装包（`verify-update-artifacts`，macOS 含签名与公证）；Windows 的校验会真实安装一遍，发版跳过。
2. 上传 Actions 制品 `desktop-<platform>`（安装包、blockmap 与 `latest*.yml`，保留 30 天）。
3. R2 目标：安装包与 blockmap 上传到 `<prefix>/`（如 `desktop/stable/`），更新清单只上传到
   `<prefix>/pending/<版本>/`。安装包按版本命名、不会被已安装的客户端读到，所以可以先传。
4. 非 test 渠道：第一个完成的平台创建 GitHub Release（正文取发布说明），其余平台追加安装包与 blockmap；
   不上传 `latest*.yml`。

因此不再等四个平台全部完成才开始发布，Release 页面会随各平台完成逐步补齐，刚创建时只有先完成的平台的安装包。

R2 目标在**全部平台构建成功后**由 `promote` 任务自动调用 desktop-promote 上线清单，用户从这时开始收到新版本：

- 任一平台失败时 `promote` 跳过，线上清单保持旧版本；修好后在原运行里 **Re-run failed jobs**，
  失败的平台和 `promote` 会一起重跑。也可以先手动运行 desktop-promote，只上线已经成功的平台。
- 手动发版（`workflow_dispatch`）可取消勾选 `auto_promote`，构建完只暂存清单，之后再手动上线。
- 以 GitHub Release 为更新源的构建（开源版）没有 R2 暂存目录，不会自动上线，需要按下文手动处理。

### 上线更新清单：desktop-promote

发版流程会自动调用它；需要手动上线（关闭了自动上线、只上线部分平台或重新上线）时，在 **Actions → desktop-promote → Run workflow** 填写：

| 输入 | 说明 |
| --- | --- |
| `version` | 要上线的版本，如 `0.5.60` |
| `channel` | `stable`、`test` 或 `default`（沿用仓库变量 `VETTA_RELEASE_CHANNEL`），决定 R2 目录与更新地址，解析规则与发版相同 |
| `platforms` | 默认 `windows,mac,linux`；只写部分平台时，其余平台的线上清单保持不变 |
| `dry_run` | 只校验不发布，可先勾选跑一次看结果 |

[desktop-promote](../../.github/workflows/desktop-promote.yml) 依次：

1. 从 `<prefix>/pending/<版本>/` 取出所选平台的清单；macOS 必须两个架构都在，合并成 `latest-mac.yml`。
2. 核对每份清单的版本号，以及清单引用的每个安装包都已在 `<prefix>/`，且 sha512 与大小和上传时记录的一致。
3. 拒绝让线上清单降级（线上已是更高版本时失败）。
4. 上传到 `<prefix>/`，并通过公网地址复核清单与安装包可访问；CDN 有 60 秒缓存，复核会自动重试。
5. 非 test 渠道把同一份清单附到 `v<版本>` 的 GitHub Release。

有 R2 凭据时也可以在本地执行同一脚本：先设置 `VETTA_R2_ACCOUNT_ID`、`VETTA_R2_ACCESS_KEY_ID`、
`VETTA_R2_SECRET_ACCESS_KEY`、`VETTA_R2_BUCKET`、`VETTA_R2_PREFIX`、`VETTA_UPDATE_URL`，再运行
`bun run --cwd apps/desktop promote:updates:r2 -- --version <版本> [--platforms mac] [--dry-run]`。

以 GitHub Release 为更新源的构建（开源版）没有 R2 暂存目录，需从 Actions 制品取回清单、
用 `merge:updates:mac` 合并后手动上传到 Release。

## 同期 Android APK

正式桌面发版（匹配桌面版本的 `v*` tag，或会发布的非 test 手动发版）会从同一提交构建 Android Release APK。
运行 Android host tests 后，核对 APK 的应用 ID、Release 构建类型及 Android 自己的版本名与版本代码，并使用 `apksigner` 验证签名。
只构建 `gradle.properties` 中 `vettaAndroidAbi=arm64-v8a` 指定的 64 位 ARM APK，
以 `Vetta-arm64-v8a.apk` 上传到同一个 GitHub Release，文件名不附桌面版本或 `android`。
APK 只包含 arm64-v8a 原生库，同时保留 30 天的 Actions 制品 `apk`。本地 Debug 构建保持原有通用 APK；
本地需复现发布构建时使用 `./gradlew --no-daemon -PvettaSplitApks=true :androidApp:assembleRelease`。
R2 桌面发布也会上传 APK 到 GitHub；APK 不进入桌面更新清单或 R2 安装包目录。test 渠道与不发布的手动构建不运行此任务。

### 首次配置固定签名

在 GitHub 的 `desktop-production` Environment 中配置以下 Secrets（也可使用同名仓库 Secrets）：

| Secret | 内容 |
| --- | --- |
| `VETTA_ANDROID_KEYSTORE_BASE64` | 固定 JKS 密钥库文件的 Base64 内容 |
| `VETTA_ANDROID_KEYSTORE_PASSWORD` | 密钥库密码 |
| `VETTA_ANDROID_KEY_ALIAS` | 签名私钥的 alias |
| `VETTA_ANDROID_KEY_PASSWORD` | 签名私钥密码 |

密钥只生成一次。例如使用 JDK 的 `keytool -genkeypair -storetype JKS -keyalg RSA -keysize 4096 -validity 10000 -alias vetta-android -keystore vetta-android.jks`，
按提示输入密码并生成密钥库；不要把文件或密码提交到仓库。配置 Secrets 后离线备份密钥库和密码，以后每次发版复用它们。
上传已有密钥之前检查这四个 Secrets，避免替换已经用于分发的签名。CI 不生成新密钥，也不回退到 debug 签名；缺少任一配置时 Android 任务直接失败。
密钥只在 runner 的临时目录解码，任务结束时删除，Gradle 的 Actions 缓存关闭，Actions 制品只含 APK。

Android 的 `versionName` 与 `versionCode` 独立维护在
[`gradle.properties`](../../apps/mobile/client-android/gradle.properties) 的 `vettaAndroidVersionName` 与 `vettaAndroidVersionCode` 中，
桌面发版不改写它们。发布新的 Android 应用版本时调整版本名并递增版本代码；代码为 1–2,100,000,000 的整数。
应用 ID 保持 `org.vetta.android`。先前安装的本地 Debug APK 使用另一把签名密钥，第一次换装正式包需要先卸载 Debug 版，
会清除手机本地的配对和缓存；此后的正式版本可直接覆盖升级。

Android 任务失败不影响已成功的桌面平台发布或桌面更新清单上线。补齐配置后在原运行中重跑失败任务即可，
同一桌面 Release 中的 APK 会覆盖同名附件；Android 也可能先完成并创建 Release，页面会随着桌面平台完成继续补齐。

## 哪一步失败，就重跑哪一步

在原来的 Actions 运行页面选择 **Re-run jobs → Re-run failed jobs**，不要重新 Run workflow，
也不要为重试删除或重推 tag。修复源码需要新提交和新的运行；重跑旧运行仍使用原来的提交和工作流定义。

| 失败位置 | 重跑时执行什么 |
| --- | --- |
| `quality` | 重新检查；通过后开始构建 |
| `build <platform>` | 重做该平台的构建与上传；已经成功的平台不重打 |
| `android` | 重跑 Android 测试、签名构建与 APK 上传；已成功的桌面平台不重打 |

构建矩阵关闭 fail-fast，一个平台失败不影响其他平台发布。重跑时 R2 上内容相同的安装包会跳过，
内容不同则拒绝覆盖；pending 清单与 GitHub Release 的同名文件直接覆盖。
单个平台内部的编译和各安装格式生成是一个构建任务，尚不支持单个安装格式续做。

发布流水线不单独跑平台验收（安装包实装、Windows 补充格式解包、packaged E2E）：
那一段要把未压缩的应用连同安装包一起存成 1 GB 以上的检查点再下载回来，
成本远高于它拦下的问题。packaged E2E 由 PR 上的 `desktop-packaged` 覆盖。

## 下载：不使用 Actions 缓存

发版流水线不恢复也不保存任何 Actions 缓存，每次直接从源头下载：

- Bun 包由共享安装 action 执行 `bun install --frozen-lockfile`；首次失败先保留本次已下载的内容重试，连续失败才清理 Bun 缓存兜底。
- Electron 与 electron-builder 的工具由打包器按需下载。
- 内置 Node/Python 归档、OCR 与语音模型由 `prepare:desktop-pack` 在打包时下载；运行时归档下载后检查可读性，语音模型保留 SHA-256 校验。
- Go 工具链由 `actions/setup-go` 安装，关闭其内置的模块缓存。

曾经的下载缓存（ADR-0120）在 Windows 和 macOS 上得不偿失：约 700 MB 的 Bun 缓存下载只要几秒，
解压却要 2.5～4 分钟，而直接安装只需半分钟左右；默认分支预热还额外占用四种 runner。

Windows 命令沙盒不在本仓库编译：`openvetta/codex` 的 `vetta/windows-sandbox` 分支由
`vetta-windows-sandbox` 工作流测试、编译并在推送 `vetta-sandbox-v*` tag 时发布 Release。
[prepare-windows-sandbox](../../.github/actions/prepare-windows-sandbox/action.yml) 只下载固定 tag 的压缩包，
校验压缩包 SHA-256、manifest 中的源码提交与各二进制哈希，再运行能力探测。升级沙盒时先在
`openvetta/codex` 打新 tag，再同时更新 action 里的 tag、源码提交和压缩包 SHA-256。

正式 workspace 构建继续 `--force`，不启用 Turbo Remote Cache，不跨版本复用签名产物。

GitHub 说明：[重跑工作流](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs)。
