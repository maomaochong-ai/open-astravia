# macOS DMG 内置 AppleScript 修复 helper

Vetta 的 macOS 构建当前刻意不做代码签名与公证（`mac.identity: null` / `notarize: false`，见 `packages/desktop-app/scripts/prepare-pack.js`）。其直接后果是：用户从 DMG 把 `Vetta.app` 拖入 `/Applications` 后首次启动，会被 Gatekeeper 以「应用程序已损坏，无法打开」拦下，必须先对 app bundle 跑 `xattr -dr com.apple.quarantine` 摘除隔离属性。

为此在 DMG 内除了 `Vetta.app` 与 `/Applications` 快捷方式之外，再放一个 AppleScript 编译产物 `修复已损坏.app`：用户在 DMG 窗口 control-click 该 app → 「打开」一次绕过 Gatekeeper，它会通过 `do shell script ... with administrator privileges` 弹 macOS 原生密码框、对 `/Applications/Vetta.app`（再退一档查 `~/Applications/Vetta.app`）执行 xattr 摘除，完成后弹「修复完成」对话框并 `open` 主 app。

## Considered options

- **DMG 里放 `.command` 脚本**。零构建成本（纯文本脚本），但双击会打开 Terminal 黑窗、`sudo` 用英文 prompt 询问密码，与「简约高级感 DMG」目标冲突；且 `.command` 自身同样会被 quarantine 拦下，首次执行仍要 control-click → 「打开」，并不比 helper.app 省一步。拒绝。
- **只在 DMG 背景图上印 `sudo xattr ...` 命令**。零运行时风险、零脚本维护，但要求非技术用户复制长命令到 Terminal、理解 sudo 提示，失败率高；且这条命令一旦未来 app bundle id 变化或路径变化就过期，更新成本反而比 helper.app 高。拒绝。
- **在主 app 内做首次启动检测并自我修复**。不可行：quarantine 会在 app 启动前由 Gatekeeper 直接阻断，主 app 根本拿不到执行机会去检测自己。
- **AppleScript 编译的 helper.app**（采用）。用 macOS 原生密码弹窗（`do shell script with administrator privileges`），不打开 Terminal、不出现命令行字样，是 unsigned 前提下最贴近商业软件的体验。代价：构建时需要 macOS host 跑 `osacompile`（与「mac 打包必须在 mac host」的现状一致，没有新增平台依赖）；helper.app 自身仍 unsigned，首次仍需用户 control-click → 「打开」一次（这一限制在 DMG 背景图上以提示文字明示）。

## Consequences

- `修复已损坏.app` 是 DMG 用户首次安装路径上的**显式步骤**之一。一旦发布后改名、删除或换成 `.command`，老用户复装时会找不到熟悉的入口，所以这个交付形态是难撤销的决策。
- helper.app 把 `/Applications/Vetta.app` 与 `~/Applications/Vetta.app` 两个候选路径硬编码在 AppleScript 里。如果未来 `productName` 从 `Vetta` 改名，AppleScript 源 `packages/desktop-app/build/repair.applescript` 必须同步改路径，否则修复会静默失败为「请先拖入 Applications」错提示。
- 一旦后续启用代码签名 + 公证（`mac.identity` / `notarize` 改为有效值），quarantine 不再成为首次启动障碍，此 helper 即可移除。届时应删除 `修复已损坏.app`、`build-mac-repair-helper.js`、DMG 中第三个图标位与背景图上的「右键打开」提示文字，并把本 ADR 标记为 superseded。
  - **现状（2026-07）**：签名+公证已按环境变量接入（`prepare-pack.js` 的 `resolveMacSigning()`，流程见 [docs/deploy/apple-code-signing.md](../deploy/apple-code-signing.md)）。凭据齐全的构建自动走两图标版式、不带 helper；未配凭据的构建仍是本 ADR 描述的三图标形态。等到不再产出未签名包时再按上一条彻底移除并标 superseded。
- DMG 视觉布局（660×440、三列水平、底部一行右键打开提示）是为容纳 helper.app 第三个图标位而定的。移除 helper 后窗口尺寸与背景图也应一并瘦回两图标常规版式。
