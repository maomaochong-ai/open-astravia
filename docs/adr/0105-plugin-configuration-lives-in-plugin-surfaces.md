# ADR-0105：插件配置由插件自有界面承载，宿主不再提供设置页配置槽

## 状态

已接受

## 背景

插件配置此前有一条专属通路：插件在 `plugin.json#contributes.settings` 声明字段 Schema，宿主
在「设置 → 工具配置」Tab 用统一表单渲染，值由 `PluginSettingsStore` 持久化（`type: "secret"`
落 `CredentialVault` 加密，其余落明文 `plugin-settings.json`），插件通过只读的 `ctx.settings`
读取。写入只能发生在宿主设置页。

这条通路带来三个问题：

1. **配置入口分散。** 用户配置一个插件可能要去三个地方：插件自己的 Workspace 视图、能力详情页、
   以及「设置 → 工具配置」。三者没有主次关系，同一个插件的开关可能分布在其中两处。
2. **表达力被 Schema 框死。** 统一表单只能渲染 boolean/number/string/secret/enum 与一层
   `visibleWhen`。需要连通性探测、模型列表拉取、工作流选择、示例预览的插件（本仓库的
   `content-creation`、`comfyui-media-provider` 都是）无法在该表单内完成配置闭环，最终仍要在
   自己的界面里再做一遍。
3. **只读 API 与可写 UI 割裂。** `ctx.settings` 只有 `get/getAll/onChange`，插件自有界面无法写入
   自己的配置，导致「插件自己画配置页」这条更强的路径事实上不可用，只能退回宿主表单。

同时，「工具配置」Tab 里还混着一个非插件项：内置的 `coding.images`（Runtime Configuration
`coding.images`，值存 agent settings 的 `images`）。它与插件配置没有共同的领域含义，只是恰好都由
Runtime Configuration 控制面投影而来。

## 决策

1. **插件配置的唯一承载是插件自己的界面。** 推荐 `registerWorkspaceView` 注册的 Workspace 配置页
   （完整形态：可配置、可诊断、可预览）；轻量场景可用能力详情槽或活动 Tab 内的局部设置。宿主不再
   提供「把字段声明出去、由宿主渲染」的配置槽。
2. **移除 `plugin.json#contributes.settings` 与 `ctx.settings`。** manifest 顶层
   `additionalProperties: true`，旧插件带 `contributes` 不会校验失败，但字段不再有任何运行时语义。
   `ctx.agent.registerTool({ configuration.settingKeys })` 一并移除——它唯一的语义是关联
   `contributes.settings`，失去被关联对象后即为悬空概念。
3. **普通配置走插件私有存储 `ctx.storage`。** 宿主约定迁移落点为 JSON key `settings`：升级时一次性
   把 `plugin-settings.json` 中每个插件的非密钥字段写入该插件私有存储的 `settings`，插件读回后自行
   归一化。宿主不解释这些值的结构。
4. **密钥不降级：新增 `ctx.secrets` 与 `secrets.read` / `secrets.write` 权限。** 插件密钥继续由
   `CredentialVault` 加密保管，命名空间沿用 `plugin-settings`（避免既有密钥失联），owner 恒等于调用方
   plugin id，由主进程按 capability session 反查，插件不能读写其它插件的密钥。API 只暴露
   `get/set/delete/has/keys/onChange`，`keys()` 只返回键名，不返回值。
5. **删除「设置 → 工具配置」Tab。** 其中唯一的内置项 `coding.images` 并入「设置 → Agent 配置」，
   作为一个 section 呈现。Runtime Configuration 控制面（`RuntimeConfigurationCenter` 与 Desktop
   Service）保留，继续作为内置运行时配置的事实源，但不再合成插件 Definition，`consumers` 投影
   随 `settingKeys` 一同移除。

## 备选方案

- **保留 `contributes.settings`，仅把渲染位置搬到插件详情页。** 入口数量没有真正减少，Schema 表达力
  问题原样保留，且会长期维持两套配置写入路径（宿主表单与插件自有页面）。
- **保留字段并新增 `ctx.settings.set()`。** 能让 Workspace 页写入同一份值，但代价是宿主永久承担一套
  与插件界面重叠的表单渲染与 i18n 通路，与「减少入口」的目标相反。
- **全部改用 `ctx.storage`，不新增密钥 API。** 改动最小，但会把 API Key 从加密凭据库退回明文 JSON，
  属于安全降级，不可接受。

## 后果

- **公共合同破坏性变更。** `contributes.settings`、`ctx.settings`、`registerTool.configuration`
  在 Plugin API `1.6.0` 移除。依赖它们的第三方插件需要改为自绘配置页；已配置的普通值由宿主自动迁移，
  已保存的密钥因命名空间不变而原地可读。
- 宿主减少一个设置 Tab、一套 Schema 表单渲染、一条设置写入 IPC 与对应 i18n；插件侧多一次「自己画配置页」
  的成本，换来配置与业务界面同处一屏。
- 插件密钥的读写从「只有宿主能写」变为「获授权插件可写自己的密钥」。这是权限面的扩大，因此单独设权限、
  按 capability session 定 owner，并且不提供跨插件访问。
