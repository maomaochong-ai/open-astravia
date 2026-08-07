# 第 280 轮：Runtime Composition 稳定身份切换

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

前序阶段已经让 CLI、SDK、RPC 与 Desktop 使用 `@vetta/coding-agent/composition` 的稳定公共名称，但
`coding-agent` 内部仍以 `greenfield-runtime-composition.ts`、迁移合同转发文件和 `GreenfieldRuntime*` 合同类型作为
真实实现身份，外部宿主还需要把稳定名称反向别名成迁移名称。这意味着公共表面已经稳定，内部所有权却仍处于迁移
状态。

本轮只切换 Runtime Composition 的身份，不改变工厂参数、返回结构、执行阶段、工具注册、会话生命周期、错误映射或
资源释放语义。下层 `GreenfieldRuntimeSession`、Runtime Backend 和仍然承担真实实现职责的 Greenfield 模块不在本轮
机械改名范围内。

## 实施内容

### 稳定 Composition Root

- 将 `composition/greenfield-runtime-composition.ts` 移动为 `composition/runtime-composition.ts`；
- 工厂统一为 `createCodingAgentRuntimeComposition`，内部递归工厂同步使用稳定名称；
- `composition/index.ts` 直接导出稳定工厂与合同，不提供旧名称别名或转发文件；
- 删除仅重新导出合同的 `greenfield-runtime-composition-contract.ts`。

### 稳定合同类型族

`composition/contracts` 继续按 Options、Result 和 Session Options 三种职责拆分，但公共类型改为
`CodingAgentRuntime*`：

- `CodingAgentRuntimeComposition` 与 `CodingAgentRuntimeCompositionOptions`；
- Environment、Conversation、Model、Tool、Subagent、Prompt、Plugin、Extension、Context、Observability 十个
  Options facet；
- Session Options、Session Controls、Extension Controls、Tool Access 与 Hook Lifecycle。

合同没有引入 TypeBox 或 Zod。本轮输入仍是进程内 TypeScript 组合参数，不存在新的不可信 JSON、配置文件或协议边界；
增加运行时 Schema 只会重复静态合同，不能提高本阶段的正确性。

### 宿主与内部调用者切换

- CLI Runtime Host、RPC Session Adapter、插件/MCP/Subagent/Todo 等测试直接使用稳定名称，不再反向别名；
- SDK Session 工厂、Knowledge Processing、Session Host 和各初始化装配直接依赖 `contracts/index.ts` 与新的根文件；
- Desktop Backend Pool 与 Candidate 直接使用稳定 Composition 合同，保留既有 Desktop Greenfield 产品候选名称和行为；
- 没有新增兼容层，也没有修改 `@vetta/coding-agent/composition` 的公开导出集合。

### 收紧架构门禁

- Composition 合同门禁不再读取已删除的转发 facade，直接检查责任拆分后的合同模块；
- 迁移残留门禁永久禁止旧根文件、旧合同文件、旧工厂和旧合同类型族；
- Composition 中 `greenfield-*` 文件上限由 `30` 收紧为 `28`；
- Package Boundary 的 Composition Root 所有权检查切换到稳定根路径和稳定合同名称；
- 新增门禁 fixture，证明旧 Composition 根身份重新出现时会失败。

## 旧实现依赖变化

- 旧执行入口：保持 `0`；
- Runtime 对 Coding Agent 的反向依赖：保持 `0`；
- `greenfield-runtime-composition.ts`：删除；
- `greenfield-runtime-composition-contract.ts`：删除；
- 受管源码与测试中的旧 Composition 工厂、合同类型和路径引用：归零；
- Composition 中 `greenfield` 文件：`30 -> 28`；
- Adapter 中 `greenfield` 文件：保持 `30`；
- Adapter -> Composition、Composition -> public API、Extension Host -> Composition 反向边：均保持 `0`；
- 没有通过兼容别名保留旧内部身份，也没有改变用户可观察功能。

## 行为兼容性验证

Runtime Composition 相关定向行为测试：

```text
22 files passed
99 tests passed
```

其中 Coding Agent 为 10 个文件、43 项；CLI 为 11 个文件、50 项；Desktop 为 1 个文件、6 项。测试覆盖 Session
创建与恢复、动态 Tool Frame、MCP 增删与延迟激活、Plugin、Subagent、Todo、Memory、Knowledge、SDK Session 切换与
回滚，以及 Desktop 作用域复用和资源释放。

架构与质量门禁定向测试：

```text
3 files passed
74 tests passed
```

最终运行根级 `bun run check:quick` 和 `bun run check`，覆盖 Biome、全仓类型检查、Desktop/Admin 独立类型检查及全部
质量门禁。本轮是内部稳定身份切换，没有发送外部真实模型请求。

## 尚未完成的替换

- Composition 仍有 28 个、Adapter 仍有 30 个 `greenfield-*` 文件，必须继续按真实职责审计，不能只为降低数量改名；
- Desktop 的 `greenfield-runtime` 目录和 Candidate 命名仍表达迁移阶段，需要单独确认生产入口、历史格式兼容边界和
  Candidate 是否仍有独立产品职责；
- Composition 内剩余 Greenfield 模块混合产品策略、Session 生命周期装配和真实 Runtime 实现，下一阶段应优先审计
  根目录中的产品装配模块，稳定其所有权后再处理命名；
- 任何后续整理都必须继续保持 CLI、Desktop、IM、SDK 只依赖稳定公共合同，并用行为测试证明功能兼容。

下一阶段应审计 `composition` 根目录剩余的 `greenfield-*` 文件，先区分稳定产品装配、真实 Runtime 实现和可以删除的
迁移命名，再选择一个完整职责簇完成稳定身份切换；每轮同步收紧旧路径门禁，而不是批量改名。
