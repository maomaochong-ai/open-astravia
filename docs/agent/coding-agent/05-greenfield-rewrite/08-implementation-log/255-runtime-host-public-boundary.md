# 第 255 阶段：Runtime 宿主公共边界收口

## 阶段目标

在不改变 CLI、Desktop、SDK、RPC、IM 的 Agent 行为和协议的前提下，为 Coding Agent 的 Turn、Session、Extension、资源重载、分支导航、Compaction、模型与 MCP 宿主能力建立用途明确的公共入口；外部宿主不再直接依赖 `runtime-host` 聚合入口或具体 `CodingAgentGreenfield*` 适配器。

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

- `runtime-host` 是迁移过程形成的宽聚合出口，不应成为 CLI 和 Desktop 的永久依赖合同。
- Coding Agent 内部可以继续用 Greenfield 命名标识尚未完成内部重命名的实现，但外部宿主只能看到中性的能力接口和工厂。
- 本阶段不是删除 Runtime 实现，也不是删除旧功能；它收紧的是实现所有权与依赖方向。
- Tool 继续由 `runtime-tools` 独立维护；本阶段只处理 Coding Agent 自身的 Runtime 能力编排，不把 Tool 实现搬回 Coding Agent。

## 本阶段实施内容

### 1. 建立稳定 Runtime 公共入口

- 新增 `@vetta/coding-agent/runtime` 包子路径，并同步 package exports、根 TypeScript path、Desktop TypeScript path、CLI Vitest alias 和 Desktop Vitest alias。
- 公共入口按 `turn.ts`、`session.ts`、`extensions.ts` 拆分，顶层 `runtime.ts` 只负责转发，避免重新形成大型聚合实现文件。
- 对外提供 Turn 重试与执行、Session capability、Extension 命令和事件、观察事件适配、资源重载、分支导航、消息投影与 Compaction 的中性接口和工厂。
- `host-services` 增加模型控制器、MCP Runtime Tool Source 与 Plugin MCP Runtime 的中性工厂；宿主不再直接实例化具体产品类。

### 2. 抽象实现依赖

- Turn Executor 和 Session Capability Host 的重试依赖由具体类改为 `CodingAgentGreenfieldTurnRetryControllerPort` 结构合同。
- 公共 Runtime 使用 `CodingAgentTurnRetryController`、`CodingAgentTurnExecutor` 等中性合同，不向外暴露实现对象的私有状态。
- CLI RPC Session Adapter 的重试依赖由具体 `GreenfieldRpcRetryController` 类改为 `CodingAgentTurnRetryController` 端口。
- 第一次完整类型检查据此发现 CLI 仍要求具体类私有字段；修复为端口合同后，CLI 类型检查与完整检查通过。没有使用类型断言掩盖边界问题。

### 3. 宿主迁移

- CLI Print Session、Agent Session Host、Extension Session Host、RPC Session Adapter 和 IM Runtime Host 改用 `@vetta/coding-agent/runtime`。
- CLI IM Runtime Host 的 MCP 与 Plugin MCP 组合改用 `@vetta/coding-agent/host-services`。
- Desktop Runtime Composition 改用 `host-services` 中的模型与 MCP 工厂，不再实例化具体 Shared Model Controller。
- CLI 与 Desktop 生产源码对 `runtime-host` 和 `runtime-host/greenfield` 的直接导入归零；内部实现和既有功能仍保留。

### 4. 防回退质量门禁

- `check-legacy-execution-retirement.mjs` 新增独立 Runtime 公共边界审查，不把 Runtime Host 误判为 Legacy 执行功能。
- 门禁统计 CLI/Desktop 生产代码的外部 `runtime-host` 边和具体 Runtime Adapter 导入，当前均为 0。
- 新增反例测试：旧 `runtime-host` 子路径和具体 `CodingAgentGreenfield*` Adapter 导入会失败；中性 `runtime` 工厂导入通过。
- Desktop 组合边界测试显式禁止生产源码恢复 `runtime-host` 依赖。

## 旧实现依赖变化

| 指标 | 本阶段前 | 本阶段后 | 说明 |
| --- | ---: | ---: | --- |
| CLI/Desktop 生产 `runtime-host` 导入文件 | 6 | 0 | 迁移到 `runtime` 或 `host-services` |
| 外部具体 Runtime Adapter 导入 | 多处 | 0 | 门禁按具体类/工厂名审查 |
| 稳定 Runtime 公共入口 | 0 | 1 | `@vetta/coding-agent/runtime` |
| Legacy execution edge | 0 | 0 | 保持归零 |
| Runtime backedge | 0 | 0 | 保持归零 |
| Greenfield product-core edge | 0 | 0 | 保持归零 |
| 用户可见功能变更 | 0 | 0 | 仅调整架构边界 |

## 行为兼容性验证

- Coding Agent Runtime Core 定向测试：8 个文件，20 项通过，覆盖 Turn、重试装配、Extension、分支导航和资源重载。
- Coding Agent 公共子路径测试：1 个文件，2 项通过，覆盖新 Runtime export 与 Host Service factory。
- CLI 真实 Runtime Host 定向测试：3 个文件，21 项通过，覆盖会话生命周期、历史迁移、Extension、MCP、资源发现、Compaction 与 RPC 能力。
- Desktop 组合边界测试：1 个文件，3 项通过。
- 质量门禁定向测试：1 个文件，13 项通过。
- CLI 独立类型检查通过。
- `bun run check:quick` 通过，报告外部 `runtime-host` 边为 0、外部具体 Runtime Adapter 导入为 0。
- `bun run check` 通过，覆盖全仓 Biome、根/CLI/Desktop/Admin 类型检查和全部质量守卫。

## 尚未完成的替换

- `runtime-host` 与 `runtime-host/greenfield` 公共导出仍存在，供尚未迁移的测试和过渡消费者使用；下一阶段应先统计真实剩余消费者，再按导出逐项删除，不可直接删除实现。
- Coding Agent 内部仍有 `CodingAgentGreenfield*` 实现名；是否重命名必须以模块职责和公共合同稳定为前提，不能进行无行为价值的大规模机械改名。
- `rpc` 公共入口仍包含历史形成的 `GreenfieldRpc*` 名称；这些名称中既有稳定协议，也有具体实现别名，下一阶段应区分合同与实现后再收口。
