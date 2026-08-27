# Vetta Plugins

本目录集中维护插件 SDK、构建工具、系统插件和外置插件示例，所有包统一纳入
仓库根 workspace。

## 开发前必读

创建、修改、构建或审查本目录中的任何内容前，必须先完整阅读并遵守
[AGENTS.md](./AGENTS.md)。依赖管理、目录结构、manifest、构建制品和验证规则
均以该文件为准。

## 目录

- `plugin-sdk/`：插件运行时 API 和类型。
- `plugin-vite/`：插件 Vite 配置与 zip 打包工具。
- `plugin-cli/`：从 npm 包、本地 zip 或 URL 安装插件的公开 CLI。
- `presets/`：随 Vetta Desktop 发布的系统插件。
- `externals/`：不随 App 打包的外置插件示例。

## 安装

从仓库根目录统一安装依赖：

```bash
bun install
```

## 构建系统插件

从 Desktop 包目录构建当前 profile + 租户选中的 Preset，并将 zip 制品
解压到开发 staging：

```bash
cd apps/desktop
bun run build:presets
```

开发环境会先把 `development` profile 中当前租户的插件 staging 到
`apps/desktop/.artifacts/system-plugins/`，再默认为它们建立内存 dev 链接并启动
开发服务器；关闭 dev 链接时回落 staging。
Preset 不会安装到 `~/.vetta/plugins`。

## 通过 npm 分发外置插件

外置插件仍以 Desktop 标准 zip 为安装制品，npm 包只作为分发信封。插件工程在
`package.json` 中声明稳定制品路径，并让 `plugin-vite` 同时生成它：

```json
{
  "name": "@example/vetta-plugin-demo",
  "version": "1.0.0",
  "files": ["release/vetta-plugin.zip"],
  "vetta": {
    "schemaVersion": 1,
    "type": "desktop-plugin",
    "pluginId": "demo",
    "archive": "release/vetta-plugin.zip"
  }
}
```

```ts
vettaPluginFederation({
  name: "demo",
  package: { npmArchive: true }
});
```

发布 npm 包后，用户需要先启动 Vetta Desktop，再执行：

```bash
npx @vetta-org/plugin-cli add @example/vetta-plugin-demo
```

CLI 使用 `npm pack --ignore-scripts` 获取包，校验 npm 元数据后仅提取声明的 zip；
Desktop 会再次校验摘要、插件 id 与版本，然后沿用现有授权、启用和重载流程。

## 通用浏览器扩展

ESM / Module Federation 插件可通过 `ctx.browser` 使用宿主管理的浏览器自动化，不需要依赖 Browser 系统插件或执行 CLI。清单必须声明所需的 `browser.*` 权限以及最大 `browser.allowedHosts`；session 可以进一步收窄域名范围，不能扩大清单授权。

宿主按插件 namespace 隔离 session 与持久 profile。插件只使用逻辑 `profile.id`，不会得到目录、Cookie 或 token。公共 v1 支持运行时状态/安装、会话创建/关闭、导航、快照、文本、截图和类型化动作；不提供任意 JavaScript、argv、上传、下载或认证数据导出。attach 与 runtime manage 只对 official 插件开放，QuickJS 不支持该能力。

完整设计与安全边界见 [ADR-0088](../../docs/adr/0088-browser-automation-as-a-foundation-capability.md)。
