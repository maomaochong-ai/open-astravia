# Changelog

All notable changes to `@vetta-org/plugin-vite` are documented in this file.

## [Unreleased]

### Fixed

- Kept CSS resource-module requests such as `?raw`, `?url`, and `?inline` out of the development PostCSS scoping pipeline, while preserving scoping for normal, direct, and HMR stylesheet requests.
- Made the development ready handshake transform the plugin-local module graph before publishing the source overlay, so entry dependency compilation failures retain the stable plugin instead of surfacing later in Renderer.
- Exposed the project-local `vetta-plugin` CLI through the stable `@vetta-org/plugin-vite/cli` subpath so ESM-only package exports can be resolved by Desktop without pretending the package has a CommonJS entry.
- Stopped the resource watcher's initial scan from blocking the development server ready handshake after Vite was already serving the plugin entry.
- Preserved valid React bindings when transitive CommonJS dependencies are bundled against the host-provided React singleton.
- Kept validated Iconify mask rules available outside plugin CSS scopes so icons render inside portalled UI components.
- Packaged QuickJS plugin script entries directly instead of parsing them as Module Federation manifests.

### Added

- Added `vetta-plugin dev`, React Fast Refresh, development CSS scoping, and versioned lifecycle events for Desktop plugin hot reload without changing production package output.
- Added automatic injection of the public plugin-sdk Tailwind theme contract so plugins can use host semantic color utilities without importing Desktop CSS or repeating `@theme` mappings.

## [0.0.5] — 2026-08-04

### Added

- Added the `vetta-plugin validate` and `vetta-plugin pack` CLI so external projects and the plugin workbench use the same manifest parser and archive implementation as Vite builds.
- **宿主共享 `@vetta/ui`**：`vettaPluginFederation` 默认将 `@vetta/ui` 设为 MF `singleton + import:false`，并 rollup external 到 `vetta-host://ui`，与 desktop-app 的 share scope / host shim 对齐；插件可选用宿主 primitives 而不打进 bundle。
- **打包纳入能力详情**：根目录存在 `ability.json` 时随 zip 分发，并连带约定的 `presentation/` 展示资源目录；打包期校验 `schemaVersion` / `type` / `slug` / `version` 与 `plugin.json` 身份一致，不一致直接报错。`ability.json` 缺省时行为不变。

### Changed

- Plugin packaging now validates `plugin.json` through `@vetta-org/plugin-sdk/manifest` and only replaces the target archive instead of deleting the entire `release/` directory.

## [0.0.4] — 2026-07-31

### Fixed

- **打包纳入 `plugin.json` 的包内图标**：`icon` 为包内相对路径（png/jpg/webp/gif/svg）时，图标文件此前不会进 zip，导致安装后宿主 `vetta-plugin://` 取图 404、上传能力市场被服务端以「压缩包内缺少 icon 文件」拒绝。判定与宿主 / 服务端一致：Iconify 名与 `http(s)://` 外链不落包；声明的图标文件缺失时打包直接报错。

## [0.0.3] — 2026-07-23

### Added

- 插件 CSS 构建产物自动通过原生 `@scope` 限定到当前插件根节点，`:root` / `:host` 自动映射为 `:scope`，插件作者无需手写选择器前缀或 cascade layer。

## [0.0.2] — 2026-07-15

### Added

- **`VETTA_PLUGIN_DEV_WATCH=1` 跳过打包**：宿主 dev 热更新的 `vite build --watch` 只需要 dist，watch 模式下不再每轮增量构建都重打 zip。
- **打包始终纳入 `scripts/` 与 `agent/docs/`**（若存在），便于工作台脚本与内嵌手册随 zip 分发；MCP 声明时仍额外纳入 `mcp/`。
- **插件打包包含 MCP 资源**：声明 `agent.mcpServers` 时将配置文件（路径形式）及约定目录 `mcp/`、`scripts/` 打入 zip。

## [0.0.1] — 2026-07-14

### Changed

- **npm 包名**：由 `@vetta/plugin-vite` 更名为 `@vetta-org/plugin-vite`（发布 scope 与 org `vetta-org` 对齐）；构建时 external 的 SDK 名为 `@vetta-org/plugin-sdk`。

### Added

- Added Vite helpers for building Vetta Module Federation plugins with host-provided React shared dependencies.
- Added a plugin package helper that creates runtime-only install archives without Module Federation type and build metadata.
- Added automatic runtime-only zip packaging after Vite production builds.
- Added shared Rollup defaults for plugin entry points, host-provided SDK imports, and collision-safe asset names.

### Fixed

- Disabled unused Module Federation DTS output to avoid Windows output-directory cleanup races, and skip packaging failed builds.
