# Desktop Packaging Size Policy

本文记录 `apps/desktop` 构建与打包阶段的体积优化策略。目标是减少发布包中不会被当前运行路径使用的文件，同时避免删除源文件、模型文件或依赖包内容。

## 目标

- 减小 `dist/`、`app.asar`、`extraResources` 和最终安装包体积。
- 保持运行时依赖可解释：每个被排除的文件都应有明确的“不在当前运行路径使用”的依据。
- 优先通过构建复制白名单、electron-builder filter、平台目标筛选来优化，不直接删除仓库内资源或 `node_modules` 源文件。
- 让依赖升级时尽早失败，而不是静默产出缺文件的安装包。

## 主进程 sourcemap

`vite.main.config.ts` 只在 `VETTA_BUILD_ENV=development` 或 Vite mode 为 `development` 时生成 sourcemap。

原因：

- 生产包内的主进程 sourcemap 体积较大，且普通用户运行时不需要。
- 开发构建仍保留 sourcemap，方便调试。

影响：

- 生产 `dist/main` 不再包含 `.map` 文件。
- 生产环境主进程栈追踪不会映射回 TS 源码；需要源码映射时应使用开发构建或专门的调试产物。

## OCR runner 运行时资源

`vite.ocr-runner.config.ts` 的 OCR runner 只复制当前 `onnxruntime-web` 入口实际加载的 ORT WASM 资产：

- `ort-wasm-simd-threaded.jsep.mjs`
- `ort-wasm-simd-threaded.jsep.wasm`

原因：

- OCR 代码通过 `@ocr-web/core` 设置 `runtime: "wasm"` 和 `wasmPaths`，运行时从 `dist/ocr-runner/ort/` 加载 ORT 资产。
- 当前 `onnxruntime-web/dist/ort.mjs` 的构建常量已折叠到 JSEP 变体，未使用 asyncify、jspi、普通 simd-threaded、webgl、webgpu 等其他变体。
- Vite 还会因为 ORT 包内的 `new URL(..., import.meta.url)` 自动输出一份 hashed wasm 到 `assets/`；OCR runner 已显式提供 `wasmPaths`，该 hashed wasm 是重复副本，构建插件会从 bundle 中移除。

维护要求：

- 不删除 `resources/ocr-models` 或 `node_modules/onnxruntime-web` 下的源文件。
- 如果升级 `onnxruntime-web` 后实际加载文件名变化，`requiredOrtFiles` 的构建期断言会让 `build:ocr-runner` 失败。维护者需要重新检查 ORT 入口文件和最终 bundle，再更新白名单。
- 如果未来 OCR runner 改为启用 WebGPU/WebNN/多线程/其他 runtime，必须同步扩展 ORT 资产白名单。

影响：

- `dist/ocr-runner` 不再携带未使用的 ORT WASM/MJS 变体。
- OCR 模型文件仍按原路径复制并打包。

## IM gateway sidecar

`prepare-pack.js` 按目标平台构建和打包 IM gateway，而不是默认打包所有支持平台。

目标平台来源优先级：

1. `VETTA_IM_GATEWAY_TARGET_PLATFORMS`
2. `VETTA_CLI_TARGET_PLATFORMS`
3. `VETTA_VENDOR_PLATFORM`
4. 当前构建宿主平台 `${process.platform}-${process.arch}`

原因：

- Windows、Linux、macOS sidecar 二进制互不通用。
- 单平台安装包只需要对应平台的 sidecar。

影响：

- `dist:win` 等脚本已经设置 `VETTA_VENDOR_PLATFORM` 和 `VETTA_CLI_TARGET_PLATFORMS`，因此会只打包目标平台 sidecar。
- 如需一次构建多个平台的 sidecar，可显式设置 `VETTA_IM_GATEWAY_TARGET_PLATFORMS=win32-x64,linux-x64`。

## Electron locales

`prepare-pack.js` 在 electron-builder 配置中设置：

```json
{
	"electronLanguages": ["zh-CN", "en-US"]
}
```

原因：

- 默认 Electron 会保留所有 Chromium locale `.pak` 文件。
- 当前桌面应用面向中文和英文界面，发布包只需要 `zh-CN` 与 `en-US`。

影响：

