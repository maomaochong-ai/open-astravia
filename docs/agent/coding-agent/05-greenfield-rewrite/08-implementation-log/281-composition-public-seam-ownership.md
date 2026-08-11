# 第 281 轮：Composition 公开接缝所有权收口

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

第 280 轮已经将 Runtime Composition 根切换为稳定身份，但 Composition 公开入口仍包含三个由迁移命名实现提供的接缝：
会话文件路径解析、Knowledge Processing Session 工厂和 RuntimeHost Session Backend。本轮按真实责任重新归属这些实现，
不改变 `@vetta/coding-agent/composition` 对宿主提供的稳定导出，也不改变创建、恢复、重试、错误映射或资源释放语义。

## 实施内容

### 会话路径解析归属 Runtime Storage

- 将 `resolveSessionIdFromPath` 实现迁入 `@vetta/runtime-storage/conversation`；
- 解析器复用同域的 `encodeConversationSessionId` 做 Base64URL 规范往返校验；
- SDK、CLI、IM 和 RuntimeHost Backend 直接依赖存储域，不再通过 Coding Agent Composition 取得存储格式能力；
- Composition 仅直接重导出稳定公开名称，维持既有公共 API 集合。

### Knowledge Processing 切换稳定身份

- `greenfield-knowledge-processing-session.ts` 改为 `knowledge-processing-session.ts`；
- 工厂与 Options 类型使用 `createKnowledgeProcessingSessionFactory` 和
  `KnowledgeProcessingSessionFactoryOptions`；
- Desktop 与测试直接使用稳定名称，不保留反向别名或转发文件；
- Knowledge 合同、模型刷新、锁定 Todo、批量共享写会话、Usage 与释放行为保持不变。

### Runtime Host 后端归属 Host 层

- Session Backend 与重试装饰器从 Composition 移到 `host/runtime-host`；
- 采用 `CodingAgentRuntimeHostSessionBackend`、`CodingAgentRuntimeHostRetrySettings` 与
  `withCodingAgentRuntimeHostRetry` 稳定身份；
- 没有将其放入 `adapters`：该实现需要消费 Composition 合同，而现有架构明确要求 Adapter -> Composition 反向边为零；
- CLI、Desktop 继续通过 Composition 公共入口消费后端，内部错误合同门禁改为检查真实 Host 文件。

### 收紧迁移门禁

- 永久禁止四个旧 Composition 文件、旧模块引用、旧工厂、旧 Backend 和旧 Retry 类型重新出现；
- Composition 中 `greenfield-*` 文件上限由 `28` 收紧为 `24`；
- Adapter 中 `greenfield-*` 文件仍为 `30`，没有通过错误搬迁降低统计；
- 新增门禁 fixture，验证旧 RuntimeHost/路径解析身份重新出现时会失败；
- Knowledge Processing 边界守卫改为检查稳定实现路径。

本轮没有引入 TypeBox 或 Zod。会话文件名由受控路径规则和 Base64URL 规范往返校验处理，不是新的不可信结构化载荷；
Knowledge 与 RuntimeHost 参数仍使用已有进程内 TypeScript 合同，引入 Schema 会重复现有边界而不增加正确性。

## 旧实现依赖变化

- 旧执行入口：保持 `0`；
- Runtime 对 Coding Agent 的反向依赖：保持 `0`；
- 四个旧 Composition 实现文件：删除；
- 受管生产代码和测试中的本轮旧名称引用：归零；
- Composition 中 `greenfield-*` 文件：`28 -> 24`；
- Adapter 中 `greenfield-*` 文件：保持 `30`；
- Adapter -> Composition、Composition -> public API、Extension Host -> Composition：均保持 `0`；
- 没有新增兼容层，没有修改用户可观察功能。

## 行为兼容性验证

定向行为测试覆盖 10 个文件、46 项测试，全部通过：

- Runtime Storage：合法 Unicode Session ID 往返，以及根目录、旧后缀、嵌套路径、目录外路径和非法编码拒绝；
- Coding Agent：Knowledge 单会话与批处理、Session 锁错误映射、SDK 创建/恢复/队列/重试/切换/回滚；
- CLI 与 IM：RuntimeHost 参数映射、恢复、自动重试、能力装配和 RPC 适配；
- Desktop：Knowledge 工厂注入、Backend Pool 作用域隔离、恢复、并发所有权和 MCP 生命周期。

架构与质量门禁定向测试为 3 个文件、76 项测试，全部通过。实际门禁输出为：

```text
retired files=0/0
retired references=0/0
Adapter greenfield files=30/30
Composition greenfield files=24/24
Adapter->Composition edge files=0/0
Composition->public API edge files=0/0
Extension Host->Composition edge files=0/0
runtime failure boundary violations=0
```

格式化、`bun run check:quick` 和根级 `bun run check` 全部通过。`bun run verify:agent-hosts` 也通过，完成独立 CLI
可执行文件编译、IM Gateway Go 套件、Coding Agent 功能套件及 Desktop 套件验证，最终结果为
`coding-agent, CLI, Desktop, IM` 全部 `ok`。本轮没有发送外部真实模型请求。

## 尚未完成的替换

- Composition 仍有 24 个、Adapter 仍有 30 个 `greenfield-*` 文件，必须继续按真实职责逐簇审计，不能批量改名；
- Desktop 的 `greenfield-runtime` 仍是迁移身份，需在生产入口和历史格式兼容合同明确后再稳定命名；
- Composition 根目录仍混合 Session 装配、资源生命周期和产品策略，下一阶段应选择一个完整职责簇迁移到明确所有者；
- 后续每轮必须继续保持稳定公共合同与行为测试，不得以删除旧功能换取迁移数字下降。

下一阶段优先审计 Composition 中的 Session 初始化与资源生命周期装配簇，判断其应归属 Composition、Host 还是独立能力域，
然后以一个完整行为闭环完成稳定身份切换并同步收紧门禁。
