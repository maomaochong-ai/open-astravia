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

## CLI Provider

上游能力本身以 Agent CLI 为产品面时，插件可用 `plugin.json#providers.cli` 声明宿主需要准备的 executable、探测 argv
和安装命令。用户启用插件后，Desktop 展示真实的检查、安装、验证与失败状态；全部 Provider 就绪前不会发布该插件的
Agent 贡献。插件 Renderer 通过 `ctx.cliProviders` 订阅状态、重试或启动上游原生配置流程，Agent 则继续通过已有 Shell
直接使用 CLI，不增加 Vetta Action、MCP 或自定义 Tool。

能力专属的安装与配置界面使用 `ctx.ui.registerAbilityDetailSlot`，由宿主固定渲染在匹配 slug 的能力详情页 Header 下方。
停用或卸载插件会停止宿主持有的进程，但不会卸载全局 CLI 或清除上游凭据。完整决策见
[ADR-0098](../../docs/adr/0098-plugin-cli-providers-and-ability-setup-slots.md)。

## 受管本地服务

需要长期运行本地 HTTP 服务的插件使用 `plugin.json#providers.services`，按 `win32|darwin|linux` 与
`x64|arm64` 声明固定版本、SHA-256、归档落点、可执行文件、配置模板、启动参数和健康检查。插件通过
`ctx.network` 自己选择并下载固定资源、完成首次摘要校验，再调用 `ctx.services.install()` 交付归档。
Desktop 不管理下载源或上游版本策略，只负责二次摘要校验、安全解包、版本化原子安装、动态回环端口、稳定数据目录和进程生命周期。

插件通过 `ctx.services` 只操作自己声明的服务。`request()` 只接受根相对 path，宿主将请求固定发往该服务的
`127.0.0.1` origin，并可按 manifest 中的 `credentialId` 注入认证。服务特定的路由、OAuth Provider、响应解析、
账号状态和模型映射必须保留在插件中，不能加入 Desktop 专用 client。

动态模型使用 `models.manage` 权限和 `ctx.models`；插件传入本地 Provider id，宿主将真实 id 固定为
`<plugin-id>.<local-id>`（local id 为不含点号的 1–32 位小写 slug），所以插件可按协议拆分多个 Provider，但不能覆盖用户或其它插件的模型配置。
模板 `create` 仅首次写入数据目录，`render` 每次启动写入缓存目录；动态端口和版本目录应使用 `render`，认证数据保留在数据目录。
完整生命周期、供应链和边界决策见
[ADR-0104](../../docs/adr/0104-plugin-managed-local-services-and-owned-model-providers.md)。

## 通用浏览器扩展

插件可通过 `ctx.browser` 使用宿主管理的浏览器自动化，不需要依赖 Browser 系统插件或执行 CLI。清单必须声明所需的 `browser.*` 权限以及最大 `browser.allowedHosts`；session 可以进一步收窄域名范围，不能扩大清单授权。

宿主按插件 namespace 隔离 session 与持久 profile。插件只使用逻辑 `profile.id`，不会得到目录、Cookie 或 token。公共 v1 支持运行时状态/安装、会话创建/关闭、导航、快照、文本、截图和类型化动作；不提供任意 JavaScript、argv、上传、下载或认证数据导出。attach 与 runtime manage 需要清单声明和用户授权。

插件代码与宿主共享 renderer realm，不存在安全沙箱。权限、命令和 host 清单用于说明插件意图并门控宿主 API；它们不能把恶意插件变成安全插件。只安装和启用可信来源的代码。

完整设计与安全边界见 [ADR-0088](../../docs/adr/0088-browser-automation-as-a-foundation-capability.md)。