- 其他 Chromium 内置 UI 语言资源不再进入安装包。
- 如果产品需要新增系统 UI 语言，应同步扩展 `electronLanguages`。

## Windows 语音输入构建开关

`VETTA_SPEECH_INPUT_ENABLED` 是严格的构建期开关，只接受 `true` 或 `false`，未设置时默认启用。
它与目标平台共同决定语音能力：只有开关启用且目标包含 `win32-x64` 时才构建语音输入。
`build` / `pack` / `dist` 及纯 Node 构建脚本默认统一读取 `.env.production`；开发启动器显式读取
`.env.development`，`dist:*:test` 的 `VETTA_BUILD_ENV=test` 仍优先读取 `.env.test`。Shell 中直接设置的
变量优先级最高。

关闭版 Windows 包示例：

```powershell
$env:VETTA_SPEECH_INPUT_ENABLED="false"
bun run dist:win
```

关闭时构建链路会同时：

- 跳过模型 manifest 读取、下载与校验，不产生网络请求。
- 不复制 `speech-models` extraResources。
- 不暂存或解包 `sherpa-onnx-win-x64`。
- 不生成 `speech-input-host.js`，不开放主窗口麦克风权限，也不显示 Renderer 麦克风入口。

开关只控制发布产物，不删除 `resources/speech-models` 中已校验的本地构建缓存。以后重新启用时仍可复用，
避免重复下载。必须在完整的 `build` / `prepare:desktop-pack` / `dist:*` 命令之前设置变量；不能只在
electron-builder 阶段设置，否则编译产物与打包资源可能不一致。

开发环境需要单独准备模型时使用 `bun run prepare:speech-models:dev`，以确保开关取自
`.env.development`；`bun run prepare:speech-models` 默认按生产构建读取 `.env.production`。

## extraResources 过滤

`prepare-pack.js` 对 extraResources 做了发布包过滤：

- `coding-agent`: 排除 `**/*.map`
- `vendor`: 排除 `**/*.pdb`
- `build`: 按目标平台只复制运行时会查找的图标文件，桌宠资源 `pet/**/*` 保留。
- `sandbox`: 按目标平台只复制对应沙箱运行时，Windows 包不带 Linux `bwrap`，Linux 包不带 Windows sandbox host。

原因：

- `coding-agent` 的 sourcemap 对最终用户运行不是必需资源。
- Windows Python vendor 中的 PDB 调试符号体积大，普通用户运行不需要。
- `resources/build` 会被主进程用于窗口/托盘图标，但 macOS `.icns`、Windows `.ico`、Linux `.png` 互不通用。
- Windows sandbox host 与 Linux bubblewrap 互不通用，单平台包只需要本平台沙箱后端。

影响：

- 发布包不携带这些调试辅助文件。
- 源包、构建缓存和下载的 vendor 解压目录不被删除；过滤只发生在 electron-builder 复制 extraResources 时。
- 如果需要调试符号或 sourcemap，应使用未过滤的本地构建目录或专门调试包，不应把它们默认放进用户安装包。

## 不裁剪的运行时能力

以下文件看起来可以节省体积，但默认发布包不裁剪：

- `vendor/node/**/node_modules/npm` 与 `corepack`
- Python 标准库中的 `ensurepip`、`venv`、`idlelib`、`turtledemo`、`distutils`、`tcl/tk`
- Python `include/`、`libs/`
- `coding-agent` 的 `.d.ts`

原因：

- `RuntimeManager` 会从托管 Node 的 `node_modules/npm/bin/npm-cli.js` 和 `npx-cli.js` 生成 `npm`/`npx` shim，`coding-agent` 包管理器也会调用 `npm install`。因此 Node vendor 不只是 `node.exe`。
- `RuntimeManager.ensurePip()` 显式调用 `python -m ensurepip`，并使用 bundled wheel 修复 pip 入口；裁剪 `ensurepip` 会破坏离线 pip 修复路径。
- `venv`、`tcl/tk`、`idlelib` 等属于托管 Python 暴露给用户/Agent 的标准库能力。裁剪它们是功能取舍，不是纯冗余删除。
- `include/` 与 `libs/` 会影响编译 Python C 扩展；虽然普通用户不一定需要，但裁剪会改变 `pip install` 能力边界。
- `coding-agent` 的 `.d.ts` 是类型声明，不是源 `.ts`；当前仅排除 sourcemap。若要进一步删 README/CHANGELOG 或 `.d.ts`，需确认 CLI 帮助、更新提示、扩展开发体验不依赖这些文件。

