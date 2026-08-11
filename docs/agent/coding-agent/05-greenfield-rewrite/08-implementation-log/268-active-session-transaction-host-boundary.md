# 第 268 阶段：活动 Session 事务宿主边界拆分

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

旧执行架构已经归零后，本阶段开始治理新架构自身的复杂度。原根级活动 Session Host 达到 511 行，同时持有事务编排、事件转发、并发门禁、回滚和资源清理。此次拆分不改变会话功能，而是让 `coding-agent` 的产品组合职责形成可独立理解和验证的内部边界，避免新 Composition Root 再次演化为大类。

## 实施前判断

- `greenfield-runtime-host-session-backend.ts` 对参数不一致的显式失败是 Composition 固定参数的 fail-closed 约束，不是缺失功能，本阶段不修改。
- `"greenfield"` 和 `"greenfield-im"` 是 CLI/RPC 兼容协议值，不能因内部命名整理而改变。
- `GreenfieldRuntimeSession` 来自 `runtime-core` 的当前合同，Coding Agent 不应在本阶段跨包重命名。
- 活动 Session Host 的 16 个既有测试覆盖切换原子性、观察流、回滚、清理重试、setup、fork、取消、中断和并发，可作为结构重构的行为基线。

## 分阶段实施

### 阶段一：固定行为基线

- 在改动前运行活动 Session Host 与 Extension Command Action Adapter 测试，共 17 个测试通过。
- 盘点所有旧根级 Host 路径和 `CodingAgentGreenfield*SessionTransition*` 引用，确认外部公共消费者已经使用中性 Composition 名称，剩余直接依赖集中在 Coding Agent 包内。

### 阶段二：按职责拆分

- 新增 `active-session-transition-contracts.ts`，集中定义活动 Session 事务、Seed、Lifecycle 和 Runtime Port 合同。
- 新增 `active-session-event-relay.ts`，单独负责稳定宿主订阅、Session 切换时的事件/Observation 重绑定、监听器错误隔离和终态事件抑制。
- 新增 `session-transition-cleanup.ts`，单独负责已提交事务的旧 Session、Extension Binding 和最终 Host 资源的分阶段可重试清理。
- 将事务编排迁入 `session-host/active-session-transition-host.ts`；主类只保留串行准入、new/switch/fork、prepare/commit/rollback 和目标会话管理。
- 删除原 `composition/greenfield-active-session-transition-host.ts`。主事务模块由 511 行降到 358 行；继续保留紧密相关的三类转换流程，避免为了行数制造 Strategy 层。

### 阶段三：局部命名中性化

- Coding Agent 自有的 ActiveSessionHost、Transition、Lifecycle、Seed 和 PreparedBinding 类型改为 `CodingAgent*` 中性名称。
- Composition 公共入口直接导出中性实现，不再通过 `Greenfield* as CodingAgent*` alias 掩盖内部迁移命名。
- SDK、Extension、Bash、Session Setup 和 Runtime Adapter 的包内引用全部迁移；旧根级路径与相关 Coding Agent 自有旧类型引用归零。
- 不机械修改 Runtime Core 类型、CLI/Desktop 文件名、日志文本或协议值，控制行为风险和无意义 diff。

### 阶段四：测试与防回退守卫

- 新增 Observation 监听器异常隔离测试，验证一个监听器抛错不会阻断其他监听器，且切换前后都成立。
- 新增 dispose 后停止转发事件和 Observation 的测试，验证订阅先释放、活动 Session 后释放的顺序。
- 将旧根级 Host 路径加入旧实现精确文件集合；未来恢复该文件会被重写治理守卫拒绝。
- 增加对应治理回归测试，确保退役路径不能被重新创建。

## TypeBox / Zod 判断

本阶段没有引入 TypeBox 或 Zod。Session Transition、事件监听器和清理任务都是进程内可信对象，没有新增 JSON、RPC、持久化或外部配置边界。运行时 Schema 会重复静态合同且不能提高事务正确性；现有外部边界继续使用各自已有的 TypeBox 校验。

## 旧实现依赖变化

- 旧 `composition/greenfield-active-session-transition-host.ts` 已删除并加入常驻退役守卫。
- Coding Agent 包内对该旧路径及其 `CodingAgentGreenfield*` 活动会话类型的引用为 `0`。
- 旧执行实现边、Runtime 反向依赖、旧文件和兼容导出继续为 `0`。
- Composition 公共导出保持 19 项，外部深层导入保持 `0`，包根 Composition 导出保持 1 项。
- 14 个历史格式边界保持不变，只承担旧会话数据兼容，不进入活动 Session 事务执行路径。

## 行为兼容性验证

- 拆分前 Coding Agent 定向基线：2 个文件、17 个测试通过。
- 拆分后 Coding Agent 定向测试：2 个文件、19 个测试通过，其中新增 2 个事件转发和释放测试。
- CLI Composition、RuntimeHost、Ecosystem Hook 和活动会话差分：4 个文件、24 个测试通过。
- Coding Agent 重写治理测试：21 个测试通过。
- `bun run check:quick` 通过，全部架构守卫保持零回退指标。
- `bun run check` 通过，覆盖 Biome、根/CLI/Desktop/Admin 类型检查和全部质量守卫。
- `bun run verify:agent-hosts` 完整通过，覆盖独立 CLI 产物、IM Gateway 真实子进程、Coding Agent、CLI 和 Desktop；Desktop 为 121 个文件、511 个测试通过，1 个平台不适用测试跳过。
- 本阶段没有改动 Provider、凭据或模型调用路径，因此没有重复发送计费的真实 DeepSeek 请求。

## 本阶段结果

- 活动 Session 身份事务仍由 Coding Agent 产品组合层拥有，但事件转发和可重试清理不再混在主类中。
- new/switch/fork、Extension 生命周期、事件顺序、取消、回滚、并发和资源释放行为保持不变。
- 公共 API 数量和名称不变，本阶段不是 Breaking Change。
- 旧根级大文件无法在不触发治理守卫的情况下被恢复。

## 尚未完成的替换

- 没有待替换的旧活动 Session 执行路径；本阶段处理的是新架构维护性，不是 Legacy 功能迁移。
- 主事务 Host 当前为 358 行，剩余内容是紧密关联的 new/switch/fork 编排。除非未来出现独立变化轴，不应仅为降低行数继续拆成策略类。
- Composition 中仍有来自 Runtime 合同、协议兼容和迁移历史的 `Greenfield` 内部命名。后续应逐个职责域审计，不能进行全仓机械改名。
- 下一处候选是 725 行的 Context Runtime Adapter，但必须先判断其中是否存在可独立验证的状态机、压缩控制和消息投影职责，再决定是否拆分。
