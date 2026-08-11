# 第 174 轮：自动 Legacy 回退策略门禁

## 目标

第 173 轮已经证明普通 RPC 的源码和标准安装产物默认进入中性 Greenfield，但 CLI 仍会在宿主准备结果为 `legacy-fallback` 时直接启动旧 Agent。虽然当前回退原因已经结构化，执行入口并未验证回退原因是否携带足够证据，未来新增或错误构造的回退可能继续扩大 Legacy 生产依赖。

本轮目标是：

1. 将自动 Legacy 回退收敛为一个穷尽、fail-closed 的 CLI Composition Root 策略。
2. 区分用户显式选择 Legacy 与宿主自动回退，避免二者共用模糊策略。
3. 保留现有 Extension 和旧会话兼容行为，不删除或缩小功能。
4. 补齐旧会话迁移 `failed` 分支，并继续用真实 RPC 和安装产物验证合法回退。

## 审计结论

### 1. 自动回退只有两个事实来源

当前普通 RPC 的自动 Legacy 回退只来自：

| 原因 | 必需证据 | 当前具体分支 |
| --- | --- | --- |
| `legacy-extension` | Extension compatibility assessment | 未支持事件或未满足 Runtime capability |
| `legacy-session` | Session migration result | `locked`、`not-representable`、`failed` |

`--agent-runtime legacy` 是用户显式选择；非 RPC CLI 默认 Legacy 是另一条产品入口。两者都不是 Greenfield 准备失败后的自动回退，因此不进入本轮策略。

### 2. 生产导入白名单已经存在，不应重复建设

第 125 轮的 package boundary guard 已经限制 `@vetta/coding-agent/legacy/cli` 只能由 CLI Runtime 选择入口导入。本轮需要约束的是该入口“何时可以执行 Legacy”，而不是再增加一套文件导入白名单。

### 3. `failed` 是真实但此前缺少完整测试的迁移状态

Legacy 源内容和路径共同决定稳定的 V2 目标。目标已存在且内容完全相同时会复用；目标已存在但内容冲突时，迁移会返回 `failed` 和 `conversation_already_exists`。该分支仍需回退旧执行以保持现有功能，但必须成为显式策略成员和测试合同。

## 实施内容

### 自动回退策略

新增 `legacy-runtime-fallback-policy.ts`，在真正调用 Legacy CLI 前执行断言：

- `legacy-extension` 必须存在 `requiresLegacyRuntime=true`，并至少携带一个 `unsupportedEvents` 或 `unmetRuntimeCapabilities`。
- `legacy-session` 必须携带 migration evidence，且状态只能是 `locked`、`not-representable`、`failed`。
- `migrated` 和 `reused` 是成功状态，不能触发 Legacy。
- fallback reason 或 migration status 联合未来新增成员时，穷尽 `switch` 会要求同步更新策略。
- 结构化证据不完整时直接抛错，不启动旧 Agent。

策略只存在于 CLI Composition Root，不下沉到 Runtime Core，也没有让 Coding Agent Kernel 认识 Legacy 产品选择。

### Runtime 选择入口

`runAgentRuntimeCli()` 在收到 `prepared.kind === "legacy-fallback"` 后先验证策略，再构造原有 `RpcRuntimeDecision` 并调用 `runLegacyAgentWithBootstrap()`。

显式 `selection.backend === "legacy"` 分支仍直接执行 Legacy，不经过自动回退策略。RPC wire、stderr 诊断和 fallback reason 保持不变。

### 测试补齐

- 新增纯策略矩阵，覆盖三个允许的迁移失败状态、两个禁止的成功状态、缺少迁移证据、合法 Extension 缺口和无缺口 Extension。
- Legacy 迁移测试增加确定性目标冲突，验证 `failed` 与 `conversation_already_exists`。
- 既有真实 RPC Runtime 选择测试继续覆盖未来 Extension 事件和不可表示旧会话。
- 标准安装产物继续验证 `legacy-extension` 与 `legacy-session` 两种自动回退能实际启动并关闭 Legacy。

## TypeBox / Zod 判断

本轮没有新增外部 JSONL frame、配置文件或持久化数据。策略消费的是进程内已经解析并类型化的 Host preparation 结果，因此使用 TypeScript 联合和穷尽 `switch` 即可。

RPC 外部输入仍由既有 TypeBox schema 负责；为内部策略再引入 TypeBox 或 Zod 会重复校验且模糊协议边界，所以未引入。

## 兼容性判断

本轮是架构门禁，不是功能重构：

- 现有 Extension 未支持事件仍回退 Legacy。
- 旧会话迁移 `locked`、`not-representable`、`failed` 仍回退 Legacy。
- 显式 `--agent-runtime legacy` 行为不变。
- 普通 RPC 默认 Greenfield、IM Greenfield 和非 RPC 默认选择不变。
- RPC JSONL、Runtime decision、stderr 诊断、会话格式和迁移算法未改变。
- 没有新增生产 Legacy 导入，也没有绕过第 125 轮边界守卫。

## 明确未修改

- 没有删除 `runLegacyAgentWithBootstrap()` 或 Legacy CLI。
- 没有改变不可表示旧会话的产品处理策略。
- 没有将 `failed` 改成错误退出或静默忽略。
- 没有改变 Extension compatibility profile。
- 没有扩大 Coding Agent 的公共 RPC API；完整类型检查发现 fallback reason 未公开后，策略改为复用 CLI Host 的内部联合类型。
- 没有对 Tool、Prompt、Skill、MCP、Memory 或模型调用作任何修改。

## 验证结果

- 自动回退纯策略：9 项通过。
- Legacy 会话迁移：7 项通过。
- 真实 RPC Runtime 选择：10 项通过。
- 第一组定向测试合计：3 个文件、26 项通过。
- 标准安装产物关键回退：2 项通过，分别覆盖不可表示旧会话与未来 Extension 事件。
- `bun run check:quick` 通过，包含 package boundary 和 standalone CLI build guard。
- 根目录 `bun run check` 最终通过：Biome、monorepo/CLI/Desktop/Admin 类型检查和全部质量守卫均通过。
- `git diff --check` 通过。

## 下一步

下一阶段应审计非 RPC CLI 的默认 Legacy 路径。需要先区分 print、SDK 兼容入口和无模式提示中哪些仍真正启动旧 `AgentSession`，哪些只是历史命名或薄适配；随后建立真实命令差分门禁，再判断哪些入口可以默认 Greenfield。

旧会话不可表示和未来 Extension 事件涉及明确的功能保留选择。在迁移修复工具、只读保留方案或 Extension API 版本策略确定前，不能通过删除自动回退来假装完成旧代码清理。
