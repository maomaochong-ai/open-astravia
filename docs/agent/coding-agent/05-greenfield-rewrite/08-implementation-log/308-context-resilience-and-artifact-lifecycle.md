# 第 308 轮：上下文韧性与产物生命周期

<!-- coding-agent-rewrite-charter:v1:start -->
## 重写目标确认（固定）

- 删除旧 `coding-agent` 内部代码、目录、内部类和仅为旧架构服务的兼容层。
- `coding-agent` 最终只承担稳定 Session 合同、产品组合根和能力编排职责。
- 新生产代码对旧 `coding-agent` 实现的依赖必须收敛到零，不能通过改名、移动目录或包装 Adapter 延续旧架构。
- Agent 内核保持最小闭环；Tool、MCP、Skill、知识库、Memory、Compaction 和 Subagent 通过独立合同围绕内核组合。

## 必须保留（固定）

- 用户可观察的 Agent 功能，以及 CLI、SDK、RPC、IM 必须继续提供的产品能力和协议。
- 会话历史、认证、模型和设置等用户数据；必要时由显式、独立的新迁移器读取旧格式。
- 模型消息、工具消息、错误、取消、事件顺序、并发约束和资源释放语义。
- 仍然有效的行为测试场景和数据 fixture；旧实现可以临时作为测试 Oracle，但不能被新生产代码调用。
- `@vetta/ai` 与经过合同验证的 `@vetta/agent-core` 等独立下层能力，除非单独审计证明其合同不满足目标。

## 明确舍弃（固定）

- 旧 `src/core` 目录结构与实现，以及旧 `AgentSession`、`SessionManager`、Manager、Registry、工具工厂和资源加载器。
- 包根聚合暴露的内部对象、深层 `core` 导入和 `compat/*` 兼容入口。
- Runtime 包对 `coding-agent` 具体实现的反向依赖，以及只为旧内部调用方式存在的 Adapter。
- 对旧内部类、目录和属性有耦合的测试；保留其行为场景，不保留其结构性假设。
- 仅展示旧 API、没有独立产品需求的示例；示例不能反向决定新架构。
- 通过修改旧功能完成“迁移”，或在架构重写阶段顺带改变用户可见功能。
<!-- coding-agent-rewrite-charter:v1:end -->

## 本阶段目标

在不改变 Tool、MCP、图片、压缩、Todo 和后台任务产品能力的前提下，为新架构补齐九项上下文韧性与资源治理能力。思路参考了 Grok 的上下文治理分层，但代码按 Vetta 当前 Runtime 合同重新实现，没有复制 Grok 代码，也没有新增 Grok 运行时依赖。

## 阶段一：普通 Tool 结果与产物生命周期

### 分析与方案

- `runtime-tools` 只定义中立的 `CodingToolResultPolicy`，并在 Catalog 的执行跟踪边界无条件投影最终结果；具体容量政策仍由 Coding Agent 产品组合提供。
- 普通 Coding Tool 的默认内联上限为 50 KiB。超过上限时保留 UTF-8 安全的头尾预览、图片和 `details`，完整结果原子写入 `<agentDir>/tool-results/<session>/`。
- `external` Tool 不重复处理，MCP 继续使用其独立结果策略和 `<agentDir>/mcp-results/<session>/`。
- 文件写入失败时返回完整原结果，容量优化不能把成功 Tool 变成失败 Tool。
- Session 删除事务在会话文件仍可重试时先清理两类产物；清理失败时不删除会话，调用方可以重试。

### 实施结果

- 新增普通 Tool 结果策略合同、文件产物 Store 和组合层默认政策。
- CLI、SDK、Desktop 的 Session Catalog 接入统一产物 Cleaner。
- `runtime-storage` 通过可选 `ConversationSessionArtifactCleaner` Port 编排清理，不反向依赖 Coding Agent。

## 阶段二：上下文压力与最近三轮保护

### 分析与方案

- 裁剪只作用于模型调用投影，不修改 Conversation Document 或持久化消息。
- 使用率低于 50% 时不裁剪 ToolResult；50% 至 75% 时只截断保护边界之前且大于 8 KiB 的 Tool/Bash 结果；达到 75% 时清空这些旧结果正文。
- 最近 3 个真实 `user` 轮次及其后续消息始终保护。Custom、Compaction Summary 等模型可见消息不冒充真实用户轮次。
- 旧的计数/时间型 microcompact 不再提前清理 ToolResult，避免与压力策略形成两个事实源；thinking 清理行为保持不变。

