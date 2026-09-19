# 清单参考（plugin.json）

`plugin.json` 是插件的唯一清单，位于 `.vettapkg` 包的 ZIP 容器根目录（或唯一顶层文件夹内）。

它描述插件的运行时合同。能力页的可选长详情使用独立的 `ability.json`，见
[能力详情页](./ability-details.md)；不要把 showcase、长 Markdown 或展示图片塞进 `plugin.json`。

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
  "pluginApiVersion": "^2.0.0",
  "entry": "dist/mf-manifest.json",
  "moduleFederation": {
    "remoteName": "my_plugin",
    "expose": "./plugin"
  },
  "styles": ["dist/style.css"],
  "permissions": ["ui.slot.global", "agent.session.read", "agent.command.run", "browser.read"],
  "commands": ["git"],
  "browser": { "allowedHosts": ["studio.example.com"] },
  "defaultLocale": "zh",
  "description": "一句话说明这个插件做什么",
  "author": "你的名字",
  "guidingWords": ["%guidingWords.summarize%", "把这段代码加上注释"],
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
| `pluginApiVersion` | ✅ | string | 兼容的宿主 Plugin API 版本范围；基础插件可用 `^2.0.0`，使用较新能力时按对应文档提高下限。 |
| `entry` | ✅ | string | Module Federation 清单路径，通常为 `dist/mf-manifest.json`。 |
| `moduleFederation` | ✅ | `{ remoteName, expose }` | `remoteName` 与 vite 配置 `name` 一致；`expose` 与 vite `expose` 一致（默认 `./plugin`）。 |
| `styles` | ❌ | string[] | 要注入的 CSS 文件路径（相对插件根）。 |
| `permissions` | ❌ | string[] | 声明需要的权限，见 [permissions.md](./permissions.md)。未声明即不可用。 |
| `commands` | ❌ | string[] | 允许 `ctx.command.run` 的**可执行文件名**（如 `["git","node"]`），见 [commands](#commands)。 |
| `browser` | 使用 `browser.*` 权限时必填 | `{ allowedHosts: string[] }` | 浏览器顶层导航的最大 host 授权；session 只能收窄，见 [browser.md](./browser.md)。 |
| `description` | ❌ | string | 简介。可用 `%key%`。 |
| `author` | ❌ | string | 作者。 |
| `icon` | ❌ | string | 能力页/插件列表展示的图标，也是[工作区视图](./ui-slots.md#工作区视图-registerworkspaceview)与活动 Tab 未声明图标时的回落。三态：省略（按类型落默认图）、Iconify 名（如 `solar:widget-add-bold`）、`http(s)://` 外链，或包内相对路径（如 `assets/icon.png`）。 |
| `defaultLocale` | ❌ | string | i18n 缺译回退 locale，默认 `"zh"`。见 [i18n](#i18n)。 |
| `guidingWords` | ❌ | string[] | 新会话引导词，见 [下文](#guidingwords引导词)。条目可用 `%key%`。 |
| `agent` | ❌ | object | Agent 侧贡献（prompt / skill / **MCP** / toolPolicy），见 [Agent 清单](#agent-agent-侧贡献)。 |
| `contributionMode` | ❌ | object | 贡献硬隔离，见 [contributionMode](#contributionmode)。 |
| `agent_mode` | ❌ | string \| string[] | **已废弃**（ADR-0071）：无任何运行时语义，容忍存在但被忽略，见 [agent_mode](#agent_mode已废弃)。 |

## Module Federation 加载合同

插件只有一种加载方式：宿主用 `@module-federation/enhanced/runtime` 动态注册 remote 并加载 `expose`。
`entry` 指向 Federation 生成的 `dist/mf-manifest.json`，`moduleFederation` 必须声明与 Vite 配置一致的
`remoteName` 和 `expose`。React / React DOM / `@vetta-org/plugin-sdk` 由宿主作为共享单例提供。

清单不提供加载模式选择字段；声明 `runtime` 会被校验器拒绝，避免清单看似选择了一条宿主并不存在的加载路径。

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

## commands

`commands?: string[]`：**可执行文件名**粒度（如 `"git"`、`"node"`、`"npm"`），不是完整 argv。

- 未列入的二进制：`ctx.command.run` **硬拒绝**。
- 已声明：用户可在插件设置里**逐条开关**；关闭后调用拦截并提示用户。
- 需权限 `agent.command.run`。语义与 API 见 [conversation-and-agent.md 命令执行](./conversation-and-agent.md#命令执行-command)（ADR-0032）。

## contributionMode

```json
"contributionMode": { "hardIsolation": true }
```

- `hardIsolation: true`：该插件的 agent 贡献（tools / skills / MCP / systemPrompt）在 **mode 未打开**时不进入会话（冷启动即 gate，不必等 UI activate）。
- 通常配合 `registerInputAction({ hardIsolation: true })` 作为用户开关（ADR-0041）。
- **用户自建插件默认不要开**；模式型系统插件（如插件工作台）使用。

## agent_mode（已废弃）

> **Deprecated（ADR-0071，2026-08）**：本字段（插件级、tool / MCP server / skill 子资源级、`SKILL.md` frontmatter）**没有任何运行时语义**。宿主容忍它存在（既有 `plugin.json` 不会校验失败），但不解析、不排序、不展示。请不要在新插件里写它。

工作模式是**任务解释的先验**：Work/Coding 的差异完全由宿主的 mode 系统提示词、工作区事实注入与工具自描述承担，不影响任何插件能力的可用性与清单顺序。插件在所有模式下完整可用。

插件侧需要知道的只有两件事：

- **想收窄某个工具的使用场景**，写进该工具 **description 的反向触发段**（说明何时**不该**用它及替代做法）。那是模型真正阅读并据以选择的地方；`agent_mode` 从来做不到这一点。
- ⚠️ **`ctx.getAgentMode()` 读到的是「新会话默认模式」，不是当前会话正在用的模式**：模式于会话创建时固化、会话内不可变，用户改默认值不影响已存在的会话。它只适合展示层的软性定制，**不要在 tool / hook handler 里用它推断本次调用所属会话的模式**。详见 [conversation-and-agent](./conversation-and-agent.md#工作模式agent_mode)。

## i18n

插件 i18n（ADR-0033）：

1. 包内 **`locales/<lang>.json`**：扁平 `key → 译文`（如 `zh.json` / `en.json`）。宿主 main 加载，随 `InstalledPlugin` 下发。
2. **`defaultLocale`**：缺译回退链 = 当前宿主语言 → defaultLocale → 裸 key。省略默认 `"zh"`。
3. **宿主渲染的字符串**（`name` / `description` / `register*` 的 `label` / `registerTool({ label })` / guidingWords 等）：值为 **`%catalogKey%`** 时查 catalog；其它字符串当字面量（向后兼容）。
4. **插件自己的 React 组件内文案**：用 `useTranslation().t("catalogKey")` 或 `ctx.i18n.t`（裸 key，无 `%`），见 [conversation-and-agent 插件 i18n](./conversation-and-agent.md#插件-i18n)。

打包时 `locales/` 会打进 zip。

## guidingWords（引导词）

`guidingWords?: string[]` 是插件的**第一个声明式 UI 贡献**——与命令式 `ctx.ui.register*` 不同：**纯静态清单数据、无权限位、无运行时注册**。

- 唯一消费者是**新会话欢迎页**：在技能徽章下方按插件**分组**展示（组标题取插件 `name`），入选条件 = 插件已启用且 `guidingWords` 非空。
- 点击一条引导词＝以其文本立即发起一轮对话（不填入输入框）。
- 展示限额（轮播，非数据截断）：同时最多 3 组、每组最多 4 词；超出则组级 / 词级轮播。

## 插件配置放哪里

**宿主不再提供设置页配置槽**：`plugin.json#contributes.settings` 与只读的 `ctx.settings` 已在
Plugin API 1.6.0 移除（ADR-0105）。Plugin API 2.0 的存储改为文件合同（ADR-0107）。配置由插件自己渲染、自己持久化：

| 需求 | 用什么 |
| --- | --- |
| 完整配置界面（推荐） | `ctx.ui.registerWorkspaceView` 注册一个工作区配置页，配置与连通性检查、模型列表、预览放在同一屏 |
| 只有一两个开关 | 直接放进插件已有的活动 Tab、能力详情槽或全局槽 |
| 普通配置值 | `ctx.storage.readFile/writeFile("settings.json", ..., "utf8")`（插件私有存储，按 plugin id 隔离） |
| API Key 等密钥 | `ctx.secrets`（宿主加密凭据库），需要 `secrets.read` / `secrets.write` 权限 |

`settings.json` 是宿主迁移旧 `contributes.settings` 值时的落点：升级时宿主会把
`plugin-settings.json` 里该插件的非密钥字段一次性写进去，插件读回后自行归一化。密钥的凭据库命名空间
未变，无需迁移。

存储 API 不推断格式或扩展名：插件负责 `JSON.stringify/parse`，路径就是实际逻辑文件名。需要把多个
数据源拆成独立文件又保持一致时，用一次 `ctx.storage.commit()` 发布，并用 `readSnapshot()` 从同一
revision 读取；不要依次调用多次 `writeFile()` 冒充多文件事务。

带 `contributes` 字段的旧清单不会校验失败（顶层允许额外字段），但该字段不再有任何运行时语义。

## agent（Agent 侧贡献）

可选，向 agent 会话注入插件打包的资源（路径相对插件根，主进程聚合解析）：

| 字段 | 说明 |
| --- | --- |
| `agent.systemPrompt.promptPaths` | 追加进系统提示词的提示片段文件路径。需 `agent.systemPrompt.write`（或 fullControl）。 |
| `agent.skillPaths` | 加入 agent 资源图的 skill 文件 / 目录。需 `agent.skills.control`。skill frontmatter 的 `agent_mode` 已废弃（ADR-0071），容忍存在但被忽略。 |
| `agent.skillPresentation` | 控制插件 Skill 在产品入口的可见性与展示文案。只影响界面呈现，不影响加载、调用或权限。 |
| `agent.mcpServers` | **插件内聚 MCP**（三源聚合之插件源）：相对路径 `.mcp.json` 或内联 map。需 `agent.mcp.control`。内联 map 里的 `agent_mode` 已废弃（ADR-0071），容忍存在但被忽略。 |
| `agent.toolPolicy.allow` / `.deny` | 声明式工具可见性策略（注册后的工具 id）。需 `agent.tools.control`。 |
| `agent.agents` | **插件贡献的智能体**：人设、头像、系统提示词由插件提供，宿主把它们铺进用户的智能体库。**不需要权限**，见[贡献智能体与团队](#贡献智能体与团队)。 |
| `agent.teams` | **插件贡献的团队**：成员可以是本插件的智能体、别的插件的智能体，或一个**角色槽位**。同上。 |

> 在 JS 里**动态**注册 agent 工具走 `ctx.agent.registerTool`（见 [conversation-and-agent.md](./conversation-and-agent.md#注册-agent-工具)），与此处的**声明式**清单字段是两条不同路径。
>
> **插件 MCP** 与用户全局 / 项目 MCP **聚合**进同一会话，不写用户 mcp.json；启停与授权见 [mcp.md](./mcp.md)（ADR-0040）。

### Skill 展示策略

插件 Skill 默认作为内部实现隐藏。它仍会随 `agent.skillPaths` 加载并可被 Agent 调用，只是不作为独立选项出现在能力中心、智能体能力配置、命令菜单或 Skill 选择器。需要公开的 Skill 由插件显式声明：

```json
{
  "agent": {
    "skillPaths": ["agent/skills"],
    "skillPresentation": {
      "defaultVisibility": "hidden",
      "skills": {
        "vetta-ui-design": {
          "defaultVisibility": "visible",
          "displayName": "%plugin.name%"
        }
      }
    }
  }
}
```

- `defaultVisibility`：插件全部 Skill 的默认值，`visible` 或 `hidden`。
- `surfaces`：按入口覆盖默认值，当前支持 `abilityCatalog`、`agentConfiguration`、`commandPalette`、`skillPicker`、`pluginDetail`。
- `skills.<skill-name>`：按 `SKILL.md` 中的稳定 Skill 名覆盖插件默认值；可声明 `defaultVisibility`、`surfaces`、`displayName`、`displayDescription`。
- `displayName` / `displayDescription`：仅改变用户看到的文案，不改变 Skill 名、调用路由或已保存引用；支持插件 `%catalogKey%` 本地化占位符。

普通用户、项目、市场与 Vetta 内置 Skill 没有声明时继续默认可见。已安装的旧插件没有 `skillPresentation` 时按插件默认隐藏，避免把实现细节意外暴露为产品能力。

## 贡献智能体与团队

`agent.agents` / `agent.teams` 让插件把**自己的人设**带进产品：宿主在插件启用时把它们铺进用户的智能体库与团队列表，与用户自建的档案并列出现在智能体中心、新会话选择器和 `@` 提及里。

**这些资产由你 1:1 维护**：清单是唯一的真相源，宿主每次同步都按它重铺一遍——你改名、换阵容、改任务书、撤掉一支团队，用户升级后都会如实生效。对应地，用户改不动也删不掉它们（UI 只读展示）；想要一份自己调教的版本，用户复制一份自建档案即可。

宿主**不再内置任何人设**——装机自带的那几位现在也由 `preset-agent` 这个预置插件提供，所以你写的插件与它们走的是同一条路径、同一套字段。

- **不需要权限**：这是清单声明面，不是运行时 API。用户对「装了什么插件」本身知情，因此没有单独的授权开关。
- 校验在构建期（`vetta-plugin validate` / `pack`）就做：id 格式、路径越界、头像格式都会直接失败，而不是等用户装上后发现智能体没出现。

```json
{
  "agent": {
    "agents": [
      {
        "id": "designer",
        "name": "%agent.designer.name%",
        "description": "%agent.designer.description%",
        "mentionHandle": "designer",
        "avatar": "agent/agents/designer.webp",
        "systemPromptPath": "agent/agents/designer.md",
        "abilities": "all"
      }
    ],
    "teams": [
      {
        "id": "design-team",
        "name": "%team.design.name%",
        "members": [
          { "agent": "designer", "responsibility": "Owns the visual result end to end." }
        ],
        "workflowPath": "agent/workflows/design-team.md"
      }
    ]
  }
}
```

### agents[] 字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | ✅ | 插件内唯一，`^[a-z0-9][a-z0-9-]{0,63}$`。全局 id 由宿主拼成 `plugin:<pluginId>:<id>`，插件不要自己拼。 |
| `name` | ✅ | 支持 `%key%` 占位，按插件 `locales/` 解析；切语言即时跟随。 |
| `description` | ❌ | 同样支持 `%key%`，≤ 2000 字符。 |
| `mentionHandle` | ❌ | `@` 提及用的短名，缺省用 `id`。与用户已有 handle 冲突时宿主自动让号。 |
| `avatar` | ❌ | 插件包内相对路径，`.webp` / `.png` / `.jpg` / `.gif` / `.svg`，**单张 ≤ 512 KB**（要过一次 IPC）。 |
| `systemPromptPath` / `systemPrompt` | ✅（二选一） | 人设提示词。推荐用 `systemPromptPath` 指向 Markdown：提示词值得单独 diff。内联上限 64 000 字符。 |
| `abilities` | ❌ | `all`（默认）继承宿主全部已启用能力；`own` 只用本插件的能力。两种模式下**本插件的能力都强制激活，用户在能力面板里关不掉**——这个智能体存在的意义就是操作它自己的插件。 |
| `legacyIds` | ❌ | 本智能体**接管**的历史 blueprint id（≤ 16 个）。见下方「接管与升级」。 |
| `roles` | ❌ | 本智能体能顶的**角色 slug**（≤ 8 个）。声明了就能被别的插件按角色引用，见下方「被别人引用」。 |

### teams[] 字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | ✅ | 规则同 agents。 |
| `name` / `description` | `name` ✅ | 同样支持 `%key%` 占位。 |
| `members` | ✅ | 1–32 个成员，每个写 `{ agent \| role, responsibility, optional? }`。见下方「members[] 的两种引用」。 |
| `workflow` / `workflowPath` | ❌ | 队长的团队任务书，把这支团队的固定流水线写死。 |
| `legacyIds` | ❌ | 本团队接管的历史团队 id。 |

**第一个成员即队长**，也是用户在团队会话里唯一的对话入口。因此**队长只能是本插件自己的智能体**（写不带斜杠的 `agent`）：让它落在别的插件上，那个插件一卸载这支团队就成了打不开的壳。

### members[] 的两种引用

| 字段 | 说明 |
| --- | --- |
| `agent` | **实体引用**。`<agentId>` 指本插件的智能体；`<pluginId>/<agentId>` 指别的插件的。就是要那个人时用它。 |
| `role` | **角色槽位**。只声明「这里需要一个什么角色」，宿主在全部已启用插件里解析。 |
| `optional` | 解析不到这名成员时是否照常发布团队。缺省按引用方式走：本插件的实体引用 `false`，跨插件引用与角色槽位 `true`。 |
| `responsibility` | 一句全队可见的职责摘要，进共享名册。必填。 |
| `instructions` / `instructionsPath` | **这名成员的任务书**：追加在它本体人格之后、只给它看的交待。二选一，内联上限 64 000 字符。 |

`agent` 与 `role` **必须恰好写一个**，写零个或两个都会在构建期失败。

**队长的任务书写在团队的 `workflow` 里**，不要写进 `members[0].instructions`——两处都能写就没人说得清哪份生效，所以构建期直接拒掉。

**优先用角色槽位。** 实体引用把消费方钉死在一个具体的插件 id 上；角色槽位只耦合到一个角色名，提供方换人、换插件、被第三方取代都不影响你，用户还能把槽位改绑到自己调教过的智能体。

> **用到 `role` / `roles` / `optional` 的插件要把 `pluginApiVersion` 写成 `^2.2.0`；再用上 `members[].instructions` 的写 `^2.3.0`。** 清单校验对未知字段 fail-closed，旧宿主会整个拒掉这份清单（不是少一项贡献）；声明版本后，旧宿主给出的是「版本不支持」这种指向明确的错误。

```json
{
  "agent": {
    "teams": [
      {
        "id": "design-team",
        "name": "%team.design.name%",
        "workflowPath": "agent/workflows/design-team.md",
        "members": [
          { "agent": "my-lead", "responsibility": "Owns the visual result end to end." },
          {
            "role": "designer",
            "responsibility": "Turns the brief into reviewable frames.",
            "instructionsPath": "agent/briefs/designer.md"
          },
          { "role": "developer", "responsibility": "Implements the design." }
        ]
      }
    ]
  }
}
```

#### 给借来的成员派任务书

`instructions` 解决的正是「把别的插件的智能体拉进来，但要它按本团队的方式做事」：

- 任务书**挂在你的团队上，不碰对方的人设**。同一个设计师在别处照旧，在你的团队里按你交待的来。
- 与 `responsibility` 分工不同：后者是一句全队可见的职责摘要（进共享名册），前者是只给这名成员看的做事方式。
- 用 `instructionsPath` 指向 Markdown：任务书值得单独 diff，和人设提示词一个道理。**记得文件要能被打包**——路径会自动登记为插件资源，但源文件得真的在包里，缺了这名成员会让整支团队被跳过并打 warn。
- 任务书随插件升级整体更新：用户改不动它，下一版写什么用户看到的就是什么。

### 被别人引用（roles）

供货方要做的只有一件事：给智能体写上 `roles`。

```json
{ "id": "developer", "name": "%agent.developer.name%", "roles": ["developer"] }
```

之后谁引用、引用几次，供货方都不需要知道。

#### 装机自带的智能体

下面这些由预置插件供货，**任何一台机器上都解析得到**，可以放心引用。`role` 一列就是写进 `members[].role` 的值；想钉死某一个人，用 `agent` 列的全名。

来自 `preset-agent`（装机自带的五位）：

| role | agent | 名称 | 擅长什么 |
| --- | --- | --- | --- |
| `master` | `preset-agent/master` | 主控 | 端到端负责目标：规划流程、分派每一步、验收或打回结果 |
| `developer` | `preset-agent/developer` | 开发员 | 产出核心交付物：代码、成稿或一份做实的分析 |
| `researcher` | `preset-agent/researcher` | 检索员 | 收集事实、文档、既有方案与市场信号，并逐条核实 |
| `auditor` | `preset-agent/auditor` | 审计员 | 红队挑刺：正确性、安全、边界、回归与无依据的结论 |
| `business` | `preset-agent/business` | 业务员 | 把目标落成需求、范围与商业模式，并说清假设与风险 |

来自 `vetta-ui-design`：

| role | agent | 名称 | 擅长什么 |
| --- | --- | --- | --- |
| `designer` | `vetta-ui-design/designer` | 设计师 | 在 Vetta 设计画布上产出界面：App 页面、落地页、幻灯片与海报 |

这两个插件是**预置插件**，用户可以禁用但不会卸载。禁用时槽位按 `optional` 规则降级——用 `role` 引用它们的团队会少一名队员，重新启用后原样回来。

角色词表**不是白名单**：写表外的角色照样能解析，只是团队编辑器里没有现成的槽位选择器。反过来，你的插件也可以给自己的智能体写上这几个 role，用户装了之后同一个槽位就多一个候选（本插件优先，其次按 `pluginId` 字典序）。

**解析规则**（`BUILTIN_PLUGIN_AGENT_ROLES` 在 SDK 里导出）：

- 多个插件供同一个角色时，**本插件的人优先**，其次按 `pluginId` 字典序取第一个。刻意不看安装顺序——否则同一份配置在两台机器上会铺出不同的团队。
- 解析不到且 `optional`（跨插件引用与角色槽位的缺省值）：**少一名队员，不是少一支团队**。
- 解析不到且必填：整支团队跳过并打 warn。
- 成员 id 由**槽位**推导，不由占槽的人推导。角色换了提供方、阵容中间插了一个人，已有成员的 id 都不会漂——它们身上挂着用户的 `@handle` 与运行时状态。

### 生命周期

- **启用插件**：宿主把缺失的档案补齐——判据是「用户文档里现在有没有」，不是「历史上铺过没有」。因此旧版本数据缺失、一次异常都会被补回来。
- **升级插件**：清单里现在写的就是用户拿到的：名称、说明、能力、阵容与任务书按新清单整体重铺（档案里**不落 `systemPrompt`**，人设升级同样自动生效）。资源 id 与成员 id 不变，用户的团队绑定与会话引用因此不受影响。
- **撤掉资产**：新版本不再声明的智能体与团队会从用户那里消失，并从用户自建的团队里摘掉相应成员。这是「作者收得回自己发出去的东西」的那一条，与升级走的是同一次同步。
- **禁用插件**：档案**灰着留在原地**，既不隐藏也不从团队里摘掉，并标出「插件已禁用」。禁用不等于撤掉：清单还声明着它，就不会被当成残骸清理。重新启用后一切原样回来。
- **热重载**：开发态改完 manifest 重载插件，智能体与团队当场更新，不需要重启 App。
- **供货方后到**：铺团队时解析不到的槽位，会在提供方装上之后**自动补进阵容**——阵容本就按清单重排，不需要额外的补员规则。
- **跨插件引用的能力面**：别的插件的智能体自带 `pinnedPlugins`，进了你的团队就等于隐式拉起那个插件的能力，用户在能力面板里关不掉。引用之前想清楚这一点。
- **贡献出错**：单个智能体/团队解析失败（提示词读不到、头像超限、成员引用非法）只跳过它自己并打 warn，不影响同插件的其它贡献。

### 接管与升级（legacyIds）

`legacyIds` 用于「人设从别处迁进插件」：宿主解析不到这些历史 id 时折算到本智能体，铺档案时也据此**认领**用户已有的同角色档案，而不是再铺一份新的。认领只保留**身份**（档案 id 与团队绑定），内容按你的清单重铺。

装机自带人设迁进 `preset-agent` 走的正是这条路径（`executor` → `developer` 等）。宿主自己不需要知道是哪个插件接管了哪个老角色。

### 配套：新会话上下文区

插件贡献的智能体被选中时，往往还想在新会话页摆出「接下来多半要用到的素材」（风格库、模板墙）。那是另一个扩展点：[ui-slots → 新会话上下文区](./ui-slots.md#新会话上下文区-registernewsessioncontext)，`activateWhen.agents` 里写的就是这里的 `agents[].id`。
