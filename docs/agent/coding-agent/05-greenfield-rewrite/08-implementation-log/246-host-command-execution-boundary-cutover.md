# 第 246 阶段：宿主命令执行边界完整切换

## 阶段目标

在不改变用户 Bash、SDK、RPC、流式输出、取消、远程 Operations、输出清洗与截断行为的前提下，将命令执行从旧 `src/core` 迁移到独立宿主 Port，由 SDK 和 RPC Composition Root 注入具体实现；同时删除最后一个深层 `core/*` 包导出。

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

第 245 阶段后，`bash-executor` 仍形成 5 条生产代码到旧 Core 的依赖，横跨 SDK Host、RPC Capability、RPC Client 和线协议类型；`./core/host/executable-resolver.js` 则是唯一剩余的深层 Core 导出。后者只是 `runtime-tools` 适配器的转发壳，不承担独立能力。本阶段将两者按“宿主命令执行边界”一次收口，不把用户 Bash 混入模型 Tool 域，也不同时处理 Auth、Memory 或 HTML Export。

## 实施内容

### 1. 建立独立宿主 Bash Port

- 新增 `host/command-execution`，将合同、输出收集、本地 Shell 执行、远程 Operations 执行和默认工厂按职责拆分。
- `HostBashExecutor` 是 SDK 与 RPC 共同依赖的窄合同，具体进程实现只在 Composition Root 创建。
- 输出收集继续复用 `runtime-tools` 的截断合同，同时保留 ANSI 清理、二进制清洗、换行归一化、滚动缓冲和完整输出临时文件语义。
- 该边界处理的是用户直接发起的 Bash，不迁入 `runtime-tools` 的模型工具目录。

### 2. 切换 SDK 与 RPC 组合

- `CodingAgentSdkBashAdapter` 改为注入 `HostBashExecutor`；本地执行和自定义 Operations 均不再导入旧 Core。
- SDK Host Composition Root 创建默认执行器，原有活动命令互斥、Session 隔离、待投递消息、quiesce 和 dispose 行为不变。
- `GreenfieldRpcBashCapability` 改为注入同一 Port，CLI Runtime Composition Root 显式完成装配。
- RPC 新增独立 `RpcBashResult` 线协议合同，RPC Client 与 Session Capability 不再引用实现层结果类型；字段和 JSON 形状保持不变。

### 3. 删除旧实现与深层导出

- 删除 `core/bash-executor.ts`、无生产消费者的 `core/exec.ts` 和仅转发新适配器的 `core/host/executable-resolver.ts`。
- 删除 `core/index.ts` 中 Bash 实现导出。
- 删除 `package.json` 中最后一个 `./core/*` 深层导出；有效工具可执行文件解析继续由 `runtime-tools` 合同和 `adapters/runtime-tools` 组合持有。
- 重写精确基线移除 5 条 Bash 旧依赖、3 个旧文件和 1 个 Legacy Core Export，重新引入将由现有治理门禁拒绝。

## 行为兼容性验证

- 宿主 Bash、SDK Bash 和 RPC Bash 共 3 个定向测试文件、9 个测试通过。
- 覆盖本地 stdout/stderr 合并、ANSI 与换行清洗、流式回调、非零退出状态、预取消结果、自定义 Operations、活动命令取消与等待、Session Context 投递、RPC 前缀和结果映射。
- `bun run check:quick` 通过，包含 Biome、包边界、旧执行入口、重写进度、实施记录和独立 CLI 产物守卫。
- 根 `bun run check` 通过：Biome、monorepo `tsgo`、CLI 独立 typecheck、Desktop `tsc`、Admin `tsc -b` 和全部质量守卫均通过。

## 旧实现依赖变化

| 指标 | 第 245 阶段 | 本阶段 | 最终目标 |
| --- | ---: | ---: | ---: |
| 生产代码到旧实现的精确依赖边 | 28 | 23 | 0 |
| Bash Executor 旧依赖边 | 5 | 0 | 0 |
| Runtime 包到 `coding-agent` 的反向依赖 | 0 | 0 | 0 |
| 明确登记的旧实现文件 | 64 | 61 | 0 |
| 本阶段目标旧文件 | 3 | 0 | 0 |
| `compat/*` 包导出 | 0 | 0 | 0 |
| 深层 `core/*` 包导出 | 1 | 0 | 0 |

## 尚未完成的替换

- 仍有 23 条旧产品 Core 依赖和 61 个旧实现文件；依赖最集中的领域是 Auth Storage、Export HTML 和 Memory，各 4 条。
- Hooks、Slash Commands 和 Timings 各有 2 条旧依赖；Background Tasks、Concurrency、Event Bus、Footer Data Provider 与 Image Budget 各有 1 条。
- 下一阶段应独立处理带用户凭据兼容要求的 Auth Storage，不应与静态资源打包或 Memory 数据迁移混合实施。
