# 第 258 阶段：Session Host 所有权收口与测试基线恢复

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

第 257 阶段已经把 Composition Root 的所有权收回 `coding-agent`，但两个宿主无关的 Session Host 仍放在 CLI：一个拥有 Runtime、活动 Session、Extension、MCP、Turn 和清理顺序，另一个拥有 Extension 的 Session 级动态绑定。这使 CLI 同时承担产品能力编排和协议适配，不符合最终边界。

本阶段将这两个对象归入 `packages/coding-agent/src/composition/session-host`。CLI 继续保留 RPC、IM、Print 的协议适配、启动参数、输出帧和迁移决策，只负责选择并连接 Coding Agent 提供的产品组合。迁移复用原有行为实现，没有重写功能。

## 实施内容

- 新增 `CodingAgentProcessSessionHost`，集中拥有 Runtime、活动 Session、Extension Session、MCP、Turn retry、订阅和分阶段清理。
- 新增 `CodingAgentExtensionSessionHost`，保留 Extension initialize、reload、session transition、rollback、command binding 和 dispose 语义。
- 删除 CLI 下原有两个中立 Session Host 文件，以及无消费者的 `GreenfieldImExtensionSessionHost` 转发文件。
- CLI IM Runtime Host 改为从 `@vetta/coding-agent/composition` 组合两个新宿主；RPC、IM 和 Print Adapter 仍留在 CLI。
- 删除废弃的 `GreenfieldCliSessionOptions` 类型别名；CLI 与 Desktop 直接使用宿主无关的 `GreenfieldRuntimeSessionOptions`。
- 将 Extension Session Host 回滚测试迁入 `coding-agent` 包，并改为验证新所有者和新名称。
- 修复 Coding Agent 既有测试基线：模型凭据命令改用跨平台 Node fixture，初始化 Profile 补齐当前字段，Subagent Child Factory 断言补齐 `AbortSignal`。
- 未引入 TypeBox 或 Zod：本阶段没有新增不可信 JSON、配置解析或外部协议输入，变化只涉及静态类型和模块所有权。

## 旧实现依赖变化

- 旧 CLI Session Host 文件：`3 -> 0`。
- `GreenfieldAgentSessionHost`、`GreenfieldExtensionSessionHost`、`GreenfieldImExtensionSessionHost` 和 `GreenfieldCliSessionOptions` 生产与治理范围引用：`0`。
- Coding Agent Session Host 到 CLI、RPC、IM、Print 协议实现的引用：`0`。
- Coding Agent 旧实现文件、旧实现依赖、Runtime 反向依赖、compat 导出和旧执行入口继续保持 `0`。

重写进度守卫升级到 version 8，并新增三个不可通过 baseline 合法化的零目标：旧 CLI Session Host 文件不得恢复、旧宿主符号不得恢复、Coding Agent Session Host 不得依赖 CLI 协议。

## 行为兼容性验证

- Coding Agent 定向测试：4 个文件、47 个测试通过。
- Session Host 治理测试：1 个文件、16 个测试通过。
- CLI IM Runtime Host 与 RPC Adapter 定向测试：2 个文件、32 个测试通过。
- `packages/coding-agent` 全包测试：127 个文件通过、1 个文件跳过；881 个测试通过、17 个跳过。
- `packages/cli-app` 全包测试：35 个文件、194 个测试全部通过。
- 两个包并行测试时曾有 1 个 5 秒集成测试因资源争用超时；该文件单跑 2/2 通过，随后 CLI 全包顺序重跑 194/194 通过，因此没有修改产品代码或放宽测试超时。
- `bun run check:quick` 通过。
- 根 `bun run check` 通过，覆盖 Biome、monorepo tsgo、CLI、Desktop、Admin 类型检查和全部质量守卫。

## 尚未完成的替换

- `packages/cli-app/src/rpc/greenfield-im-runtime-host.ts` 仍同时承担 Bootstrap 输入映射、Composition 创建、Extension Host 工厂、命令动作装配与协议能力连接；这些都属于 CLI，但文件内职责仍需按边界拆分。
- `@vetta/coding-agent/composition` 仍暴露较宽的产品组合表面；后续应按真实消费者区分稳定 Session 合同、宿主装配入口和内部实现，但不能恢复 CLI 转发层或旧别名。
- 下一阶段应先拆分 CLI Runtime Host 的启动装配与 RPC capability 连接，保持 `CodingAgentProcessSessionHost` 为唯一进程级能力所有者，并用现有 194 个 CLI 行为测试验证没有功能变化。
