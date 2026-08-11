# 第 254 阶段：历史会话公共边界收口

## 阶段目标

在不改变 CLI、Desktop、SDK、RPC、IM 的历史会话发现、读取、重命名、删除、迁移、恢复和 fork 行为的前提下，将历史会话能力从通用 `runtime-host` 公共面移出，只通过用途明确的 `historical-sessions` 子路径向宿主提供中立合同和工厂。

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

- 历史 JSONL 是必须保留的用户数据格式兼容能力，不是 Runtime Host 的通用执行能力。
- CLI 和 Desktop 只应依赖 `RuntimeSessionCatalog`、`RuntimeSessionFileHistoryReader` 以及迁移结果合同，不应知道 `LegacyRuntimeSessionCatalog` 等具体实现类。
- `runtime-host` 与 `runtime-host/greenfield` 应只暴露当前运行时组合能力，不能继续承担历史格式聚合出口。
- 本阶段不删除历史数据支持，也不改变迁移、锁、重命名或删除语义；只收紧模块所有权和公共依赖方向。

## 本阶段实施内容

### 1. 独立历史会话公共入口

- 新增 `@vetta/coding-agent/historical-sessions` 子路径。
- 公共入口只暴露 catalog/history reader 工厂、迁移函数和使用 `HistoricalSession` 命名的迁移结果类型。
- 工厂返回 `runtime-core` 中立接口，不导出 `LegacyRuntimeSessionCatalog` 和 `LegacyRuntimeSessionFileHistoryReader` 具体类。
- 历史 record normalizer、lease、document reader 等格式细节继续留在 `sessions/legacy` 内部。

### 2. 宿主依赖切换

- CLI 会话目录组合、IM 历史会话迁移和兼容错误类型改用 `historical-sessions`。
- Desktop 历史格式组合与迁移 backend 改用 `historical-sessions`。
- `runtime-host` 和 `runtime-host/greenfield` 删除历史 catalog、history reader、lease、normalizer、恢复器和 migration 的全部导出。
- TypeScript、Desktop Vitest 和包导出映射同步加入新子路径，安装产物可按相同路径解析。

### 3. 行为与架构守卫

- 新增 Desktop 主进程格式兼容测试，覆盖发现、历史读取、重命名、会话文件删除和锁文件删除。
- Desktop 组合边界测试明确要求使用历史会话工厂，并禁止重新出现具体 Legacy catalog/history reader。
- 包边界守卫只允许 5 个已分类宿主适配点导入 `historical-sessions`；其他生产消费者新增依赖时失败。
- 包边界守卫禁止 `runtime-host` 恢复任何历史会话导出，并禁止宿主直接引用具体 Legacy Runtime 类。
- 历史格式统计修正为 14 个边界：4 readers、3 migrations、5 host adapters、1 internal entry、1 public entry；未分类数量保持 0。

## 旧实现依赖变化

| 指标 | 本阶段前 | 本阶段后 | 说明 |
| --- | ---: | ---: | --- |
| `runtime-host` 历史会话导出 | 12 | 0 | 通用 Runtime Host 不再聚合历史格式能力 |
| 宿主直接依赖具体 Legacy Session 类 | 3 | 0 | CLI 1 处、Desktop 2 处改为中立工厂 |
| 历史会话公共用途入口 | 0 | 1 | 仅保留 `historical-sessions` |
| 已分类历史兼容边界 | 11 | 14 | 补入 2 个既有 CLI 适配点和 1 个新公共入口 |
| 未分类历史兼容文件 | 0 | 0 | 保持归零 |
| Legacy execution edge | 0 | 0 | 保持归零 |
| format-to-old edge | 0 | 0 | 保持归零 |

## 行为兼容性验证

- Coding Agent 定向测试：3 个文件，8 项通过。
- Desktop 主进程定向测试：3 个文件，7 项通过，覆盖历史格式生命周期和迁移。
- CLI 历史迁移与锁冲突定向测试：2 个文件，10 项通过。
- Runtime Core 会话服务定向测试：1 个文件，4 项通过。
- 质量门禁定向测试：2 个文件，69 项通过。
- 安装后独立 `vetta` 可执行文件：2 项通过，覆盖历史会话迁移、进程重启复用、不可表示格式显式失败和源文件不变。
- `bun run check:quick` 通过；历史边界统计为 14，未分类为 0，历史数据修改调用仍为 3。
- `bun run check` 通过，覆盖全仓 Biome、根/CLI/Desktop/Admin 类型检查和全部质量守卫。

## 尚未完成的替换

- 历史 JSONL 读取与迁移仍是必须保留的数据兼容能力；未来是否删除取决于明确的兼容期限和用户数据迁移政策，而不是架构统计目标。
- `runtime-host` 仍包含模型、MCP、Prompt 等当前产品 Adapter；后续应按实际依赖审计其公共面，不能把历史会话收口误解为一次性删除所有 Host Adapter。
- 下一阶段应优先审计剩余 `runtime-host` 公共导出与真实宿主消费者的对应关系，删除只为聚合方便而存在、没有独立宿主需求的转发。
