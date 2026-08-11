# 第 264 阶段：Runtime Port 单一事实源闭环

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

第 263 阶段把 Composition 输入合同移入 `src/runtime-contracts`，但部分 Adapter 仍重复声明同构类型，部分 Composition 与公共 API 也继续从 Adapter 导入这些类型。这形成两个事实源：合同层描述组合根需要什么，Adapter 又独立描述一次。一旦其中一侧变化，类型兼容可能暂时掩盖边界漂移。

本阶段只收口稳定 Port 的所有权和依赖方向：合同由 `runtime-contracts` 唯一定义，Adapter 消费或显式实现合同，Composition 与公共 API 直接依赖合同。原 Adapter 类型路径继续重导出同一个类型，保持已有源码消费者兼容，不复制定义，也不保留旧执行实现。

## 实施内容

- 收口 Model、Prompt、Plugin、Extension、Compaction、Tool/Todo 等 16 个稳定 Port 名称，删除 Adapter 内重复的 `interface` / `type` 声明。
- Adapter 改为从 `src/runtime-contracts` 导入稳定类型；只承担协议转换、运行时实现和宿主适配职责。
- `CodingAgentPluginMcpRuntime` 与 `CodingAgentTodoRuntime` 显式实现各自 Port，让实现与组合合同形成编译期闭环。
- Composition 的知识处理、Extension 控制、Subagent Profile 与 Session Assembly 直接依赖稳定 Port。
- 公共 Host Services 与 Runtime 类型直接依赖稳定 Port，不再借 Adapter 暴露合同。
- 保留 Adapter 原有类型重导出，已有深层类型导入仍解析到同一合同；工厂、构造参数和运行时入口未改变。
- 新增独立 `check-coding-agent-runtime-port-ownership.mjs`，避免继续扩大既有 Composition 守卫的职责和文件体积。
- 新守卫拒绝 Adapter 重复声明稳定 Port、Composition/Public API 从 Adapter 导入稳定 Port，以及指定实现未显式符合 Port。
- 未引入 TypeBox 或 Zod：本阶段处理的是编译期 TypeScript 类型所有权，没有新增 JSON、配置、持久化或网络协议输入。

## 旧实现依赖变化

- 受治理的稳定 Port 重复声明为 `0/0`。
- Composition 与 Public API 从 Adapter 导入稳定 Port 为 `0/0`。
- Plugin MCP 与 Todo 实现显式符合稳定 Port 为 `2/2`。
- Adapter 的类型重导出是同一事实源的兼容导入路径，不包含副本、运行时包装或旧行为分支。
- 旧执行入口、Runtime 反向依赖、compat 导出和包根非 Extension 导出继续保持 `0/0`。

## 行为兼容性验证

- `bunx tsgo --noEmit` 通过，CLI、Desktop、测试夹具和 Composition 消费者的原有类型调用保持成立。
- Runtime Port 所有权守卫通过：重复声明 `0/0`、Adapter Port 导入 `0/0`、实现闭环 `2/2`。
- Composition 合同守卫通过：12 个合同模块、10/10 个职责分面、Adapter 依赖 `0/0`。
- 两组架构守卫单元测试通过：2 个文件、4 个测试通过。
- `coding-agent` 全量测试通过：128 个文件通过、1 个文件跳过，891 个测试通过、17 个测试跳过。
- CLI 相关定向测试通过：5 个文件、22 个测试通过。
- Desktop Greenfield Runtime Backend Pool 定向测试通过：1 个文件、6 个测试通过。
- 质量守卫测试通过：6 个文件、97 个测试通过。
- `bun run check:quick` 通过。
- 根 `bun run check` 通过，覆盖 Biome、根/CLI/Desktop/Admin 类型检查和全部质量门禁。
- 本阶段没有修改工具注册、Prompt 内容、模型调用、MCP 刷新、Todo 状态、压缩算法、会话持久化或资源释放逻辑。

## 尚未完成的替换

- 当前完成的是稳定 Port 的定义与实现依赖闭环，不代表所有活动会话切换已具备统一事务语义。
- 下一阶段应收口活动 Session 转换事务：统一 admission、prepare、commit、rollback/cleanup 的边界，并用并发、失败和资源释放测试验证；不能借此改变现有切换策略或用户可观察行为。
- `Greenfield` 迁移期命名仍应在行为兼容和生产依赖归零后独立处理，不能与 Session 转换事务混合。
