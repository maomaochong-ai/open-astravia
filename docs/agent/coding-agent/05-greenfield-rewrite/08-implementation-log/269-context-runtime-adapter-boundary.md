# 第 269 阶段：Context Runtime 适配边界拆分

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

旧执行依赖归零后，需要继续治理新架构内部的维护性。原 `greenfield-context-runtime.ts` 达到 725 行，同时承担自动/手动压缩编排、模型调用消息转换、Conversation Document 投影、Prefire 缓存和 usage 状态。本阶段按变化原因拆开这些职责，使 Coding Agent 继续作为产品能力编排层，而不是重新形成包含所有上下文细节的大型适配器。

本阶段是纯架构重构。压缩算法仍由 `src/compaction` 持有，Conversation 与 Turn 合同仍由 Runtime Core 持有，Memory、Extension 和 Hook 仍通过既有窄端口组合，没有把这些领域实现吸收到 Coding Agent Context Runtime。

## 实施前判断

- `prepare()` 中阈值、overflow、Hook、Extension、Memory 和提交时序属于一个压缩事务，应保留在主编排器中。
- Runtime Message Envelope 到模型消息的转换是每次 Model Call 的独立投影，可单独测试且不拥有持久化状态。
- Conversation Document 到压缩输入、压缩后预览和 Session Entry 的转换是格式投影，不应与事务状态混合。
- Prefire 的 AbortController、缓存和一次性消费具有独立生命周期，应由专门对象拥有。
- `src/compaction/compaction.ts` 虽然较长，但当前仍是同一压缩领域算法；本阶段不因行数机械拆分它。

## 分阶段实施

### 阶段一：固定行为基线

- 改动前运行 Context Runtime、Memory Rollover、Compaction Extension 和 Prefire 测试。
- 基线为 4 个测试文件、24 个测试全部通过。
- 盘点生产与测试引用，确认旧 Context Runtime 类只在 Coding Agent 包内使用，不属于公开包根合同。

### 阶段二：提取独立职责

- 新增 `context-runtime/model-call-context-projection.ts`，负责 Envelope、Extension Context、不可见身份过滤、microcompact 和 LLM 消息转换。
- 新增 `context-runtime/conversation-compaction-projection.ts`，负责 Document 到压缩条目、overflow 消息移除、transient message 装配和压缩后历史预览。
- 新增 `context-runtime/compaction-prefire-cache.ts`，独立持有后台摘要、前缀指纹、一次性缓存消费和释放取消。
- 新增 `context-runtime/contracts.ts` 与薄 `index.ts`，分离依赖合同和内部入口。
- 主编排器迁入 `context-runtime/context-runtime.ts`，由 725 行降为 363 行，只保留压缩事务、提交时序、usage 和四个 Runtime Port 的组合。

### 阶段三：中性命名和旧入口退役

- Coding Agent 自有实现改名为 `CodingAgentContextRuntime` 和 `CodingAgentContextRuntimeOptions`。
- Composition、Session Resource、Capability Assembly 和测试全部迁移到中性名称。
- 删除 `adapters/runtime-core/greenfield-context-runtime.ts`，不保留旧类名 alias，避免迁移期名称继续成为内部合同。
- Runtime Core 的 `GreenfieldRuntime*` 类型、CLI/RPC 协议值和文件名不在本阶段机械改名。

### 阶段四：测试与防回退守卫

- 新增模型调用投影测试，覆盖 Extension 转换、model-invisible context 过滤和转换期间取消。
- 新增 Prefire 生命周期测试，覆盖缓存复用、一次性消费和 dispose 中止在途摘要。
- 将旧 Context Runtime 文件加入旧实现精确文件清单，恢复该路径会触发治理失败。
- 新增 Context Runtime 模块行数守卫：`index.ts` 上限 50 行，其余职责模块上限 400 行。
- 重写治理基线升级为版本 12，并增加对应的治理回归测试。

## TypeBox / Zod 判断

本阶段没有引入 TypeBox 或 Zod。新增模块接收的都是已经由 Runtime Core、Conversation Store、Extension Runtime 和静态 Composition 合同构造的进程内对象，没有新增 JSON、RPC、配置、持久化或外部 Tool 参数边界。Schema 校验不会提高压缩事务正确性，反而会重复现有静态类型。现有真正的外部边界仍继续使用各自已有的 TypeBox 校验。

## 旧实现依赖变化

- 旧 `greenfield-context-runtime.ts` 已删除并加入常驻退役守卫。
- `CodingAgentGreenfieldContextRuntime`、`CodingAgentGreenfieldContextRuntimeOptions` 和旧文件路径在 Coding Agent 范围内引用为 `0`。
- 旧执行实现边、Runtime 反向依赖、旧实现文件和兼容导出继续为 `0`。
- Composition 公共导出保持 19 项，外部深层导入为 `0`，包根只保留 1 个稳定 Extension facade 导出。
- 14 个历史格式边界保持不变；本阶段没有增加旧格式执行依赖。

## 行为兼容性验证

- 拆分前 Context/Memory/Extension/Prefire 基线：4 个文件、24 个测试通过。
- 拆分后 Context 与 Session Composition 定向测试：8 个文件、30 个测试通过。
- Coding Agent 重写治理测试：22 个测试通过。
- `bun run check:quick` 通过，Context Runtime 超限模块、旧实现边、Runtime 反向依赖和旧文件均为 `0`。
- `bun run check` 通过，覆盖 Biome、根/CLI/Desktop/Admin 类型检查和全部质量守卫。
- `bun run verify:agent-hosts` 通过，覆盖独立 Vetta CLI 产物、IM Gateway 真实子进程、Coding Agent、CLI 和 Desktop；Desktop 为 121 个文件、511 个测试通过，1 个平台不适用测试跳过。
- 本阶段没有改动 Provider、凭据或模型请求协议，因此没有发送额外的计费 DeepSeek 请求。

## 本阶段结果

- Context Runtime 主类不再混合消息格式投影和 Prefire 状态机，局部职责可以单独阅读与测试。
- 自动/手动压缩、overflow 恢复、Extension Hook、Memory Rollover、microcompact、prefire 和 usage 语义保持不变。
- 公共 Package API 未增加；内部迁移期名称直接退役，没有创建新的兼容层。
- 代码和治理脚本共同约束 Context Runtime 不得重新膨胀为单文件实现。

## 尚未完成的替换

- 没有待替换的旧 Context Runtime 执行路径；本阶段处理的是新架构内部维护性。
- `CodingAgentContextRuntime` 同时实现四个 Runtime Port，是同一 Session 上下文状态的有意组合，不应仅为接口数量拆成四个互相同步的有状态对象。
- Composition 和 Adapter 中仍有其他较长模块，需要按独立变化轴和行为基线逐个审计，不能进行全仓机械拆分或改名。
- 下一处合理候选是 SDK Host Adapter：先区分稳定 SDK 协议适配、Session 资源组装和动态能力绑定，再决定是否存在可独立测试的拆分边界。
