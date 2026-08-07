# 清单参考（plugin.json）

`plugin.json` 是插件的唯一清单，位于 zip 归档根（或唯一顶层文件夹内）。

## 契约与校验

清单结构的唯一实现位于 `@vetta-org/plugin-sdk/manifest`：

```ts
import {
  PluginManifestSchema,
  parsePluginManifest,
  type PluginManifestInput,
} from "@vetta-org/plugin-sdk/manifest";
```

- `PluginManifestSchema` 是 TypeBox Schema，可直接序列化为 JSON Schema，供编辑器、CLI 或市场服务端使用。
- `PluginManifestInput` 与兼容类型 `PluginManifest` 均由 Schema 推导，不单独手写字段联合。
- `parsePluginManifest(value)` 先按 Schema 校验，再负责默认值、字符串归一化、去重、相对路径和跨字段约束。
- Schema 为向前兼容允许未知字段；发布工具可以对未知字段给警告，但宿主安装器不应因此拒绝更高版本清单。

Schema 只描述 `plugin.json` 数据本身；Plugin API 版本是否兼容、声明的文件是否存在等包级规则，仍由宿主和 `vetta-plugin pack` 校验。

## 完整示例

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "0.1.0",
  "pluginApiVersion": "^1.0.0",
  "runtime": "module-federation",
  "entry": "dist/mf-manifest.json",
  "moduleFederation": {
    "remoteName": "my_plugin",
    "expose": "./plugin"
  },
  "styles": ["dist/style.css"],
  "permissions": ["ui.slot.global", "agent.session.read", "network.fetch"],
  "network": {
    "allowedHosts": ["api.example.com", "*.cdn.example.com", "localhost", "192.168.1.20"]
  },
  "defaultLocale": "zh",
  "description": "一句话说明这个插件做什么",
  "author": "你的名字",
  "guidingWords": ["%guidingWords.summarize%", "把这段代码加上注释"],
  "contributes": {
    "settings": [
      { "key": "apiKey", "type": "secret", "title": "%settings.apiKey.title%", "description": "服务的密钥" }
    ]
  },
  "agent": {
    "systemPrompt": { "promptPaths": ["prompts/extra.md"] },
    "skillPaths": ["skills/"],
    "mcpServers": "./.mcp.json",
    "toolPolicy": { "allow": [], "deny": [] }
  }
}
```

## 字段

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `id` | ✅ | string | 全局唯一插件 id。决定安装目录、id 冲突时的去重，建议小写短横线。 |
| `name` | ✅ | string | 展示名。可用 `%key%`（见 [i18n](#i18n)）。 |
| `version` | ✅ | string | 语义化版本。**bump 它可强制宿主重新拉取**绕过缓存（见 [styling-and-pitfalls.md](./styling-and-pitfalls.md)）。 |
| `pluginApiVersion` | ✅ | string | 兼容的 SDK API 版本范围（如 `^1.0.0`）。 |
| `runtime` | ✅ | `"module-federation"` \| `"esm"` | 加载模式，见 [运行时](#运行时runtime)。 |
| `entry` | ✅ | string | 入口路径。MF 模式指向 `dist/mf-manifest.json`。 |
| `moduleFederation` | MF 必填 | `{ remoteName, expose }` | `remoteName` 与 vite 配置 `name` 一致；`expose` 与 vite `expose` 一致（默认 `./plugin`）。 |
| `styles` | ❌ | string[] | 要注入的 CSS 文件路径（相对插件根）。 |
| `permissions` | ❌ | string[] | 声明需要的权限，见 [permissions.md](./permissions.md)。未声明即不可用。 |
| `network` | `network.fetch` 必填 | `{ allowedHosts: string[] }` | `ctx.network.request` 可访问的域名/IP，见 [network](#network)。 |
| `commands` | ❌ | string[] | official 插件允许 `ctx.command.run` 的**可执行文件名**（如 `["git","node"]`），见 [commands](#commands)。 |
| `description` | ❌ | string | 简介。可用 `%key%`。 |
| `author` | ❌ | string | 作者。 |
| `icon` | ❌ | string | 能力页/插件列表展示的图标。三态：省略（按类型落默认图）、Iconify 名（如 `solar:widget-add-bold`）、`http(s)://` 外链，或包内相对路径（如 `assets/icon.png`）。 |
| `defaultLocale` | ❌ | string | i18n 缺译回退 locale，默认 `"zh"`。见 [i18n](#i18n)。 |
| `guidingWords` | ❌ | string[] | 新会话引导词，见 [下文](#guidingwords引导词)。条目可用 `%key%`。 |
| `contributes.settings` | ❌ | object[] | 插件设置项 schema，见 [配置项](#contributessettings配置项)。 |
| `agent` | ❌ | object | Agent 侧贡献（prompt / skill / **MCP** / toolPolicy），见 [Agent 清单](#agent-agent-侧贡献)。 |
| `contributionMode` | ❌ | object | 贡献硬隔离，见 [contributionMode](#contributionmode)。 |
| `agent_mode` | ❌ | string \| string[] | **工作模式白名单**（Work/Coding）。声明后，白名单外的模式下整个插件不可见，见 [agent_mode](#agent_mode工作模式白名单)。 |

## 运行时（runtime）

- **`module-federation`（推荐）**：宿主用 `@module-federation/enhanced/runtime` 动态注册你的 remote 并加载 `expose`。`entry` 指向 `dist/mf-manifest.json`。React / React DOM / `@vetta-org/plugin-sdk` 由宿主作为共享单例提供。
- **`esm`（兼容保留）**：旧加载模式，把 `react`、`react/jsx-runtime`、`react/jsx-dev-runtime`、`@vetta-org/plugin-sdk` 映射到 `vetta-host://` 模块。新插件用 MF。

## 安装目录与版本机制

用户插件按版本存放：

```text
~/.vetta/plugins/<id>/versions/<version>/
```

- 安装一个**更新版本**只被记录为 **pending**；App 持续加载当前 `activeVersion`。
- 直到用户（或代码）触发 `window.vetta.plugins.reload(id)` 才切换到新版本 UI。
- 调试时改了代码要 bump `version` + reload 才稳妥生效（见 [styling-and-pitfalls.md](./styling-and-pitfalls.md#缓存刷新)）。
- `listPlugins()` 会给出 **`rootPath`**：活动版本包在磁盘上的绝对根（用户插件 = 上表版本目录；系统插件 = `system-plugins/<id>`）。脚本、MCP 相对路径均相对此根解析。

系统插件不进 `~/.vetta/plugins`，见 [system-plugins.md](./system-plugins.md)。

## network

声明 `network.fetch` 时必须同时声明 `network.allowedHosts`，否则清单校验失败。列表按 URL 的 hostname 匹配，不限制端口：

- 精确域名：`api.example.com`。
- 子域通配：`*.cdn.example.com`，不包含根域 `cdn.example.com`。
- 精确公网/私网 IP：`203.0.113.10`、`192.168.1.20`、`::1`。
- 本机名：`localhost`。私网、localhost 与公网使用同一声明规则，不做额外禁止。
- `*` 表示任意 host，仅随包发布的 official 插件有效；local/community 插件声明后仍会被主进程拒绝。
- 只写 host，不带协议、端口、路径或凭据。请求仅支持 `http:` / `https:`。
- 首次请求和每次重定向都会重新匹配，跨 host 重定向会移除 `Authorization` 与 `Cookie`。

## commands

`commands?: string[]`：**可执行文件名**粒度（如 `"git"`、`"node"`、`"npm"`），不是完整 argv。

- 仅 `trustLevel === "official"` 的系统插件可获得 `agent.command.run` / `agent.command.spawn` 与 `commands`；local/community 插件的相关声明不会成为有效权限。
- official 插件未列入的二进制：`ctx.command.run` **硬拒绝**。
- 已声明：用户可在插件设置里**逐条开关**；关闭后调用拦截并提示用户。
- 需权限 `agent.command.run`。语义与 API 见 [conversation-and-agent.md 命令执行](./conversation-and-agent.md#命令执行-command)（ADR-0032）。

## contributionMode

```json
"contributionMode": { "hardIsolation": true }
```

- `hardIsolation: true`：该插件的 agent 贡献（tools / skills / MCP / systemPrompt）在 **mode 未打开**时不进入会话（冷启动即 gate，不必等 UI activate）。
- 通常配合 `registerInputAction({ hardIsolation: true })` 作为用户开关（ADR-0041）。
- **用户自建插件默认不要开**；模式型系统插件（如插件工作台）使用。

## agent_mode（工作模式白名单）

工作模式（agent_mode 轴，ADR-0046）把 agent 分成 **Work（工作/文档）** 与 **Coding（编程）** 两种，与对话场景（`scope_use`）、会话能力（`requires`）正交。

```json
"agent_mode": ["coding"]
```

- **插件级（本字段）是硬闸**：声明后，当前工作模式不在白名单内时，整个插件被**彻底隐藏**——tools / MCP / skills / systemPrompt 均不注入，插件的 UI / bundle 也不加载（`vetta 无法感知这个插件`）。
- **缺省 / 空 = 全局通用**：不写该字段的插件在所有工作模式下都可用。
- 值可写单个字符串（`"coding"`）或数组（`["work","coding"]`）。合法值目前为 `"work"` / `"coding"`；插件只能引用已有模式，不能自创。
- **子资源可再收窄**：即使插件级通用，也可给单个 tool / MCP server / skill 各自声明 `agent_mode`（见下方 [agent 清单](#agent-agent-侧贡献) 与 [conversation-and-agent](./conversation-and-agent.md#注册-agent-工具)）。两级取**交集**：插件级是硬上界，子资源只能在其内进一步收窄。
- 运行时可用 `ctx.getAgentMode()` / `ctx.onAgentModeChanged()` 读取当前模式做定制，见 [conversation-and-agent](./conversation-and-agent.md#工作模式agent_mode)。

## i18n

插件 i18n（ADR-0033）：

1. 包内 **`locales/<lang>.json`**：扁平 `key → 译文`（如 `zh.json` / `en.json`）。宿主 main 加载，随 `InstalledPlugin` 下发。
2. **`defaultLocale`**：缺译回退链 = 当前宿主语言 → defaultLocale → 裸 key。省略默认 `"zh"`。
3. **宿主渲染的字符串**（`name` / `description` / settings 文案 / `register*` 的 `label` / `registerTool({ label })` / guidingWords 等）：值为 **`%catalogKey%`** 时查 catalog；其它字符串当字面量（向后兼容）。
4. **插件自己的 React 组件内文案**：用 `useTranslation().t("catalogKey")` 或 `ctx.i18n.t`（裸 key，无 `%`），见 [conversation-and-agent 插件 i18n](./conversation-and-agent.md#插件-i18n)。

打包时 `locales/` 会打进 zip。

## guidingWords（引导词）

`guidingWords?: string[]` 是插件的**第一个声明式 UI 贡献**——与命令式 `ctx.ui.register*` 不同：**纯静态清单数据、无权限位、无运行时注册**。

- 唯一消费者是**新会话欢迎页**：在技能徽章下方按插件**分组**展示（组标题取插件 `name`），入选条件 = 插件已启用且 `guidingWords` 非空。
- 点击一条引导词＝以其文本立即发起一轮对话（不填入输入框）。
- 展示限额（轮播，非数据截断）：同时最多 3 组、每组最多 4 词；超出则组级 / 词级轮播。

## contributes.settings（配置项）

声明插件设置项，宿主在**设置页**统一渲染，值持久化后由插件经 `ctx.settings` 读取（见 [conversation-and-agent.md](./conversation-and-agent.md#设置-api)）。

每个设置项：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `key` | string | 设置键（`ctx.settings.get(key)` 用它读）。`desc` 类型可省。 |
| `type` | `"string"` \| `"number"` \| `"boolean"` \| `"secret"` \| `"enum"` \| `"desc"` | 控件类型。 |
| `title` | string | 标签。`desc` 类型可选。可用 `%key%`。 |
| `description` | string | 说明文本。`desc` 类型里 http(s) 链接会渲染成可点外链。可用 `%key%`。 |
| `default` | any | 默认值。 |
| `enum` | string[] | `type:"enum"` 的可选值。 |
| `visibleWhen` | `{ key, in }` | 按**另一个设置项**的当前值决定本项是否显示（`in` 是允许值数组）。 |

示例（按服务商显隐不同字段）：

```json
{
  "contributes": {
    "settings": [
      {
        "key": "provider", "type": "enum", "title": "服务商",
        "enum": ["openai", "custom"], "default": "openai"
      },
      {
        "key": "openaiApiKey", "type": "secret", "title": "API Key",
        "visibleWhen": { "key": "provider", "in": ["openai"] }
      },
      {
        "key": "baseUrl", "type": "string", "title": "API Base URL",
        "visibleWhen": { "key": "provider", "in": ["custom"] }
      },
      {
        "key": "note", "type": "desc",
        "description": "需要 Key？前往 https://example.com/keys 申请。"
      }
    ]
  }
}
```

- `secret` 值加密存储、UI 以密码框呈现。
- 值按**插件 id 命名空间**隔离；写入只能经宿主设置 UI，插件侧**只读**。

## agent（Agent 侧贡献）

可选，向 agent 会话注入插件打包的资源（路径相对插件根，主进程聚合解析）：

| 字段 | 说明 |
| --- | --- |
| `agent.systemPrompt.promptPaths` | 追加进系统提示词的提示片段文件路径。需 `agent.systemPrompt.write`（或 fullControl）。 |
| `agent.skillPaths` | 加入 agent 资源图的 skill 文件 / 目录。需 `agent.skills.control`。单个 skill 可在其 `SKILL.md` frontmatter 写 `agent_mode` 限定工作模式（见 [agent_mode](#agent_mode工作模式白名单)）。 |
| `agent.mcpServers` | **插件内聚 MCP**（三源聚合之插件源）：相对路径 `.mcp.json` 或内联 map。需 `agent.mcp.control`。**内联 map** 的每个 server 可加 `agent_mode` 限定工作模式，见 [mcp.md](./mcp.md)。 |
| `agent.toolPolicy.allow` / `.deny` | 声明式工具可见性策略（注册后的工具 id）。需 `agent.tools.control`。 |

> 在 JS 里**动态**注册 agent 工具走 `ctx.agent.registerTool`（见 [conversation-and-agent.md](./conversation-and-agent.md#注册-agent-工具)），与此处的**声明式**清单字段是两条不同路径。
>
> **插件 MCP** 与用户全局 / 项目 MCP **聚合**进同一会话，不写用户 mcp.json；启停与授权见 [mcp.md](./mcp.md)（ADR-0040）。
