# Changelog

All notable changes to `@vetta-org/plugin-cli` are documented in this file.

## Unreleased

### Changed

- `sync --check` accepts schema v3 plugin releases without local `dist/` and validates release metadata for independently listed and bundle-only plugins. The marketplace publication gate separately verifies the referenced App releases and artifact digests.

## [0.1.6] — 2026-09-14

### Fixed

- **`init --refresh-guide` 不再覆盖手写的 `AGENTS.md`**。此前它无条件重写，而 `docs` 又把「没有
  版本戳」判成过期并给出这条命令——两者合起来是在引导用户删掉自己的文件。已知造成一个能力市场
  仓库根部 443 行手写市场规范被整份替换。

  没有 `vetta-guide-revision` 标记的文件现在一律拒绝覆盖（退出码 7），要覆盖得显式 `--force`；
  新增 `--dry-run` 把新模板打到 stdout 供人工合并。`docs` 对无标记文件改口为「看起来是手写的，
  请手动合并」，只有**带标记且落后**的才会被称作 stale 并给出刷新命令。

- 说明书标题不再印出未解析的本地化占位符。`plugin.json` 的 `name` 写成 `%plugin.name%` 时，按
  `defaultLocale` 从 `locales/` 解析；解析不到退回插件 id。

- 说明书的命令清单改为读 `package.json` 的 `scripts`，只列真实存在的。老工程和自定义工程未必有
  `dev` / `install:vetta`，照着跑只会得到一句 "Missing script"；没有 `install:vetta` 时改列
  `vetta-plugin-cli add .`。

- 更正 hub `AGENTS.md` 对 `sync` 的两处描述：`marketplaceVersion` 只在 semver 或纯整数时才推得动
  （`YYYY.MM.DD-NN` 这类会报出来要手改），`config.api_version` / `permissions` / `commands`
  **不回填**——宿主用 `plugin.json` 整个重算 `config`，`sync` 只在副本与真源不符时提醒删掉。

## [0.1.5] — 2026-09-14

### Changed

- **脚手架的 `AGENTS.md` 削薄成纯指引**：原先写在里面的「不可违反的几条」（Tailwind-only、
  错误必须 notify、最小权限、MF 顶层 JSX、`agent_mode` 已废弃、依赖用发布版本、`dist/` 进
  版本库）全部移进手册的 `README.md#不可违反的红线`。写进说明书的规则会在所有存量工程里就地
  凝固——它是 `init` 当天的快照，之后既不自更新、用户也没有理由回头看它。规则放进手册才能
  随 SDK 升级一起到位；说明书越薄，需要回头迁移老仓库的理由就越少。

### Added

- `AGENTS.md` 带版本戳（`<!-- vetta-guide-revision: N -->`），`docs` 每次比对并在落后时打印
  `This brief is stale ... npx @vetta-org/plugin-cli init --refresh-guide`。此前「说明书旧了」
  只能靠人记得，而这正是它凝固的原因。没有 `AGENTS.md` 的工程不提示——「没有」不是「旧」。

## [0.1.4] — 2026-09-14

### Added

- `init --refresh-guide [dir]` 就地重写已有工程（或能力市场仓库）的 `AGENTS.md`。`init` 拒绝
  覆盖已有工程，所以老目录里那份说明书从落地起就再也没变过；它是脚手架里唯一纯派生、不含用户
  内容的文件，可以安全重写，其余文件一概不动。id 与展示名从磁盘上的 `plugin.json` 读。

## [0.1.3] — 2026-09-14

### Added

- `docs` 每次都打印刷新手册的命令，并新增 `--check-latest` 对比 registry 上的最新 SDK，落后时
  直接说出来。手册随 SDK 进 `node_modules`，所以老工程里的手册与 `AGENTS.md` 都停在初始化那天；
  `npx` 默认取最新的 CLI，它的输出是这条链路上唯一不会过期的位置。查不到 registry（离线、私服）
  时明说查不到，不会据此断言手册过期。
- 在能力市场仓库根跑 `docs` 时，提示 `cd` 进能力目录，而不是让人在仓库根装一份用不上的 SDK。

### Changed

- 脚手架的 `AGENTS.md` 与 hub `AGENTS.md` 增加「先确认手册是否最新」一步，并写明 `docs` 的输出
  与自身冲突时以前者为准。
- 新建工程的 SDK 范围提到 `^0.3.2`（团队成员的角色槽位与跨插件引用）。

## [0.1.2] — 2026-09-14

### Fixed

- `sync` preserves the marketplace index's existing indentation (and whether it ended with a newline) instead of rewriting the whole file with tabs. Reformatting turned a two-line change into a whole-file diff, fought with other scripts that write the same file, and escalated any concurrent commit into a full-file conflict. A reconciliation tool should only touch the fields it reconciles.

## [0.1.1] — 2026-09-14

### Fixed

- `sync` no longer writes `config.api_version` / `config.permissions` / `config.commands` into the index. The host overwrites the whole `config` with values derived from `plugin.json` when it builds the catalog, so a copy in the index is unread, drift-prone noise; a copy that already disagrees with the package is now reported instead.
- `sync` resolves bundle members, so their directories are no longer reported as unlisted abilities. The index's `abilities` array holds independently listed entries; bundle members deliberately stay out of it and carry their metadata in the package's own `ability.json`.
- Command examples now use the full package name wherever the command runs before `npm install` or at a repository root, where the `vetta-plugin-cli` bin is not on `node_modules/.bin` and npx would resolve it as a package name.

## [Unreleased]

### Added

- Added `vetta-plugin-cli init --id <plugin-id>`: scaffolds a buildable plugin project together with an `AGENTS.md` brief, so any coding agent can bootstrap in an unfamiliar directory without host-side knowledge. Inside a marketplace hub (`.vetta/marketplace.json`) the new plugin is also listed there, with a repository-relative `source.path`.
- Added `vetta-plugin-cli docs`: prints the absolute path of the manual shipped inside the installed `@vetta-org/plugin-sdk`, plus the SDK version it documents and the plugin/hub the command resolved. Nobody has to hard-code a `node_modules` path that workspace hoisting can move.
- Added `vetta-plugin-cli init hub`: scaffolds a conformant ability marketplace repository — index skeleton, `abilities/{plugins,mcp,skills,scenes}/`, a repository-level `AGENTS.md`, and a CI workflow that runs `sync --check`.
- Added `vetta-plugin-cli sync` (and `--check` for CI): reconciles a marketplace repository's `.vetta/marketplace.json` against each ability directory — version, api version, permissions and commands are pulled from the packages, missing build output and slug mismatches are reported, and `marketplaceVersion` is advanced so clients actually pick the update up. Ability directories that are not listed are reported, never added. `docs` and `add .` now point at it the moment it becomes relevant.
- Added `vetta-plugin-cli uninstall [plugin-id]`: removes a plugin through the Desktop approval path, inferring the target from the current directory when no id is given.
- Added `vetta-plugin-cli watch` (and `--stop`): asks the running Desktop to load the nearest plugin from its project directory, so source edits take effect without a build → pack → install round trip.
- `add` now accepts a plugin project directory (`add .`) and resolves the archive that project packed, instead of treating the directory as an archive path.

- Added `npx @vetta-org/plugin-cli add <npm-package>` with script-free npm resolution, package-envelope validation, archive integrity binding, and installation through the running Vetta Desktop Action RPC.
- Added `vetta-plugin-cli reload <plugin-id>` so pending plugin updates can be applied through the Desktop approval and lifecycle path.
