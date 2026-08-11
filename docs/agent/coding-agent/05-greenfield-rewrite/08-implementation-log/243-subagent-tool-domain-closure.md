# 第 243 阶段：Subagent Tool 领域闭环

## 阶段目标

在不改变 `spawn_agent`、`dispatch_workflows`、`wait_agent`、`list_agents`、`interrupt_agent`、`send_message` 和 `followup_task` 可观察行为的前提下，删除旧 `core/subagents`，由 `runtime-subagents` 持有通用调度与生命周期，由 `runtime-tools` 持有 Tool 协议与执行定义，`coding-agent` 只保留产品 Profile 和组合顺序。

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

## 本阶段与最终目标的关系

第 242 阶段已经把 Explorer/Workflow 产品 Profile 移入组合层，但 Greenfield 仍通过 Adapter 调用旧 `core/subagents` Tool 工厂，旧目录还重复持有协调器、类型注册、持久化和通知实现。本阶段删除这条最后的生产依赖，并把 Tool、通用 Runtime 与产品组合三个边界分开。

## 实施内容

### 1. Runtime Tools 原生实现

- 在 `runtime-tools/src/coding/tools` 下按工具建立七个独立目录，每个工具分别维护 TypeBox 输入 Schema、TypeScript 描述、执行定义、Registration 和出口。
- Tool 只依赖 `SubagentCoordinatorPort`，不依赖 Coding Agent 的具体 Session、Profile 或旧工具工厂。
- 保留工具名称、输入字段、描述、scope、category、批量上限、工作流等待限制、输出文本和错误传播语义。
- `runtime-tools` 显式依赖 `runtime-subagents`，依赖方向保持为产品组合层到独立 Runtime 能力层，不形成到 `coding-agent` 的反向依赖。

### 2. Coding Agent 组合边界

- 新增 `greenfield-subagent-tool-registrations.ts`，只负责注入当前会话协调器、Workflow 类型名和稳定模型暴露顺序。
- Greenfield Subagent Runtime 继续持有 Explorer/Workflow 产品 Profile，七个 Tool 的协议和实现不再位于 Coding Agent。
- 删除只转发旧工厂的 `greenfield-subagent-tool-adapter.ts`。

### 3. Runtime Subagents 生命周期闭环

- 父会话关闭时向正在创建或恢复的子会话请求传播 `AbortSignal`，并等待所有在途创建操作结束。
- 异步工厂在关闭后返回的迟到句柄由协调器立即释放；重复 `dispose()` 返回同一关闭事务。
- 补齐 start/stop 生命周期、阻断启动、Todo/标题投影、排队中断、清理终态和任务名复用等旧行为场景。

### 4. 删除旧实现和结构测试

- 删除 `packages/coding-agent/src/core/subagents` 下 16 个旧实现文件。
- 删除三个直接耦合旧协调器结构的测试文件；其有效行为场景迁入 `runtime-subagents`、`runtime-tools` 和 Greenfield Session Assembly 测试。
- 精确重写基线删除 Subagent 旧依赖边和旧文件清单；现有守卫会拒绝这些路径或依赖重新出现。

## 行为兼容性验证

- `runtime-tools` 定向测试：5 个通过，覆盖七个 Tool 的注册元数据、输入转发、输出格式、批量限制和工作流等待约束。
- `runtime-subagents` 定向测试：18 个通过，覆盖创建、恢复、消息、跟进、并发、持久化、通知、生命周期和关闭竞态。
- `coding-agent` Greenfield Session Assembly 定向测试：6 个通过，覆盖工具顺序、Profile、子会话创建及每次创建边界读取实时父会话 MCP 视图。
- `bun run check:quick` 通过。
- `bun run check` 通过；Biome、monorepo `tsgo`、CLI、desktop-app、admin 和全部质量守卫均无错误。

## 旧实现依赖变化

| 指标 | 第 242 阶段 | 本阶段 | 最终目标 |
| --- | ---: | ---: | ---: |
| 生产代码到旧实现的精确依赖边 | 46 | 45 | 0 |
| Subagent 旧依赖边 | 1 | 0 | 0 |
| Runtime 包到 `coding-agent` 的反向依赖 | 0 | 0 | 0 |
| 明确登记的旧实现文件 | 98 | 82 | 0 |
| `core/subagents` 旧实现文件 | 16 | 0 | 0 |
| Greenfield 产品 Core 依赖边 | 14 | 13 | 0 |
| 兼容包导出 | 0 | 0 | 0 |

## 尚未完成的替换

- 仍有 45 条旧产品 Core 依赖和 82 个旧实现文件；当前较大的剩余领域是 Model Registry、Bash Executor、MCP、Auth Storage、Export HTML 和 Memory。
- 旧 Core Tool 目录仍保留工具协议或兼容实现；后续必须按“行为特征先覆盖、Runtime Tool 已独立、生产调用迁移、旧目录删除”的顺序逐域退出，不能把具体工具重新塞回 Coding Agent。
- Subagent 领域本阶段已经闭环，后续只接受独立 Runtime 合同和产品组合层上的功能演进，不再恢复旧 `core/subagents`。
