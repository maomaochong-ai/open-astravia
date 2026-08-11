# 第 226 阶段：退役 Runtime 兼容根与循环构建

## 阶段目标

解除 `runtime-storage`、`runtime-tools` 对旧 `coding-agent` 的全部生产反向依赖，删除仅为反向兼容存在的公共子路径，并把两个 Runtime 包恢复为普通单阶段构建。旧实现仅保留为差分测试 Oracle，本阶段不修改 Tool、Conversation、CLI、SDK、RPC 或 IM 的用户可观察功能。

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

第 225 阶段确认的三条 Runtime 反向依赖全部来自包根兼容转发，而独立实现已经分别由 `runtime-storage/conversation` 和 `runtime-tools/coding` 持有。退役这些转发会删除真实循环，而不是移动或包装旧实现；同时删除 `coding-agent` 的两个 `compat/*` 导出，使公共边界向固定目标收缩。

## 实施内容

- `runtime-storage` 包根改为转发原生 Conversation API；不再暴露认证、设置和旧 `SessionManager`。
- `runtime-tools` 包根改为转发原生 Coding Tool API；不再暴露旧工具单例集合。
- 删除 `coding-agent` 两个 Runtime compat 模块及 package export。
- 两个 Runtime 包移除生产 peer dependency，仅保留用于差分测试的开发依赖。
- 删除拆分编译配置，将根构建脚本和 Desktop 前置构建收敛为普通依赖顺序下的单阶段 `build`。
- 新增包根合同测试，验证根入口与原生子路径一致且旧兼容对象不可见。

## 旧实现依赖变化

| 指标 | 第 225 阶段 | 本阶段 | 最终目标 |
| --- | ---: | ---: | ---: |
| 生产代码到旧实现的精确依赖边 | 216 | 213 | 0 |
| Runtime 包到 `coding-agent` 的反向依赖 | 3 | 0 | 0 |
| 明确登记的旧实现文件 | 184 | 182 | 0 |
| `compat/*` 包导出 | 2 | 0 | 0 |

旧会话格式边界和测试 Oracle 不计入生产反向依赖；它们继续用于证明新实现没有改变已有数据与工具行为。

## 行为兼容性验证

验证结果：

- `runtime-storage` 与 `runtime-tools` 包根合同测试各 2 项通过；根入口等同原生子路径，旧兼容对象不可见。
- Coding Agent 公共子路径测试 2 项通过；package export 中不存在 `compat/*`。
- 两个 Runtime 包的 `tsgo --noEmit -p tsconfig.build.json` 均通过，证明单一构建配置具有完整类型闭包。
- `quality-gates.test.mjs` 与 `coding-agent-rewrite-governance.test.mjs` 共 58 项通过。
- `bun run check:quick` 通过；构建顺序、包边界、旧执行归零和重写进度门禁均通过。
- `bun run check` 通过；Biome、monorepo/CLI/Desktop/Admin 类型检查与全部 guards 均为零错误。

## 尚未完成的替换

- 生产代码到旧实现的其余依赖仍需按能力域继续替换。
- 旧 `src/core` 及其余显式旧实现文件尚未归零。
- 旧 SDK 示例和旧格式边界到旧实现的依赖仍需后续阶段处理。
