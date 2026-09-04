# GitHub 开源能力市场格式

Desktop 从 GitHub 下载完整仓库归档，并在本地读取 `.vetta/marketplace.json`。GitHub 不承担搜索、筛选或分页；这些操作全部基于客户端已校验的本地快照完成。

## 客户端来源管理

云市场与 GitHub 来源独立启用：开源版只不包含云服务，仍可配置多个 GitHub 仓库；云版可同时浏览两类来源。
商业版默认不包含 GitHub 仓库。发行方通过 `VETTA_OPEN_MARKETPLACE_REPOSITORY` 声明可选内置来源，
未设置、空串或纯空白都不注册。开源发行版要随包提供官方源时同样配置这个变量，代码没有仓库地址兜底。
分支由 `VETTA_OPEN_MARKETPLACE_REF` 指定，省略时为 `main`；归档 URL 可单独配置，否则从仓库与分支推导。

在「能力 → 市场来源」可添加多个仓库，分别设置启用、自动更新和分支，并单独刷新。
内置来源可启停及设置自动更新，但不能在界面修改坐标或删除；自定义来源支持编辑和删除。
关闭自动更新后浏览只读缓存，手动刷新仍会拉取远程内容。同步失败会标记对应来源，有可用缓存则继续展示。
关闭或删除来源只影响目录发现，不卸载已经安装的能力。跨来源同名条目不合并身份，物理安装冲突仍需显式处理。

### 私有 GitHub 仓库

添加私有仓库时，在表单中填写 GitHub fine-grained personal access token（PAT），权限只需要目标仓库的
`Contents: Read-only`。令牌按来源单独保存到 Desktop 的系统安全存储，不会写入来源配置、市场快照、日志或发送给
Vetta 服务；界面只显示“已配置”，不会回显令牌。更新或清除来源时可以分别替换或删除令牌。

配置令牌后，客户端对 GitHub REST Contents/zipball API 使用 `Authorization: Bearer` 请求头。GitHub 返回的临时归档
重定向只携带普通下载请求头，不会把令牌转发到签名地址；未配置令牌的公开仓库仍沿用原有匿名 raw/archive 下载路径。
令牌失效、权限不足、仓库不存在和请求限流会在来源行显示对应状态，已有本地快照仍可继续浏览。

本地来源配置保持 `version: 1`，新增可选字段 `registeredDefaultRepositories`（规范化仓库 URL 数组）：

- 旧文件缺少该字段时按空数组读取，仅在环境声明仓库时协调该默认源；原有来源和用户启停/自动更新选择保留。
- 如果用户已手动添加同一仓库，沿用其 ID、名称、分支及开关，不另建内置重复项，避免改变安装来源身份。
- 记录已协调的默认仓库，使上述自定义来源被删除后不会在下次刷新时自动复活。
- 这是兼容旧文件的增量字段，不改变市场 manifest 或安装台账格式；旧客户端可能丢弃该字段，因此不保证降级后仍保留“已删除默认别名”的记忆。

更改构建环境需重启开发进程或重新构建发行包；界面配置和仓库内容更新不需要重新构建。
移除环境中的仓库配置不会删除已保存来源；这也适用于曾由旧版本自动创建的来源，可在界面停用它们。
参见 [构建模式](desktop/build-modes.md) 与 [ADR-0093](adr/0093-independent-cloud-and-github-marketplaces.md)。

## Manifest

```json
{
  "schemaVersion": 1,
  "name": "example-abilities",
  "displayName": "Example Abilities",
  "marketplaceVersion": "2026.08.1",
  "repository": "https://github.com/example/abilities",
  "minAppVersion": "0.5.11",
  "abilities": []
}
```

版本字段职责不同：

- `schemaVersion`：JSON 结构版本。支持 `1` 与 `2`；包路径 bundle 成员需要 `2`。
- `marketplaceVersion`：仓库内容发布版本；同一版本的归档内容不得变化。
- `minAppVersion`：必填，能够读取该内容的最低 Desktop SemVer 版本。
- `abilities[].version`：单个能力的产物版本。
- `abilities[].configVersion`：仅表示单个能力本地配置的结构版本，不用于选择客户端兼容性。

