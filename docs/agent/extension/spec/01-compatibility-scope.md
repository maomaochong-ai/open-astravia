# 兼容目标与功能范围

## 目标与不变量

### 目标

- 无修改或只改配置即可加载常见 Pi Extension 和 Pi Package。
- 同时支持当前包名 `@earendil-works/pi-*` 与历史包名 `@mariozechner/pi-*`。
- Extension 的工具、共有事件、命令、会话动作和资源贡献进入 Vetta 已有会话与 Runtime。
- 只保留可投影为宿主中立 request/response 的 `notify/select/confirm/input`，不加载或模拟 Pi TUI。
- 加载前能生成/更新结构化兼容报告，说明不支持项及其原因。
- Vetta native Extension 保持兼容，Pi 兼容层可以独立升级和关闭。

### 必须保持的不变量

- 不恢复 `src/core` 或退役的通用 `src/compat` 执行路径。
- 不让 `runtime-*` 反向依赖 `coding-agent` 或 Pi 类型。
- Tool 的错误、取消、进度、usage、结果内容和 model-call 可见性不能静默改变。
- Session replacement、reload、shutdown 后旧 context 不得操作新 generation。
- Extension 加载失败不能留下工具、Provider、事件订阅或命令的半注册状态。
- Unsupported 能力默认 fail closed；只有明确标记为 `inapplicable` 的宿主能力可以跳过。
- 不以兼容名义自动执行未信任项目中的代码。

## 兼容定义

“能 import”不等于兼容。每项能力需要标记以下状态：

| 状态 | 定义 | 用户可见行为 |
| --- | --- | --- |
| `lossless` | Pi 语义与 Vetta 合同等价 | 正常加载，无兼容警告 |
| `adapted` | 通过明确转换保持主要行为 | 报告转换点和已知差异 |
| `host-dependent` | 仅某些宿主有等价能力 | 在支持宿主启用，其余宿主报告 inapplicable |
| `excluded` | 明确不属于 Vetta 兼容目标 | 不进入路线；可安全剥离时记录诊断，否则拒绝加载 |
| `unsupported` | 无法安全或正确表达 | 默认拒绝加载该贡献或整个 Extension |

兼容判定的基本单元是 capability，不是 Pi package version。Pi Extension 没有可靠的 Extension ABI 声明，包名和源码版本不足以推断实际用到的 API。

Extension 级结果使用 `compatible`、`compatible-with-adaptations`、`runnable-with-exclusions`、`rejected`。只要剥离了 renderer、Theme 等 excluded 能力，就只能报告 `runnable-with-exclusions`，不能显示为“完全兼容”。

## 推荐功能分级

一个 Pi 能力只有同时满足以下条件，才进入兼容 profile：

1. Vetta 已有或适合新增宿主中立的 public port，不需要暴露 Pi manager/component；
2. 输入、输出、取消、错误和生命周期可以用合同测试证明，而不只是 TypeScript shape 相似；
3. 能由 generation owner 完整注册和撤销，不留下全局副作用；
4. 不扩大 prompt、credential、header、文件或宿主 UI 的可见范围；
5. 在 Desktop、CLI、RPC、SDK 中语义一致，或能明确标为 host-dependent。

满足产品价值但 Vetta 当前合同尚不完整的能力，必须先按 [Vetta 原生能力先行方案](07-vetta-native-first.md) 实现。Pi adapter 只能映射已经通过 native Extension fixture 的能力，不能在 `pi-compat` 内补一套临时目录、事件或执行器。

按这些条件，首个 profile 的边界是：

| 分类 | 能力 |
| --- | --- |
| 直接兼容 | Package Extension/Skill/Prompt、Tool 执行、共有事件、Command、消息/会话 metadata actions、tool/model/thinking actions、event bus |
| 条件兼容 | `notify/select/confirm/input`、CLI flag、session replacement、配置型 Provider 字段交集 |
| 明确排除 | Pi TUI module、Theme、Component、renderer、widget/header/footer、terminal input、shortcut、展示变换 |
| 首个 profile 不支持 | `project_trust` handler、Provider request hooks、native Provider、OAuth、动态 model refresh、parallel Tool、constrained sampling |

其中 Tool 执行、共有事件、Command 和大部分 actions 已有原生基础；catalog/generation、Tool input normalize/custom validator、Tool prompt contribution、状态变化事件和 Provider owner/unregister 是兼容前要先补齐的 Vetta 原生能力。

