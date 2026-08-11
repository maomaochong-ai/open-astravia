# 第 263 阶段：Composition 输入合同边界收口

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

原 `greenfield-runtime-composition-contract.ts` 同时定义 Session 输入、43 个 Composition 输入字段、控制面和返回对象，并直接从 `src/adapters/runtime-core` 引用具体实现类型。这让产品组合根的公开合同反向认识 Adapter，宿主也无法判断每个输入属于模型、工具、资源还是生命周期职责。

本阶段只重构合同边界，不改变参数名或执行路径：Composition 输入拆成十个职责分面，具体实现通过稳定结构 Port 接入，原合同文件降为薄重导出。CLI 与 Desktop 继续构造相同参数，但其类型依赖已经由具体 Adapter 改为稳定合同。

## 实施内容

- 新增 `src/runtime-contracts`，按 Model、Extension、Context、Prompt、Plugin 与 Tool/Todo 分文件定义 Composition 真正需要的最小 Port。
- 新增 `src/composition/contracts`，分别持有 Session Options、Composition Options 和 Runtime 控制/返回合同。
- `GreenfieldRuntimeCompositionOptions` 由 Environment、Conversation、Model、Tool、Subagent、Prompt、Plugin、Extension、Context 与 Observability 十个职责分面组合；现有 43 个属性名称与可选性不变。
- Todo 与 Plugin MCP 的内部索引、初始化、能力组装和资源清理改为消费结构 Port，不再要求宿主返回带私有字段的具体 class。
- 原 `greenfield-runtime-composition-contract.ts` 只保留合同重导出，不含业务类型或 Adapter 依赖。
- 新增 `check-coding-agent-composition-contract.mjs`：统计合同模块数、职责分面数、Adapter 依赖数，并限制薄门面和单个合同模块的行数。
- 新增守卫单元测试，覆盖正常合同、Adapter 回接、职责缺失和文件膨胀。
- 未引入 TypeBox 或 Zod：本阶段边界是编译期 TypeScript Port，没有新增外部 JSON、配置或协议输入，运行时校验不会增加正确性。

## 旧实现依赖变化

- Composition 公开合同到 `src/adapters/**` 的依赖从直接引用收敛为 `0/0`。
- Todo 和 Plugin MCP 在 Composition 内部不再使用具体类的私有结构作为输入合同。
- 旧执行入口、Runtime 反向依赖、compat 导出和包根非 Extension 导出继续保持 `0/0`。
- 没有增加兼容分支、旧 Options 别名或新包；稳定合同仍属于 `coding-agent` 自身。

## 行为兼容性验证

- `bunx tsgo --noEmit` 通过，证明 CLI、Desktop、测试夹具和 Composition 内部调用均可继续使用原参数集合。
- Composition 合同守卫通过：12 个合同模块、10/10 个职责分面、Adapter 依赖 `0/0`。
- 守卫单元测试通过：1 个文件、2 个测试通过。
- `coding-agent` 全量测试通过：128 个文件通过、1 个文件跳过，891 个测试通过、17 个测试跳过。
- CLI 全量测试通过：34 个文件、185 个测试通过，其中独立安装产物验证 13 个测试通过。
- Desktop Greenfield Runtime Backend Pool 定向测试通过：1 个文件、6 个测试通过。
- 质量守卫测试通过：5 个文件、95 个测试通过；`bun run check:quick` 与根 `bun run check` 均通过。
- 本阶段没有修改工具注册、Prompt 生成、MCP 刷新、Todo 状态、压缩算法、会话持久化或资源释放逻辑。

## 尚未完成的替换

- Composition 参数仍保留既有扁平调用形状以避免一次无收益的宿主 API 迁移；职责已经在类型层明确。只有当独立子 Composition Root 确实需要整体替换某一组输入时，才应把对应分面改为嵌套对象。
- Adapter 内部仍有与稳定 Port 结构等价的实现侧类型；后续可在修改对应 Adapter 时逐个改为显式实现或复用稳定 Port，但不能为了消除同名类型进行大范围无行为收益的改写。
- `Greenfield` 迁移期命名尚未规范化；应在 Composition 合同和消费者边界稳定后独立处理，不能与本阶段混合。