### 分组多语言

`category` 是稳定的分组标识和默认显示名；可选的 `categoryI18n` 提供分组译名，五种能力类型共用：

```json
{
  "category": "Documents",
  "categoryI18n": { "zh": "文档", "en": "Documents" }
}
```

译名只影响展示，不能用翻译结果替换 `category`，否则切换语言会改变分组归属。Desktop 按应用当前语言
匹配译名（兼容 `zh-CN` / `en-US` 等地区键），未提供或译名为空时显示原分类名。旧清单可省略此字段，
旧客户端会忽略此可选字段，无需修改 `schemaVersion` 或能力安装版本；内容变更仍须递增 `marketplaceVersion`。

多个来源使用相同 `category` 时仍归为一组，缺少的语言逐项补齐，同一语言保留列表中先出现的非空译名。
不同分类即使译名相同也不合并。内置的「连接」「Vetta 内置」「未分类」继续使用应用自带的 i18n 文案。

## Plugin、MCP 与 Bundle

Plugin 的 `source.path` 指向一个可直接安装的插件目录。目录至少包含 `plugin.json` 以及清单声明的已构建入口文件。客户端同步时校验 `plugin.json` 的 `id`、`version`、入口、样式路径，并从清单派生权限和命令展示信息；安装时复用 Desktop Plugin Store，默认保持禁用且不授予权限。

```json
{
  "type": "plugin",
  "slug": "demo-plugin",
  "name": "Demo Plugin",
  "version": "1.0.0",
  "source": { "path": "abilities/plugins/demo-plugin" }
}
```

MCP 必须有独立包目录。`marketplace.json` 只通过 `source.path` 指向目录，运行配置与可选的受管运行时声明放在目录内的 `mcp.json`。客户端同步时读取并校验该文件，再在用户安装时准备运行时并把解析后的 `server` 写入 `~/.vetta/agent/mcp.json` 的 `mcpServers[slug]`。索引内联 `config.mcp` 会被拒绝，避免索引与包文件形成两个真相源。

```json
{
  "type": "mcp",
  "slug": "context7",
  "name": "Context7",
  "version": "1.0.0",
  "configVersion": 1,
  "source": { "path": "abilities/mcp/context7" }
}
```

对应的 `abilities/mcp/context7/mcp.json`：

```json
{
  "schemaVersion": 1,
  "slug": "context7",
  "version": "1.0.0",
  "server": {
    "type": "http",
    "url": "https://mcp.context7.com/mcp"
  },
  "parameters": [
    {
      "key": "CONTEXT7_API_KEY",
      "label": "Context7 API Key",
      "required": false,
      "secret": true,
      "helpUrl": "https://context7.com/dashboard"
    }
  ]
}
```

### 受管二进制 MCP

自包含二进制使用 `schemaVersion: 2` 与 `runtime.kind: "managed-binary"`。产物必须使用 HTTPS，按平台声明固定
SHA-256；首期支持直接可执行文件与 ZIP，不执行仓库或产物提供的安装脚本。

```json
{
  "schemaVersion": 2,
  "slug": "xiaohongshu",
  "version": "1.0.0",
  "runtime": {
    "kind": "managed-binary",
    "platforms": {
      "win32-x64": {
        "url": "https://github.com/example/xiaohongshu-mcp/releases/download/v1.0.0/xiaohongshu-mcp.exe",
        "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "archive": "file",
        "executable": "xiaohongshu-mcp.exe"
      },
      "darwin-arm64": {
        "url": "https://github.com/example/xiaohongshu-mcp/releases/download/v1.0.0/darwin-arm64.zip",
        "sha256": "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        "archive": "zip",
        "executable": "xiaohongshu-mcp"
      }
    }
  },
  "server": {
    "command": "${VETTA_MCP_EXECUTABLE}",
    "args": ["--stdio"],
    "env": {
      "COOKIES_PATH": "${VETTA_MCP_DATA_DIR}/cookies.json",
      "BROWSER_CACHE": "${VETTA_MCP_CACHE_DIR}/browser"
    }
  }
}
```