### L0：模块与 Package 发现

| 功能 | 状态目标 | 说明 |
| --- | --- | --- |
| `package.json#pi` 的 extensions/skills/prompts | `lossless/adapted` | 复用 Vetta 已有发现与来源模型 |
| `package.json#pi` 的 themes | `excluded` | Pi Theme 属于 TUI 展示资源，不安装为 Vetta Theme |
| `@earendil-works/pi-coding-agent` | `adapted` | 指向专用 facade，不指向 Vetta 包根 |
| `@mariozechner/pi-coding-agent` | `adapted` | 与 current namespace 使用同一 facade |
| `typebox` / `typebox/compile` / `typebox/value` | `adapted` | 兼容层隔离 TypeBox 1；Schema 跨边界转成 plain JSON Schema |
| 历史 `@sinclair/typebox` imports | `adapted` | Pi loader 的兼容行为，不能污染 Vetta native authoring contract |
| Pi AI/Agent 包 | 分 export 判定 | 只提供行为子集需要的 facade exports，不导出整个 Vetta 内部实现 |
| `@earendil-works/pi-tui` / legacy namespace | `excluded` | 不提供 virtual module；存在 runtime import 时拒绝加载 |

### L1：首个可用版本

优先覆盖 Pi 生态中最常见、且可由 Vetta 宿主无关合同表达的能力：

| 能力 | 目标 | 关键语义 |
| --- | --- | --- |
| async/default Extension factory | `lossless` | 注册阶段禁止调用尚未绑定的 runtime action |
| `registerTool` 行为字段 | `adapted` | Schema、execute、update、cancel、结果与下一 model call 可见性 |
| Tool prompt/argument 字段 | `adapted` | native prompt contribution 与 input normalizer 完成后映射 |
| `executionMode` | 部分 `adapted` | `undefined/sequential` 匹配 Vetta 当前语义；`parallel` unsupported |
| 双方共有的 `on()` 事件 | `adapted` | 事件顺序和 result chaining 按显式表转换 |
| `registerCommand` | `adapted` | 参数字符串、command context 和宿主可用性 |
| `sendMessage/sendUserMessage/appendEntry` | `adapted` | deliverAs、持久化与 triggerTurn 语义 |
| session name/label | `adapted` | 通过现有会话 Port，不暴露具体 Manager |
| active tools/get tools/get commands | `adapted` | 返回 Pi shape 的只读投影 |
| model/thinking getters/setters | `adapted` | 使用 Vetta model catalog 和公开 thinking contract |
| `exec` | `adapted` | 使用 Vetta 现有执行 action，保留 cwd/signal/error 语义 |
| Extension event bus | `adapted` | subscription 归属 generation，reload 自动取消 |
| `notify/select/confirm/input` | `host-dependent` | 映射为 Vetta 结构化交互；不传递 Pi Component/Theme |
| `resources_discover` | `adapted` | 资源路径带 sourceInfo，进入现有 refresh boundary |

对 Pi current `examples/extensions` 下 85 个 TypeScript 文件（含子目录）做简单文本统计，`pi.on()` 约 87 次、`registerCommand` 约 55 次、`registerTool` 约 42 次；`ctx.ui.*` 虽出现约 266 次，但其中包含大量终端展示调用。该统计只用于选择 corpus：事件、命令和 Tool 是优先兼容对象；UI 使用量不能被换算为兼容率，依赖 TUI 的示例应直接标记 excluded。

### L2：生命周期与会话能力

| 能力 | 目标 | 处理方式 |
| --- | --- | --- |
| stale context / generation invalidation | `lossless` | 作为所有 Pi Extension 的基础，不是可选功能 |
| `newSession/fork/switchSession` | `adapted` | 使用 Vetta transition transaction |
| `withSession` | `adapted` | commit 后提供绑定新 session 的 fresh context |
| `navigateTree/reload/compact` | `adapted` | 复用现有 Session Host，保持取消与失败回滚 |
| `ctx.sessionManager` | 部分 `adapted` | 提供只读 Pi facade；不暴露 Vetta manager |
| `ctx.modelRegistry` | 部分 `adapted` | 提供只读查询和 auth facade；写操作走专用 Provider port |
| `agent_settled/session_info_changed/thinking_level_select` | 部分 `adapted` | 先新增 Vetta native fact events，再投影可表达字段；不用近似事件伪造 |
| `registerFlag/getFlag` | `host-dependent` | 仅显式支持 CLI flag 的启动宿主启用 |
| `registerShortcut` | `excluded` | Pi key id 与终端输入生命周期不进入兼容层 |

