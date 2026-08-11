# 第 61 轮：Model Call Frame Composer 与调用级 Prompt 等价切片

## 目标

在不切换默认 Legacy 入口、不改变工具功能的前提下，建立完整模型调用输入等价所需的最后一层
调用级编排边界：

```text
静态 Snapshot
  + 动态 Feature Contribution
  -> 候选 ModelCallFrame
  -> Profile 唯一 ModelCallFrameComposer
  -> systemPrompt + messages + tools
```

本轮先完成确定性排序、完整只读调用上下文、既有 Coding Agent Prompt 编译器适配、CLI 显式组合和
MCP Prompt 状态合并。动态 Plugin Provider 的运行期 effect 尚未接入，因此默认入口继续保持 Legacy。

## 发现的问题

### 1. `InstructionBlock.priority` 只有类型，没有执行语义

Runtime Core 已定义 `priority`，旧 `renderSystemPromptDraft()` 也按 `priority + id` 排序，但
`FeatureCompiler` 和 `resolveModelCallFrame()` 都只保留数组插入顺序。

这会让 Feature 拓扑、注册顺序和对象插入顺序意外决定最终系统提示词顺序。

### 2. 动态 Contribution 不能完成产品级最终编译

原 `ModelCallContributionProvider` 只能追加 instructions/tools，而且调用上下文只有 session、turn、
signal 和 input。旧 Coding Agent Prompt 与 Plugin Provider 还需要当前：

- 模型绑定；
- 已积累的模型可见消息；
- 动态 Feature 汇总后的实际工具集合；
- 每次 Tool Loop 后重新物化的调用状态。

继续往 Contribution 中加入 replace/remove 等通用操作会把它变成任意 Middleware，并把 Coding Agent
的 Plugin 语义污染到 Runtime Core。

## 实施

### 1. 确定性 Instruction 排序

Feature 编译、调用级动态贡献汇总和最终 system prompt 渲染统一使用：

```text
priority 升序
-> id 字典序
```

静态 Snapshot、动态 Frame 和公开渲染函数不再依赖插入顺序。

### 2. Profile 唯一 `ModelCallFrameComposer`

Runtime Core 新增一个可选、Profile 独占的最终编译合同：

- 一个 Profile 最多一个 Composer；
- Composer 在所有静态/动态 Contribution 汇总并完成冲突检查后调用；
- 输入包含只读候选 Frame、当前模型绑定、当前模型可见消息、Session/Turn/Input 和 AbortSignal；
- 输出重新经过 instruction/tool 去重、排序、Schema 冻结和不可变 Map 归一化；
- Composer 不是数组，不能串联，也没有 `next()`，因此不会形成通用 Middleware。

没有配置 Composer 的所有既有 Profile 行为保持不变。

### 3. Coding Agent Prompt Composer

Coding Agent Adapter 新增 `CodingAgentModelCallFrameComposer`：

- 从当前候选 Frame 读取实际活动工具名；
- 通过可注入 Resolver 读取 Session 当次 Prompt Options；
- 直接复用既有 `buildSystemPrompt()` 和结构化 Prompt Draft/Plugin 静态 operation 行为；
- 将最终完整 Prompt 作为一个 Kernel InstructionBlock 交付；
- 不把 Persona、Skill、Mode、MCP 或 Plugin 类型下沉到 Runtime Core。

Resolver 每次模型调用执行，因此个性化、资源和其他调用级变化不需要重建 Runtime Snapshot。

### 4. CLI 显式组合

Greenfield CLI Composition Root 新增：

- Session 工厂形式的 system prompt options resolver；
- 无状态 resolver 兼容入口；
- Session cwd 默认补全；
- 只有显式注入 resolver 时才启用 Composer。

因此本轮没有静默改变现有 Greenfield 并行入口的 Prompt，也没有切换 Legacy 默认入口。

### 5. MCP 结构化 Prompt 状态

Session 独占的 `McpDeferredToolController` 新增只读 Prompt State：

- 当前应进入 Prompt 的 MCP 工具描述符；
- 当前 eager/deferred 状态。

Composer 启用时，CLI 把该状态作为 `BuildSystemPromptOptions.mcpTools/mcpDeferred` 输入既有 Prompt
编译器。MCP 新增、删除、恢复和渐进披露继续在下一次模型调用生效，不拼接第二份独立系统提示词，
也不重建完整 Snapshot。

