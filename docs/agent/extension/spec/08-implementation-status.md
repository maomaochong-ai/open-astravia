# 首轮实施状态

本文记录 ADR-0063 的首个可运行切片。它不是对整份目标架构“已完成”的声明；未列入已实现项的能力继续按 compatibility profile fail closed。

## 已实现

### Runtime Tool validator Port

- `RuntimeToolDefinition.validateInput` 已从 `@vetta/runtime-core` 透传到 Agent engine；
- 没有自定义 validator 的 Tool 仍走原有 JSON Schema 校验；
- validator 可以完成 normalize/decode，异常仍由 Agent engine 归类为 Tool input invalid；
- Runtime Core 不依赖 Pi、TypeBox 1 或 Zod。

### Vetta native Tool authoring

Native `ToolDefinition` 新增：

- `normalizeInput`：在 Schema 校验前规范化 Provider 参数；
- `validateInput`：为隔离的 Schema dialect 提供 validator/decoder；
- `prompt.summary/guidelines`：只在 Tool 对当前 model call active 时发布到 `SystemPromptDraft`。

Prompt block 有稳定 id、extension source、priority 和既有 token diagnostics。Tool refresh 已改为复用 ADR-0062 的 `DynamicContributionCatalog`；旧 lease 不能删除新 generation，移除 source 后下一次 model-call snapshot 不再看到旧 Tool，已经捕获的 Tool binding 保持稳定。

### Pi Tool compatibility ACL

已新增显式入口 `@vetta/coding-agent/extensions/pi-compat` 的 `loadPiExtensions()`，native `loadExtensions()` 不暴露 Pi virtual module。首个 profile 是 `pi-extension-0.84-host-neutral-v1`，当前证明过的映射为：

| Pi 行为 | Vetta 投影 | 状态 |
| --- | --- | --- |
| `registerTool` + TypeBox 1 Schema | plain JSON Schema + 隔离的 TypeBox 1 validator | adapted |
| Tool/event handler `ExtensionContext` | 只保证双方共有字段；Pi-only mode/scoped model/trust 字段不存在 | host-dependent |
| `prepareArguments` | native `normalizeInput` | adapted |
| `promptSnippet/promptGuidelines` | native active-tool prompt contribution | adapted |
| `executionMode: undefined/sequential` | 既有 sequential Tool loop | lossless |
| `executionMode: parallel` | 加载失败 | unsupported |
| `renderCall/renderResult` | 不注册并写 compatibility report | excluded |
| `registerShortcut` | 不注册并写 compatibility report | excluded |
| 已核对 payload 的共有事实事件 | 既有 native event pipeline；Context 仍受宿主交集限制 | host-dependent |
| `agent_settled` 等尚无准确事实源的事件 | 加载失败 | unsupported |
| Provider registration | 在 owner/unregister 完成前加载失败 | unsupported |
| Flag 与跨 Extension event bus | 在原子 publish / generation teardown 完成前加载失败 | unsupported |
| 未列入 profile 的其他 API（如 Command、会话写操作） | 属性访问时加载失败 | unsupported |

当前 module facade 只开放 Tool corpus 所需的 current/legacy Pi package root、`Type`、`StringEnum` 和 `defineTool`。未验证的 Pi SDK、Agent Core、AI provider export、subpath 与 TUI 没有被伪装成完整 Pi 包。

事件以 payload 合同而非同名判断：例如 Pi current 的 `session_start` 新增必需 `reason`，`before_agent_start` 新增必需 `systemPromptOptions`，compact/shutdown/fork 事件也增加了事实字段；Vetta 尚不能准确提供时，它们即使同名也仍为 unsupported。

## TypeBox 与 Zod 决策

实现引入精确版本 `typebox@1.3.7`，只由 `extensions/pi-compat` validator 和 Pi module facade 使用。进入 native Tool contract 的 Schema 先 `structuredClone` 为 plain JSON Schema；校验仍由原始 TypeBox 1 Schema 的 `Compile`/`Value.Convert` 完成，TypeBox 1 symbol 不进入 Runtime Core。

没有新增 Zod Schema。当前边界已有 Tool Schema 事实源，使用 Zod 再描述一次会制造漂移；当 compatibility 配置发展成需要 preprocess/default/cross-field refine 的独立配置对象时再复用仓库现有 Zod。

## 尚未实现

- 所有 Extension contribution 共用的 `ContributionDraft -> immutable ContributionSet`；当前只迁移了 Tool refresh catalog。
- factory 失败的完整跨 contribution 原子发布和 activation 后动态 transaction。
- `agent_settled`、session metadata、thinking level 等新增 native 事实事件。
- Provider generation owner、unregister、built-in restore 与 reload rollback。
- Pi Command、Flag、event bus、资源路径、结构化 interaction 的差分 corpus。
- Pi AI `/compat`、Agent Core 的逐 export facade。
- project trust 与 compatibility profile 的宿主配置接线。

这些能力不能因为 API 名称相似而标成 supported。特别是 Provider 与 settled 事件，在原生生命周期完成前继续硬拒绝。

## 测试证据

首轮测试覆盖：

- Runtime validator decode 后再执行；
- native normalize 成功与 Schema 失败；
- prompt contribution 的 active/inactive model-call boundary 和 source；
- Tool Catalog first-wins、source retire、refresh 与 captured frame；
- 使用 Pi current namespace 和真实 TypeBox 1 的端到端 Extension fixture；
- renderer/shortcut compatibility report；
- parallel Tool、未落地事件 fail closed；
- 未列入 profile 的 API 不会因 Vetta native API 同名而被意外透传；
- native loader 不泄漏 Pi module facade。

后续每增加一个 capability，仍需同时补 native fixture、port/catalog contract test 和 Pi projection fixture。
