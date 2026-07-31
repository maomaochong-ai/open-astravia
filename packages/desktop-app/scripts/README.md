# Desktop Packaging Size Policy

本文记录 `packages/desktop-app` 构建与打包阶段的体积优化策略。目标是减少发布包中不会被当前运行路径使用的文件，同时避免删除源文件、模型文件或依赖包内容。

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
cd packages/desktop-app && bunx tsc --noEmit
```

针对具体构建路径还应运行对应的定向构建命令，例如：

```bash
cd packages/desktop-app && bun run build:ocr-runner
cd packages/desktop-app && bun run build:main
```

## Desktop 自动更新发布

客户端统一使用 `electron-updater`，更新源由打包时的环境变量决定，与目标操作系统无关：

- `VETTA_UPDATE_PROVIDER=generic`：R2、自建对象存储或任意静态 HTTP/CDN。
- `VETTA_UPDATE_PROVIDER=github`：公开 GitHub Releases。
- `VETTA_UPDATE_PROVIDER=none`：不生成更新源配置，适合开发和 QA 包。

正式环境默认读取：

```text
https://releases.openvetta.com/desktop/stable
```

electron-builder 会随各平台产物生成更新清单：

- Windows：`latest.yml`、Inno Setup 安装包与 blockmap。应用运行时由 Inno Setup 静默安装到新版本目录，重启时由稳定启动器切换版本。
- macOS：`latest-mac.yml`、ZIP/DMG 与 blockmap。签名并公证后由 Squirrel.Mac 原位替换应用；客户端会等到原生 `update-downloaded` 事件后才显示“可重启”，不会把“ZIP 下载完成”误当成“更新已可安装”。
- Linux：`latest-linux.yml`、AppImage 与 blockmap。

### 发布到 R2

在 `packages/desktop-app` 下先完成对应平台的 `dist:*`，再从 CI 或发布机上传 `release/` 中的更新文件：

```bash
bun run publish:updates:r2
```

发布前会按当前目录中的平台清单执行门禁：Windows 在 Windows 上校验 Inno 版本，macOS 在任意系统校验 `latest-mac.yml`、ZIP、大小、SHA-512 和 blockmap。在 macOS 正式签名构建中还应设置 `VETTA_REQUIRE_MAC_SIGNATURE=1`，此时会解压 ZIP 并执行 `codesign`、`spctl` 与 `stapler` 校验。也可以单独执行：

```bash
bun run verify:updates:windows
bun run verify:updates:mac
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

脚本解析 `latest*.yml`，只发布清单引用的版本化安装包和对应 blockmap；大文件使用 16 MiB S3 multipart 分片。安装包经公开域名验证可读后才覆盖 `latest*.yml`，避免客户端读到尚未完整发布的版本。R2 自定义域名应对安装包启用长期缓存；`latest*.yml` 保持短缓存，不要被 Cache Everything 规则强制长缓存。

### 发布到 GitHub Releases

开源构建只需覆盖发布源，不需要改客户端代码。仓库工作流默认使用 GitHub Releases；官方仓库设置 `VETTA_RELEASE_TARGET=r2` 后切到 R2：

```bash
bun run dist:win
```

Windows 的 Inno Setup 安装包是自定义产物，应由仓库的 release workflow（或 `gh release upload`）连同 `latest.yml` 和 blockmap 上传。各操作系统仍应在对应系统的 CI runner 上构建；它们可以共同上传到同一个 GitHub Release。

打包时会从本包 `CHANGELOG.md` 提取与当前版本完全匹配的 `## [version]` 区段作为更新说明。正式发布必须先完成 Changelog 定版；找不到版本区段的本地 QA 构建只告警并省略更新说明。