## 三元输入门禁

新增测试从真实 `streamFn` 边界捕获：

```text
systemPrompt
messages
tools: name + description + JSON inputSchema
```

覆盖：

- 当前工具集合进入旧结构化 Prompt 编译器；
- Context、Mode、Personalization 和 Plugin 静态 Prompt operation 的精确 Legacy 渲染结果；
- Resolver 获得当前消息角色、模型 ID 和活动工具；
- Personalization 在下一次模型调用更新；
- Tool Loop 第二次模型调用看到 assistant/toolResult 后的当前消息；
- MCP deferred 索引进入完整 Coding Agent Prompt；
- MCP 删除后下一次调用同时移除 Prompt 索引和模型工具；
- Session 工厂只创建一次 Session 独占 Resolver。

Schema 差分比较可序列化 JSON。TypeBox 的 `Kind`/`Optional` Symbol 是内存实现元数据，不会进入模型
请求；把 `Object` 与 Agent Core `Type.Unsafe` 的 Symbol 差异纳入产品差分会产生假失败。

## TypeBox / Zod

本轮没有新增不可信 JSON、网络或持久化输入，因此没有引入 Zod，也没有给进程内 Composer 重复增加
TypeBox 校验。

Composer 输出仍由 Runtime Core 做结构冲突、不可变复制和 Schema 冻结。后续接入 Plugin RPC effect
时，如果 effect 尚未在协议入口校验，应在 Adapter 边界继续使用项目现有 TypeBox Schema。

## 验证

通过：

- Runtime Core 目标测试：3 个文件，16 项；
- Coding Agent Greenfield Adapter：5 项；
- CLI Greenfield Composition：10 项；
- `runtime-core` 全包：25 个文件，118 项；
- `runtime-tools` 全包：18 个文件，190 项；
- `cli-app` 全包：2 个文件，19 项；
- 根源码 `tsgo --noEmit`；
- `runtime-core` 发布声明输出后，`coding-agent` 与 `cli-app` 包级发布配置无输出类型检查。
- 按 `runtime-core -> coding-agent -> runtime-mcp -> cli-app` 的真实发布顺序执行声明输出/发布配置检查；
- 根 `bun run check`：Biome、根/desktop/admin 类型检查和全部 guards 通过。

`coding-agent` 全包在当前 Windows/本机资源环境运行结果为 51 个文件通过、14 个文件失败，
790 项通过、80 项失败、45 项跳过。失败集中在本轮之前已有的：

- Windows 路径与 Shell 文案/换行假设；
- 内置模型 fixture 缺失；
- Resource/Package 自动发现环境；
- AgentSession 旧 mock 缺导出；
- Photon 图片 fixture；
- 旧 CLI 名称断言。

本轮新增测试全部通过，失败堆栈不包含本轮新增实现。不能据此声称 Coding Agent 全包通过。

## 明确未修改

- 未切换 CLI、Desktop、RPC 或 SDK 默认入口。
- 未改变任何工具名称、描述、Schema、结果、scope、requires 或副作用。
- 未把局部 Prompt/MCP 变化实现成 Runtime Snapshot 全量重建。
- 未把 Coding Agent Prompt/Plugin 业务类型放入 Runtime Core。
- 未实现动态 Plugin System Prompt Provider、Plugin tool enable/disable 或 continuation effect。
- 未创建空工具或缩减工具集合来伪造完整等价。

## 下一步

下一阶段应继续完成同一个“完整模型调用输入等价”方向中尚缺的生产来源与动态 Plugin 部分：

1. 为每个 Greenfield Session 用现有 ResourceLoader、Settings、Mode、Memory 和 Plugin Runtime
   组装真实 `CodingAgentSystemPromptOptionsResolver`。
2. 把旧动态 Plugin System Prompt Provider 提取成 Coding Agent 边界内的调用级编译器，保留
   provider 顺序、timeout、失败隔离、block operations、tool enable/disable 和 continuation 语义。
3. 为 CLI 默认场景补齐尚未进入 Greenfield Profile 的 Session 工具，未迁移实现只能通过明确的临时
   Compatibility Adapter 接入，不能删除或简化。
4. 建立完整 Legacy/Greenfield fixture，逐字段比较 systemPrompt、messages、tool name/description/
   JSON Schema/order。

这些差分为零前，不增加默认入口 opt-in，更不切换 Desktop/RPC/SDK。