上例中的仓库地址和 SHA-256 仅用于说明字段形状，发布时必须替换为实际 Release
产物及其校验值；客户端不会接受非 HTTPS 下载地址。

`server.command` 必须精确等于 `${VETTA_MCP_EXECUTABLE}`。`args`、`env` 与 `cwd` 还可以使用：

- `${VETTA_MCP_RUNTIME_DIR}`：当前版本运行目录；
- `${VETTA_MCP_DATA_DIR}`：升级和卸载运行文件时保留的用户数据目录；
- `${VETTA_MCP_CACHE_DIR}`：可再生成缓存目录。

Desktop 先下载、校验、解包并验证可执行文件，再解析占位符。最终写入 `mcp.json` 的仍是标准 stdio MCP 配置。
更新失败时保留原版本；卸载默认只移除运行文件，不删除登录态。完整决策见
[ADR-0092](./adr/0092-declarative-managed-runtimes-for-mcp-abilities.md)。

`server` 接受 Desktop 原生 MCP 配置格式：

- stdio：`command`、`args`、`env`、`cwd`。
- HTTP：`type: "http"`、`url`、`headers`、OAuth 公共参数。
- 固定安装参数直接放在 `args`、`env` 或 `headers`。
- 需要用户填写的值放在顶层 `parameters`。安装时客户端复用 MCP 参数弹窗收集；stdio 写入 `env[key]`，HTTP 写入 `headers[key]`。
- `required` 控制是否必填，`secret` 控制密码输入，`placeholder`、`helpUrl` 提供填写指引，`valueTemplate` 可声明 `Bearer {value}` 这类存储格式。
- 也可以在配置中使用 `${ENV_NAME}` 占位，运行时从环境变量解析。仓库不得提交真实 token、密钥或用户凭证。

例如带启动参数和私有环境变量的 stdio MCP：

```json
{
  "schemaVersion": 1,
  "slug": "demo-mcp",
  "version": "1.0.0",
  "server": {
    "command": "npx",
    "args": ["-y", "@example/demo-mcp", "--stdio"],
    "env": {
      "DEMO_API_KEY": "${DEMO_API_KEY}"
    }
  }
}
```

### Bundle 与独立上架

Bundle 没有独立安装产物，只组合本来源的成员。成员支持 `skill`、`scene`、`mcp` 和 `plugin`，不允许嵌套 Bundle。安装和卸载时均由用户在确认弹窗中选择成员，不强制一次处理全部成员。Bundle 自身可以提供可选的 `source.path`，但该目录只能承载下述展示文件。

格式 `1` / `2` 都支持以 `(type, slug)` 引用同一 manifest 顶层已注册的能力：

```json
{
  "type": "bundle",
  "slug": "starter-bundle",
  "name": "Starter Bundle",
  "version": "1.0.0",
  "config": {
    "members": [
      { "type": "skill", "slug": "hello-vetta" },
      { "type": "mcp", "slug": "context7" },
      { "type": "plugin", "slug": "demo-plugin" }
    ]
  }
}
```

格式 `2` 还允许成员提供 `source.path`，指向**市场根目录下**的能力包；这样无需在顶层重复注册：

```json
{
  "type": "bundle",
  "slug": "research",
  "name": "Research",
  "version": "1.0.0",
  "config": {
    "members": [
      { "type": "skill", "slug": "research-guide", "source": { "path": "abilities/skills/research-guide" } },
      { "type": "mcp", "slug": "research-search", "source": { "path": "abilities/mcp/research-search" } }
    ]
  }
}
```

未独立注册的成员必须在包内 `ability.json` 声明目录元信息。例：

