# 第 235 阶段：Extension 合同职责拆分

## 阶段目标

消除 `src/extensions/contracts.ts` 形成的新巨型合同文件，把变化频率不同的 Extension 合同按职责拆开，使单个模块可以独立理解、测试和扩展。现有 `src/extensions` 公共聚合入口、Extension API 名称、事件字段、TypeBox Schema 与运行时行为保持不变。

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

稳定领域并不意味着把原有巨型文件移动到新目录。Extension 是能力编排协议，内部仍需要区分宿主 UI、执行上下文、Tool、事件、Provider 注册、公共注册 API 和 Loader/Runner 状态。拆分后，修改某类事件不再要求同时理解 Provider 或运行时装载状态。

`contracts.ts` 继续作为兼容聚合入口，保证包内现有消费者不发生导入迁移；新增代码可以直接依赖具体职责模块，避免重新耦合整个 Extension 合同面。

## 实施内容

- `contracts.ts` 从 1480 行缩减为 11 行，只聚合稳定合同。
- 新增 `ui-contracts.ts`、`context-contracts.ts`、`tool-contracts.ts`、`provider-contracts.ts`、`api-contracts.ts` 和 `runtime-contracts.ts`。
- 新增 `events/` 子域，按 Agent、Session、Tool、Input、Resource 和结果合同拆分；`events/index.ts` 只负责事件联合与聚合导出。
- `runtime-bindings.ts` 改为直接依赖 `runtime-contracts.ts`，不经过总聚合入口。
- 保持所有导出名称、字段、函数实现和函数重载不变；现有调用方继续从 `contracts.ts` 或 `extensions/index.ts` 使用同一 API。
- 重写质量守卫新增绝对文件规模约束：聚合入口最多 50 行，Extension 职责模块最多 300 行；该约束不能通过更新重写基线绕过。

## 旧实现依赖变化

| 指标 | 第 234 阶段 | 本阶段 | 最终目标 |
| --- | ---: | ---: | ---: |
| 生产代码到旧实现的精确依赖边 | 128 | 128 | 0 |
| Extensions 域旧依赖 | 6 | 6 | 0 |
| Runtime 包到 `coding-agent` 的反向依赖 | 0 | 0 | 0 |
| 明确登记的旧实现文件 | 153 | 153 | 0 |

本阶段是稳定 Extension 领域内部的职责整理，不通过移动旧实现降低统计，也不新增旧实现依赖。

## 行为兼容性验证

- Extension/Greenfield/SDK 定向测试 17 个文件、108 项测试通过，覆盖动态加载、事件顺序、Tool 拦截、命令、压缩和 SDK 自定义 Tool。
- 重写治理测试 8 项通过，证明巨型聚合文件和巨型职责模块即使写入统计基线也会被拒绝。
- `bun run check:quick` 与全仓 `bun run check` 通过，覆盖 Biome、monorepo/CLI/Desktop/Admin 类型检查和全部质量守卫。

## 尚未完成的替换

- Extension 领域仍有 6 条旧依赖，来自旧 Loader、Runner、Wrapper 与兼容聚合入口；本阶段没有用文件拆分掩盖这些运行时依赖。
- 下一阶段仍应按 discovery/loading、event dispatch 和 tool interception 重写旧运行时，最终删除 `core/extensions`。
- `ui-contracts.ts` 暂时保留现有 Theme/UI 结构，以保证 RPC、HTML export 和现有 Extension 渲染合同；是否进一步抽离主题值合同应在宿主 UI 边界阶段单独审计。