### 实施结果

- 新增纯函数压力投影和真实用户轮次边界模块。
- Context Runtime 在每次模型调用前用当前 token 估算执行压力投影，持久化历史保持不变。

## 阶段三：图片、压缩和错误恢复

### 分析与方案

- 图片先执行最近图片数量预算，再执行请求体字节高低水位。默认高水位 16 MiB、低水位 12 MiB；超过高水位时从最旧的已看图片开始移除，直到低水位。
- 尚未被 assistant 看过的图片不因字节水位被移除，保持“第一次读取必须真实到达模型”的既有合同。
- Compaction 输入按 `full -> compact-tool-results -> essential -> recent-three-turns` 降级。输入过大才进入下一层，瞬时错误在同层重试。
- 瞬时错误默认重试 2 次，退避 250/500 ms；配额耗尽、认证等永久错误不重试；Abort 立即终止。
- 摘要过短、只有道歉/错误/分析草稿或与大输入明显不成比例时视为退化。退化摘要同层重试 1 次，仍不合格则失败，不提交坏摘要。

### 实施结果

- 图片预算支持向后兼容的数字参数和高低水位对象参数。
- Turn Retry 与 Compaction 共用错误分类事实源。
- 自动压缩和 split-turn 前缀摘要共用同一多级输入、重试和质量门禁。

## 阶段四：压缩后工作状态恢复

### 分析与方案

- Todo Runtime 仍是待办事实源，后台任务 Service 仍是任务事实源；压缩流程不重建或接管这些内部 Store。
- 压缩提交前读取当前状态，将结构化 `<runtime-work-state>` JSON 块附加到摘要，使后续模型明确看到继续执行所需状态。
- 计划状态从 Todo 派生，不创建第二套 Plan Store。记录完成数、总数和下一 Todo；后台任务保留全部运行项与最近 10 个终态项，只保存命令、状态、输出文件和退出码，不内联大段输出。
- 再次压缩会替换旧状态块；没有工作状态时移除旧块，避免摘要持续累积过期状态。

### 实施结果

- Context Runtime 的持久化 `record.summary` 与模型可见 `summaryMessage` 使用同一份恢复状态。
- 自动压缩、手动压缩和 Extension 覆盖结果都经过同一最终记录边界。

## 明确未修改

- 未改变任何 Tool 名称、Schema、描述、激活规则、MCP 动态注册或 Tool 执行业务语义。
- 未将 Tool 实现迁回 Coding Agent；`runtime-tools` 继续持有 Tool 域实现，Coding Agent 只提供产品策略和组合。
- 未把 Tool、Prompt、Skill、MCP 等运行时变化固化为整 Runtime 快照。
- 未引入新的 Plan Store，未从摘要反向覆盖 Todo 或后台任务内部状态。
- 未修改旧架构实现来获得新行为，也未新增 Legacy 执行依赖。

## 验证

- 九项能力的纯函数、Store、策略和 Context Runtime 定向测试共 38 项通过。
- `runtime-tools`、`runtime-storage`、Coding Agent、CLI/IM 和 Desktop 组合边界的独立定向测试共 67 项通过。
- 合计 105 项不重复定向测试通过。
- Coding Agent 完整套件 147 个文件、967 项通过（17 项按既有条件跳过）。
- Runtime Tools 完整套件 26 个文件、230 项通过；同时修正一条已落后于既有 `tool_search` 明确文案的兼容断言，未修改 Tool 行为。
- Runtime Storage 完整套件 19 个文件、95 项通过。
- `bun run check:quick` 通过。
- 根 `bun run check` 通过，覆盖 Lint、Root/CLI/Desktop/Admin/Docs 类型检查和全部质量守卫。
- 曾用根 Vitest 直接运行 CLI 测试时误加载旧 `dist`，出现新增导出不存在；按 `packages/cli-app/vitest.config.ts` 的源码别名重跑后 26 项全部通过。该问题属于测试入口错误，未以修改生产架构规避。

## 后续方向

本阶段九项能力已经闭环。下一阶段应优先做真实 CLI 会话的长上下文 canary：构造大 ToolResult、多图、瞬时失败和压缩场景，验证 Provider 实际请求体、产物引用、压缩摘要与 Session 删除后的磁盘状态；不再继续增加新的上下文策略。
