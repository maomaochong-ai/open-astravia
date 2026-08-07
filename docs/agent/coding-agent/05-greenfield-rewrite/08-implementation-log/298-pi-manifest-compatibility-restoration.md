# 第 298 轮：`pi` 资源清单兼容合同恢复

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

纠正机械品牌替换造成的功能回归。`package.json.pi` 是现有资源包解析器仍然支持的历史外部格式，不是旧执行架构的内部依赖；架构重写不能把它直接改成解析器不认识的 `vetta` 字段。

## 实施内容

- 将四个扩展示例的资源清单字段从无效的 `vetta` 恢复为 `pi`；
- 将 package-manager 的七个清单场景恢复为 `pi`，继续验证扩展、Skill、过滤、强制包含和子目录清单；
- 将 `dirty-repo-guard` 中未完成的 `pi -> api` 局部替换恢复为一致的 `pi` 参数，消除未定义变量和未使用参数错误；
- 保留 `.vetta` 项目配置目录；
- 保留 `vetta-extension-*` 示例包名和 `@vetta/*` 产品包名。

## 旧实现依赖变化

本轮保留 `pi` 的原因是外部数据兼容，而不是保留旧 Agent 执行实现。产品身份、配置目录和包命名继续使用 Vetta；扩展函数局部参数名使用 `pi` 或 `api` 不构成运行时合同，但同一函数内必须保持一致。

## 行为兼容性验证

- `bunx vitest --run test/package-manager.test.ts`：70 项通过；
- `bun run check:quick`：通过；
- `bun run check`：Biome、Root/CLI/Desktop/Admin 类型检查和全部质量守卫通过。

## 结果

资源包历史清单兼容恢复，产品命名与新架构边界没有回退；当前完整静态质量基线为绿色。

## 尚未完成的替换

本轮发现的错误清单字段和示例类型错误已经全部修复，没有留下兼容分支。`pi` 清单键作为明确的历史外部格式继续保留；是否引入新的 `vetta` 清单版本需要单独设计双格式解析与迁移策略，不能通过文本替换完成。
