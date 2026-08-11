# 第 250 阶段：旧 Tool 领域完整退役

## 阶段目标

在不改变工具名称、输入 schema、scope、requires、模型顺序、返回内容、错误、取消、后台任务和路径策略的前提下，删除 `coding-agent` 中已被 `runtime-tools` 完整替代的旧 Tool 实现、后台任务管理器、兼容类型和描述生成链，并让测试只验证新的 Runtime 合同。

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

- Tool 的实现、TypeBox 输入合同、描述、注册元数据和执行服务继续由独立的 `@vetta/runtime-tools/coding` 拥有；`coding-agent` 只保留宿主端口和产品组合。
- 删除的是无生产调用方的旧实现与结构性测试 Oracle，不是工具功能。CLI、SDK、RPC、IM 使用的 Runtime Tool 表面不变。
- Tool 输入本来就是结构化外部边界，继续使用 TypeBox；本阶段没有为内部已类型化对象额外引入 Zod。

## 本阶段实施内容

### 1. 测试脱离旧实现 Oracle

- Current Time、Find、Glob、Grep、Ls、Read、Tree、Write、Edit、Command 和 capability tools 改为验证明确的 Runtime 名称、描述、TypeBox schema、scope、requires、结果和错误合同。
- 锚点算法与 Edit 锚点行为测试移入 `runtime-tools/test/coding`；`blockImages`、Tool Search 和产品工具组合测试直接执行 Runtime Tool。
- 删除只验证旧工厂、旧路径工具、旧描述加载器和旧子进程包装器的重复测试。

### 2. 补齐后台观察者隔离

- 审计发现旧 `BackgroundTaskManager` 会隔离单个观察者异常，而新生命周期服务原先会中断后续观察者。
- `createBackgroundCommandService` 现在分别隔离事件观察者和完成通知观察者；一个监听器抛错只记录 warning，不影响任务终态或其他监听器。
- 新增独立生命周期测试覆盖事件与通知两条分发路径。

### 3. 删除旧 Tool 实现与生成链

- 删除 `src/core/tools` 下 36 个 TypeScript 文件和 25 个 `description.txt`。
- 删除旧 `core/background-tasks`、`core/session/tool-scope.ts`、`core/todo-store.ts` 及其包根/`core` 聚合导出。
- 删除 `generate-tool-descriptions.mjs`、`generate:descriptions` 和构建前置步骤；Runtime Tool 描述继续使用各工具目录内的 TypeScript 模块。

### 4. 建立 Tool 域零回流守卫

- 重写基线升级到 version 5，新增 `retired Tool references` 硬指标。
- 生产源码、测试、`coding-agent` 脚本和 package 配置中重新出现旧 Tool、旧后台管理器、旧类型垫片或旧描述生成链时，即使尝试写入基线也会失败。
- 治理单测固定“旧 Tool 引用不能通过基线合法化”，当前指标为 `0/0`。

## 旧实现依赖变化

| 指标 | 第 249 阶段 | 本阶段 | 最终目标 |
| --- | ---: | ---: | ---: |
| 生产代码到旧实现的精确依赖边 | 11 | 10 | 0 |
| Runtime 包到 `coding-agent` 的反向依赖 | 0 | 0 | 0 |
| 明确登记的旧实现文件 | 50 | 11 | 0 |
| 旧 Tool/配套 TypeScript 文件 | 39 | 0 | 0 |
| 旧 Tool 描述文本与生成脚本 | 26 | 0 | 0 |
| 退役 Tool 路径/生成链引用 | 未独立统计 | 0 | 0 |
| `compat/*` 包导出 | 0 | 0 | 0 |
| 深层 `core/*` 包导出 | 0 | 0 | 0 |

## 行为兼容性验证

- `runtime-tools` 定向测试 16 个文件、184 项通过，覆盖工具元数据、输入、输出、路径、编辑、真实前后台命令、任务输出/停止和观察者隔离。
- `coding-agent` 定向测试 4 个文件、20 项通过，覆盖图片读取、Tool Search、产品工具组合和 Legacy Tool Adapter 的通用兼容合同。
- 重写治理测试 13 项通过，包含退役 Tool 引用不能被基线接受的回归测试。
- `bun run check:quick` 通过；`bun run check` 的全仓 Biome、根/CLI/Desktop/Admin 类型检查和全部质量守卫通过。

## 尚未完成的替换

- Tool 域已经完成退役，但全面重写尚未完成：仍有 10 条非 Tool 旧产品 Core 依赖和 11 个旧实现文件。
- 剩余依赖分布为 Hooks、Slash Commands、Timings 各 2 条，以及 Concurrency、Event Bus、Footer Data Provider、Image Budget 各 1 条。
- 下一阶段应按横切运行时基础设施整体处理这些依赖，先冻结对外行为，再建立独立合同并删除旧 Core；不要重新把它们并入 Agent 内核或 Tool 包。