```json
{
  "schemaVersion": 1,
  "type": "skill",
  "slug": "research-guide",
  "name": "Research Guide",
  "description": "Choose queries and cite sources.",
  "version": "1.0.0",
  "configVersion": 1,
  "category": "Research",
  "categoryI18n": { "zh": "调研", "en": "Research" },
  "detail": {
    "format": "markdown",
    "path": "README.md",
    "i18n": { "zh": { "name": "检索指南", "description": "选择查询并标注来源。", "path": "README.zh.md" } }
  }
}
```

- 顶层 `abilities[]` 决定独立上架。未列出的成员不进入「发现」、搜索结果和顶部图标区，但仍出现在
  bundle 详情、安装选择弹窗及安装后的「我的」中，可更新、启停和卸载。磁盘上未被任何条目引用的包不会自动加载。
- 成员 `type` / `slug` 必须与包一致，`version` 必须与 `SKILL.md` / `mcp.json` / `plugin.json` 一致。
  名称必填；其他目录字段沿用独立条目的规则。包元信息不能含 `source` 或 `config`，安装配置仍只来自对应类型的包文件。
- 多个 bundle 可以引用同一个成员；同一 slug 不得指向不同类型或不同路径。成员也在顶层注册时，以顶层目录字段为准，
  路径必须一致，仍只保留一个目录身份；图标和详情沿用原有包展示合并规则。无路径的引用仍必须指向顶层条目。
- 上架/取消独立上架不改变 `sourceId + type + slug`，不迁移安装台账或重置禁用状态、凭据、权限；
  只有展示方式变化时不必改能力的 `version` / `configVersion`，但必须更新 `marketplaceVersion`。
- 格式 v2 需包含本功能的 Desktop 构建（首个目标版本 `0.5.49`）；已运行的旧构建不会通过刷新自动获得解析能力。
  旧客户端拒绝 v2 整个来源并沿用可用的旧缓存。先更新客户端再切换源格式；需要兼容旧客户端的仓库应继续用 v1。

参见 [ADR-0094](adr/0094-package-referenced-bundle-members.md)。市场 schemaVersion 与包内的 schemaVersion 独立演进。

## 能力自带图标与详情

独立上架条目的轻量元信息由 `marketplace.json` 提供，bundle-only 成员由包内 `ability.json` 提供；图标、长详情和展示图片可以与能力包放在同一 `source.path` 下：

```text
abilities/mcp/context7/
├── mcp.json
├── ability.json
├── README.md
├── detail.json
└── assets/
    ├── icon.svg
    └── preview.webp
```

`ability.json` 是展示入口，身份字段必须与对应的目录能力完全一致；bundle-only 成员还需提供上节所述目录字段：

```json
{
  "schemaVersion": 1,
  "type": "mcp",
  "slug": "context7",
  "version": "1.0.0",
  "icon": "assets/icon.svg",
  "detail": {
    "format": "blocks",
    "path": "detail.json",
    "fallback": "README.md",
    "meta": [
      { "key": "docs", "value": "https://context7.com/docs" }
    ],
    "i18n": {
      "zh-CN": { "format": "markdown", "path": "README.zh-CN.md" }
    }
  }
}
```

- `icon` 支持能力目录内的相对图片、`https://` 图片和已有的 `solar:` 图标；本地图片优先，离线可用且随市场版本缓存。
- `detail.format: "markdown"` 时，`path` 直接指向 Markdown 文件。
- `detail.format: "blocks"` 时，`path` 指向结构化详情 JSON；解析失败且声明了 `fallback` 时回退到 Markdown。
- `i18n[locale]` 可以覆盖格式和文件路径；未命中语言时使用顶层详情。
- 列表名称、简介可写在 `marketplace.json` 的 `detail.i18n[locale]`，正文可单独放在 `ability.json`
  的同语言引用中。Desktop 按语言、按字段合并二者：包内显式提供的字段优先，未提供的字段保留目录值；
  数组整体替换、不拼接，空数组和空正文保留其显式覆盖含义。
- 能力卡片、搜索和详情使用应用语言系统的当前语言，随应用切换即时更新；兼容 `zh` / `zh-CN`、
  `en` / `en-US` 等语言键。切换不需要重新下载市场或安装能力，旧快照在读取时同样应用合并规则。