### L3：Provider 与请求链

| 能力 | 首个 profile 状态 | 处理 |
| --- | --- | --- |
| config-form `registerProvider(name, config)` 字段交集 | `adapted` | 只接受 Vetta ProviderConfig 可表达的 allowlist |
| `unregisterProvider` | `adapted` | 目录支持 generation owner 和 builtin restore |
| config `streamSimple/refreshModels/OAuth` | `unsupported` | Pi current 签名和生命周期已超出双方合同交集 |
| full native `Provider` | `unsupported` | 不把 Pi Provider 对象接入 Vetta Runtime |
| `before_provider_request` | `unsupported` | 不向 Extension 暴露请求 payload |
| `before_provider_headers` | `unsupported` | 不向 Extension 暴露敏感 header |
| `after_provider_response` | `unsupported` | 不增加另一套 response/stream 生命周期 |

Provider 不能为了提高表面兼容率而直接把 Pi `Provider` cast 成 Vetta Provider。两边的消息、usage、stop、auth、refresh 和 stream 回调已经分叉。

### L4：明确排除的 TUI 与展示能力

| 能力 | 状态 | 理由 |
| --- | --- | --- |
| `pi-tui` runtime imports | `excluded` | 不提供 facade 或 bridge |
| `Component`、Theme、Keybindings、raw terminal input | `excluded` | 具体终端对象不是 Vetta 行为合同 |
| status/widget/header/footer/title/working indicator | `excluded` | 展示 slot 和 redraw 语义不兼容 |
| custom/editor component、autocomplete provider | `excluded` | 不执行 Pi component factory |
| message/entry renderer、Markdown transformer | `excluded` | 不运行 Pi transcript 展示代码 |
| Tool `renderShell/renderCall/renderResult` | `excluded` | 注册时剥离并记录诊断，Tool execute 仍可兼容 |
| Pi package Theme | `excluded` | 不安装、不转换成 Desktop 或 CLI Theme |

`notify/select/confirm/input` 不属于上述 TUI 兼容：facade 只传递字符串、选项、结果、取消和 timeout，将其转换为 Vetta 自己的结构化交互。任何需要 Pi `Component`、Theme 或 terminal redraw 的调用都不支持。

## Extension 级加载策略

不能简单规定“存在一个 unsupported 注册就全部忽略”。推荐 policy：

- `strict`（启用后的默认策略）：任何会改变 Agent 行为的 unsupported capability 都拒绝发布整个 Extension。
- `host-aware`：允许结构化交互在无 UI 宿主返回 `HOST_INTERACTION_REQUIRED`，其余行为能力保持 strict。
- `inspect-only`：执行注册阶段并生成报告，不发布任何贡献，供开发者和安装界面预检。

对于 excluded 能力采用两条不同规则：

- Tool 上的可选 render 字段、renderer/transformer 注册和 package Theme 可以被剥离，但必须生成 `PI_COMPAT_EXCLUDED_PRESENTATION`；
- runtime `pi-tui` import、factory 初始化所需的 Component 或运行时调用 excluded UI 方法无法安全跳过，直接拒绝加载。

不提供“best effort 静默运行”模式。它会让 Extension 看似加载成功，却在关键事件或权限检查缺失时产生错误行为。

## 非目标

- 不保证所有 Pi 示例或任意 npm 依赖无需修改即可运行；UI-only 示例和游戏不属于 corpus。
- 不兼容 `pi-tui`、Pi Theme、terminal renderer、Component 或终端快捷键，且不在后续阶段补建 TUI bridge。
- 不提供 Pi 进程、Pi SessionManager 或 Pi ModelRegistry 实例。
- 不直接依赖 `@earendil-works/pi-coding-agent` 作为 Vetta 生产运行时。
- 不承诺 Pi 未声明的私有深度导入。
- 不让 current 与 legacy Pi 兼容变成两条独立 Runner。
- 不把 project trust、Plugin permission 或工具 sandbox 描述为代码隔离。
