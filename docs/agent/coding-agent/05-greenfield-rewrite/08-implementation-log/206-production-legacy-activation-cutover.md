# 第 206 阶段：生产 Legacy 激活归零与 Canonical Entrypoint Cutover

## 目标

本阶段只改变运行时架构归属，不重构 Agent 功能：

- CLI、Desktop 与 Knowledge Processing 的生产入口不再创建 Legacy 执行实例；
- 旧的 `legacy` 参数和环境变量继续可被识别，但实际执行统一映射到 Greenfield；
- Legacy 会话格式继续保留读取、判定、迁移和兼容失败能力；
- Legacy 与 Greenfield 的行为差分测试继续存在，但 Legacy 基线只能由测试专用入口激活；
- 暂不删除 `coding-agent` 包内的 Legacy 实现、公开导出和旧可执行文件，它们留给下一阶段独立处理。

## 实施前问题

第 205 阶段建立的退役门禁确认，仓库仍有 15 条 Legacy 执行边：其中 5 条属于生产宿主激活路径，分布在 CLI、Desktop 与 Knowledge Processing。其余 10 条位于 `coding-agent` 内部实现或兼容公开面。

这意味着默认运行时虽已主要迁移到 Greenfield，但调用方仍能通过显式配置重新进入 Legacy，Canonical Runtime 还没有真正唯一化。

## 本阶段实施

### 1. CLI 请求与实际执行分离

`AgentRuntimeSelection` 现在同时记录：

- `backend`：调用方请求的后端，允许保留 `legacy`；
- `effectiveBackend`：实际执行后端，只允许 `greenfield` 或 `greenfield-im`。

显式请求 `legacy` 时，根据既有 CLI 意图选择对应 Greenfield Host，并在诊断信息中记录 `reason=legacy-retired`。这样既保留调用兼容和可观测性，也不会重新激活 Legacy。

已删除 CLI 的生产 Legacy Gateway 及其专用测试。扩展兼容错误、会话兼容错误和 RPC runtime decision 仍携带原始 requested backend，因此故障信息可以准确表达“请求了 Legacy，但由 Greenfield 执行”。

### 2. Desktop 只保留迁移边界

Desktop Runtime Selector 将旧的 `legacy` 环境配置映射到 Greenfield。Composition Root 不再创建 Legacy execution compatibility backend：

- 新会话和正常会话统一进入 Greenfield；
- Legacy 格式会话只进入 `legacy-migration` 路由；
- 可表达的旧会话迁移后由 Greenfield 继续执行；
- 不可表达的旧会话显式失败；
- 源会话不被原地改写。

已删除 Desktop Legacy 执行适配器。Legacy 格式目录、识别器和迁移后端继续保留，因为它们属于数据兼容边界，不属于执行内核。

### 3. Knowledge Processing 统一使用 Greenfield

Knowledge Processing Session Factory 不再暴露或构造 Legacy factory，生产组合只接受 Greenfield backend。处理能力和调用合同没有变化，变化仅限执行内核的选择权被收口。

### 4. 测试专用 Legacy 差分基线

生产代码不再导入 `@vetta/coding-agent/legacy/*`。为了继续证明功能没有因架构切换而漂移，新增测试专用 RPC 入口：

- Legacy/Greenfield Provider、Extension、Print 等差分测试仍可运行真实 Legacy 基线；
- 该入口只位于测试目录，不会进入生产 selector 或安装产物；
- 生产 `--agent-runtime legacy` 测试改为验证 requested=`legacy`、effective=`greenfield` 的映射语义。

因此，“保留功能验证”与“禁止生产激活”被明确分成两个边界。

### 5. 外部协议类型校验

RPC startup failure 是 JSONL 外部协议，requested backend 需要接受已退役但仍兼容识别的 `legacy`。这里使用 TypeBox 定义 `legacy | greenfield | greenfield-im` 联合 Schema，并增加解码测试。

TypeBox 只用于不可信协议输入的运行时校验；内部 composition 类型继续使用 TypeScript，未为了形式统一引入额外 Schema。

### 6. 退役门禁收紧

质量门禁完成以下调整：

- 禁止 CLI、Desktop、Knowledge Processing 的生产代码导入 Legacy 执行入口；
- 禁止恢复已删除的 CLI Gateway、Desktop Legacy 执行适配器和 Knowledge Legacy factory；
- 测试目录允许使用 Legacy 基线；
- Legacy 格式读取与迁移边界仍被明确允许；
- 生产宿主 Legacy 执行边从 5 条降为 0 条；
- 全仓 Legacy 执行边基线从 15 条降为 10 条。

当前门禁结果：

```text
[legacy-execution] ok (10 execution edge(s), 8 retained format boundary(s), 98 Greenfield shared-core import(s))
```

剩余 10 条执行边均位于 `coding-agent` 包内部实现或兼容公开面，不再能被 CLI、Desktop、Knowledge Processing 生产宿主激活。

## 兼容性结论

本阶段没有删除既有 Agent 功能：

- 工具、提示词、Skill、Extension、Provider、RPC、Print 和会话能力继续由差分测试覆盖；
- 旧 `legacy` 配置不会因未知值直接失败，而是被兼容映射到 Canonical Greenfield Runtime；
- 旧会话数据没有被删除或静默改写；
- 迁移能力与不兼容错误仍是显式合同；
- Legacy 实现尚未物理删除，因此外部包导入和旧二进制的破坏性变更没有混入本阶段。

## 验证记录

- Runtime Cutover：4 个测试文件，41 个测试通过；
- CLI runtime selection 与兼容策略：3 个测试文件，15 个测试通过；
- Desktop selector、composition、migration、knowledge：4 个测试文件，11 个测试通过；
- RPC startup failure：1 个测试文件，5 个测试通过；
- Print：1 个测试文件，18 个测试通过；
- Provider differential 与 Extension history：2 个测试文件，13 个测试通过；
- Installed artifact runtime：1 个测试文件，13 个测试通过；
- Quality gates：2 个测试文件，56 个测试通过；
- Legacy retirement guard：10 条执行边、8 条格式边界、98 条 Greenfield shared-core imports，检查通过。
- 根目录 `bun run check`：Biome、monorepo tsgo、CLI 独立类型检查、Desktop 独立类型检查、Admin project build 与全部 guards 通过。

## 阶段结论

生产运行时已经形成单一方向：宿主只能激活 Greenfield，Legacy 只作为旧请求标识、旧数据格式和测试差分基线存在。执行切换与数据迁移不再混在同一抽象中。

## 下一阶段建议

下一阶段应处理“物理退役与可执行产物归属”，不要继续改宿主行为：

1. 先确定并迁移 `coding-agent` 的 `vetta-agent` bin ownership，保证 Canonical Entrypoint 不再指向 Legacy CLI；
2. 删除 `coding-agent` 内部 Legacy main/backend/knowledge execution 实现；
3. 收缩 package exports 和公开类型，只保留格式识别、迁移与必要的兼容错误合同；
4. 将测试差分基线改为冻结 fixture 或独立兼容测试包，再移除测试对真实 Legacy 执行实现的依赖；
5. 将退役门禁基线从 10 条继续降到 0，同时保持 8 条格式边界不被误删。

这一阶段会涉及公开导出和二进制归属，属于潜在破坏性变更，应单独实施和验证。