- 所有相对路径都必须留在当前能力目录内。客户端限制描述文件、详情文件和图片大小，并拒绝非图片资源。

结构化详情由客户端白名单组件渲染，不执行仓库提供的 HTML、JavaScript、CSS、iframe 或自定义操作。当前区块包括 `hero`、`feature-grid`、`steps`、`showcase`、`image`、`gallery`、`stats`、`comparison`、`callout`、`markdown` 和 `links`：

```json
{
  "schemaVersion": 1,
  "blocks": [
    {
      "type": "hero",
      "title": "让 Agent 在真实浏览器里工作",
      "description": "品牌头图、徽章和图片由能力包声明，布局由 Desktop 统一渲染。",
      "image": "assets/logo.svg",
      "badges": ["可见窗口", "提交前确认"]
    },
    {
      "type": "feature-grid",
      "title": "Capabilities",
      "items": [
        { "title": "Current docs", "description": "Fetch version-specific documentation." },
        { "title": "Code examples", "description": "Add relevant examples to the context." }
      ]
    },
    { "type": "image", "src": "assets/preview.webp", "alt": "Context7 preview" },
    { "type": "markdown", "path": "README.md" },
    {
      "type": "links",
      "items": [{ "label": "Documentation", "href": "https://context7.com/docs" }]
    }
  ]
}
```

`markdown` 区块可使用内联 `content`，也可用 `path` 引用能力目录内的 Markdown 文件；二者必须且只能提供一个。
这允许在 `showcase`、`feature-grid` 等结构化区块之间插入长篇 Markdown，而不必把整篇正文转义成单行 JSON 字符串。

安装、权限、MCP 参数和 Bundle 成员选择仍由客户端固定区域渲染，详情文件不能覆盖这些安全相关交互。

## 兼容规则

- 新增字段应优先设计为可选字段，不改变已有字段含义。
- 客户端版本低于 `minAppVersion` 时不会激活新快照；存在旧的兼容快照时继续使用旧快照。
- 开发期不兼容缺少 `minAppVersion` 或使用旧字段名的 Manifest；直接修改仓库中的 `.vetta/marketplace.json`。
- 当前不使用 `marketplace-index.json`。只有同一仓库确实需要并存互不兼容的 Schema 时才重新评估。

## 发布规则

1. 修改能力内容或 Manifest 后必须生成新的 `marketplaceVersion`。
2. 每个 Manifest 都必须设置对应的 `minAppVersion`。
3. 不从 GitHub 仓库执行 JavaScript、shell、PowerShell 或其它安装/迁移脚本。
4. 发布前必须校验 Manifest、能力目录、能力版本和来源路径。

## 本地缓存身份

客户端将 `sourceId`、`repository`、`ref` 和 `archiveUrl` 共同作为市场来源身份。每一种来源配置都使用独立的指纹缓存目录；修改仓库、分支或归档地址后，不会继续读取旧配置的缓存。

同一来源身份下，`marketplaceVersion` 对应的内容仍然不可变。来源身份发生变化时，即使新来源暂时使用相同的 `marketplaceVersion`，也允许下载并建立新的缓存快照。

能力页打开时优先立即返回本地快照，并在后台读取 GitHub 上的 `.vetta/marketplace.json`。只有远端 `marketplaceVersion` 变化时才下载完整仓库归档；更新成功不发送通知，已打开的能力页只静默重读本地快照，未打开时则在下次进入时读取。后台检查失败时继续使用已有快照，不向用户产生干扰；用户主动点击刷新仍会立即执行完整同步并返回结果。

## 内置来源配置

内置 GitHub 来源不在代码中设置仓库地址，完全由环境变量提供：

- `VETTA_OPEN_MARKETPLACE_REPOSITORY`：GitHub 仓库 URL；未设置时不创建内置来源。
- `VETTA_OPEN_MARKETPLACE_REF`：分支或 ref，默认 `main`。
- `VETTA_OPEN_MARKETPLACE_ARCHIVE_URL`：可选归档地址；未设置时根据仓库与 ref 推导。