## 变更原则

- 体积优化优先修改构建输入、复制规则和打包 filter。
- 不通过删除模型、删除依赖源文件或修改 `node_modules` 来获得体积收益。
- 对依赖内部文件名有假设时，必须有构建期断言或失败路径。
- 修改影响发布包内容的脚本后，至少运行：

```bash
bun run check
cd apps/desktop && bunx tsc --noEmit
```

针对具体构建路径还应运行对应的定向构建命令，例如：

```bash
cd apps/desktop && bun run build:ocr-runner
cd apps/desktop && bun run build:main
```

## 构建环境前置检查

所有 `dist:*` / `pack:*` 命令都会先执行 `bun run validate:pack-env`，而且检查发生在清理旧产物、准备原生依赖和编译之前。`prepare-pack.js` 还会复用同一校验器做第二道防线。检查覆盖：

- `VETTA_CLOUD_ENABLED` 必须明确为 `true`（商业版）或 `false`（开源版）；
- 商业版必须有合法的服务端 URL，并使用 `generic` 更新源；开源版必须使用 GitHub 更新源和 GitHub Marketplace；
- Windows、macOS、Linux 目标标签、语音开关、生产插件租户；
- Sentry / PostHog 的 URL、布尔值、采样率及 Source Map 上传变量组合；
- macOS 签名、公证与强制验签变量组合。

开源版在三种宿主系统上统一执行：

```bash
bun run dist:opensource
# 仅生成 unpacked 目录
bun run dist:opensource -- --target dir
```

该入口读取 `.env.opensource`，固定关闭 cloud、使用 GitHub provider，并为官方仓库与公开 Marketplace 提供默认值；fork 可在文件或 shell 中覆盖 owner、repo 和 Marketplace 仓库。

正式发布 workflow 会先运行根 `check`、质量脚本测试和 Desktop packaging 测试，全部通过后才启动四个 Windows / macOS 双架构 / Linux 构建任务。每个平台构建后都会启动真实 packaged 应用并运行启动与 updater E2E，再校验 updater metadata、hash、blockmap 和可安装内容；真正发布到 R2 或 GitHub 后，再由 `verify-update-feed.mjs` 通过公开 URL 检查三平台 metadata 与其引用的安装包是否可读。

## Desktop 自动更新发布

客户端统一使用 `electron-updater`，更新源由打包时的环境变量决定，与目标操作系统无关：

- `VETTA_UPDATE_PROVIDER=generic`：R2、自建对象存储或任意静态 HTTP/CDN。
- `VETTA_UPDATE_PROVIDER=github`：公开 GitHub Releases。
- 未设置 `VETTA_UPDATE_PROVIDER`：默认使用 stable 更新源 `https://releases.openvetta.com/desktop/stable`。
- `VETTA_UPDATE_PROVIDER=none`：不受支持，打包时直接失败；所有可打包产物都必须有更新源配置。

发布 workflow 的最后一步会执行 `node scripts/verify-update-feed.mjs`：它读取三平台 metadata，确认版本与本次发布版本一致，并对每个引用的安装包执行公开可读性检查。CDN 不支持 HEAD 时会回退到 Range GET。只有不发布的手动构建跳过公开 feed 检查；手动 `test` / `stable` 发布与 tag 发布一样会在上传后执行该检查。

正式环境默认读取：

```text
https://releases.openvetta.com/desktop/stable
```

### 使用 test 通道验证真实升级

完整的安装、重启和版本切换验证应使用独立的 `test` 通道，不要覆盖 stable。通过 `desktop-release` 的
`workflow_dispatch` 选择 `release_target=r2`、`channel=test`，并为升级候选填写递增的 `build_version`
（例如当前 test 为 `0.5.46` 时填写 `0.5.47`）。配置会自动切换到 `VETTA_R2_PREFIX_TEST` /
`VETTA_UPDATE_URL_TEST`，并使用 `desktop-test` Environment；`build_version` 在 stable/default 通道会被拒绝。

建议先发布一个 test 基线版本，再发布更高的 test 候选版本。随后运行仓库的 `desktop-upgrade-e2e` Action，填写
`baseline_version` 和 `candidate_version`；Action 会在 Windows、macOS、Linux runner 上下载并安装基线包，启动真实
应用，执行 `check -> download -> install -> quit -> restart`，最后从重启后的应用进程读取版本并校验候选版本。test
通道可以保留多个版本供回归，验证完成后只需清理 test prefix，不会影响 stable 客户端。

electron-builder 会随各平台产物生成更新清单：

- Windows：`latest.yml`、Inno Setup 安装包与 blockmap。应用运行时由 Inno Setup 静默安装到新版本目录，重启时由稳定启动器切换版本。
- macOS：`latest-mac.yml`、ZIP/DMG 与 blockmap。签名并公证后由 Squirrel.Mac 原位替换应用；客户端会等到原生 `update-downloaded` 事件后才显示“可重启”，不会把“ZIP 下载完成”误当成“更新已可安装”。
- Linux：`latest-linux.yml`、AppImage 与 blockmap。

### 发布到 R2

在 `apps/desktop` 下先完成对应平台的 `dist:*`，再从 CI 或发布机上传 `release/` 中的更新文件：

```bash
bun run publish:updates:r2
```

发布前会按当前目录中的平台清单执行门禁：Windows 在 Windows 上校验 Inno 版本；macOS 校验 `latest-mac.yml`、ZIP、大小、SHA-512 和 blockmap；Linux 校验 `latest-linux*.yml`、AppImage、大小、SHA-512 和内嵌 blockmap 信息。在 macOS 正式签名构建中还应设置 `VETTA_REQUIRE_MAC_SIGNATURE=1`，此时会解压 ZIP 并执行 `codesign`、`spctl` 与 `stapler` 校验。也可以单独执行：

```bash
bun run verify:updates:windows
bun run verify:updates:mac
bun run verify:updates:linux
```

Windows 的运行时安装校验只能在 Windows 执行；R2 汇总发布任务运行在 Linux 时会跳过这项系统相关检查，依赖各平台构建 Job 已通过自己的门禁。

上传脚本要求通过 CI Secret 注入：

```text
VETTA_R2_ACCOUNT_ID
VETTA_R2_ACCESS_KEY_ID
VETTA_R2_SECRET_ACCESS_KEY
VETTA_R2_BUCKET
VETTA_R2_PREFIX=desktop/stable
VETTA_UPDATE_URL=https://releases.openvetta.com/desktop/stable
```

脚本解析 `latest*.yml`，只发布清单引用的版本化安装包和对应 blockmap；大文件使用 16 MiB S3 multipart 分片。上传前会读取公开通道的现有清单，拒绝用更低版本覆盖；安装包经公开域名验证可读后才覆盖 `latest*.yml`，避免客户端读到尚未完整发布的版本。R2 自定义域名应对安装包启用长期缓存；`latest*.yml` 保持短缓存，不要被 Cache Everything 规则强制长缓存。

### 发布到 GitHub Releases

开源构建使用专用入口。仓库工作流默认将 GitHub Releases 与开源版配对；官方仓库设置 `VETTA_RELEASE_TARGET=r2` 后切到商业版与 R2：

```bash
bun run dist:opensource
```

Windows 的 Inno Setup 安装包是自定义产物，应由仓库的 release workflow（或 `gh release upload`）连同 `latest.yml` 和 blockmap 上传。各操作系统仍应在对应系统的 CI runner 上构建；它们可以共同上传到同一个 GitHub Release。

工作流的 `workflow_dispatch` 默认只执行三平台构建、校验并保留临时 Artifact；选择 `channel=test` 会发布到隔离的 `desktop-test` R2，选择 `channel=stable` 会在 `desktop-production` Environment 审批后进入与匹配 tag 相同的 R2/GitHub 发布 Job。生产 tag 仍必须是 `v<package-version>`；其它 `v*` tag 经轻量 scope Job 判定后跳过打包。所有会发布的构建都要求 macOS 签名与公证。GitHub Release 已经公开后不允许 CI 用 `--clobber` 修改，只能恢复尚未公开的 draft。

打包时会从本包 `CHANGELOG.md` 提取与当前版本完全匹配的 `## [version]` 区段作为更新说明。正式发布必须先完成 Changelog 定版；找不到版本区段的本地 QA 构建只告警并省略更新说明。
