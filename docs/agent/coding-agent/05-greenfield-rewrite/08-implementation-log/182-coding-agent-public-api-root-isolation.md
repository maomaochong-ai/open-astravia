# 第 182 轮：Coding Agent 根入口隔离与 Legacy 生命周期闭环

## 目标

第 181 轮已经把自动 Legacy Session 回退收窄到真实的旧格式兼容缺口，但仓库内部仍有测试通过
`@vetta/coding-agent` 根入口获取会话、工具、Extension、RPC 和宿主服务。根入口同时承担外部 SDK
兼容面和内部模块总汇编，导致内部消费者可以绕过已经建立的分层边界。

本轮目标是：

1. 保持根入口的既有外部 API 和运行行为不变。
2. 为剩余职责建立明确、窄化的公共子路径。
3. 将仓库内部消费者迁移到职责子路径，并用静态门禁阻止回退。
4. 用引用一致性测试证明新子路径没有创建第二套实现。
5. 验证迁移过程中暴露的 Legacy Session 关闭问题，确保宿主重启前锁已经释放。

## 审计结论

### 1. 生产代码已经完成根入口迁移

审计时剩余 10 处精确根入口导入，全部位于 CLI、Desktop 和 Runtime Core 的测试代码。生产源码已经使用
`bootstrap`、`rpc`、`profile`、`host-services` 和 `runtime-host` 等职责入口。

因此本轮不需要移动实现，只需要补齐三个缺失的合同面并让测试遵守与生产代码相同的边界。

### 2. 缺失的三个职责入口

- `@vetta/coding-agent/extensions`：Extension runner、事件和合同类型。
- `@vetta/coding-agent/legacy/session`：`AgentSession`、`SessionManager` 及旧会话类型。
- `@vetta/coding-agent/legacy/tools`：仍由兼容 Runtime 使用的旧工具工厂和后台任务类型。

`extensions` 是中性的能力合同；`legacy/session` 和 `legacy/tools` 则通过路径名称明确标记兼容实现，避免新
Runtime 无意依赖旧内核。

### 3. 根入口仍是外部兼容面

本轮没有删除或改名根入口的任何 export。SDK 示例、第三方 Extension 和既有用户代码仍可继续从
`@vetta/coding-agent` 导入。内部隔离不等于外部 Breaking Change，后续是否收缩根入口需要独立版本决策。

## 实施内容

### 1. 新增窄化公共子路径

新增 `public-api/extensions.ts`、`public-api/legacy-session.ts` 和 `public-api/legacy-tools.ts`，并同步接入：

- `packages/coding-agent/package.json` exports map；
- 根 TypeScript path map；
- Desktop 独立 TypeScript path map；
- CLI、Runtime Core 和 Desktop 的 Vitest alias。

子路径只重新导出既有实现，不复制状态、注册表或运行时对象。

### 2. 迁移全部仓库内部根入口消费者

将 10 个测试文件分别迁移到 `rpc`、`bootstrap`、`profile`、`host-services`、`extensions`、
`legacy/session` 和 `legacy/tools`。测试与生产代码现在使用相同的职责边界，不再借助根 barrel 获得隐式依赖。

### 3. 扩展静态包边界门禁

`check-package-boundaries.mjs` 现在扫描 Coding Agent 包外的全部仓库内部源码和测试，不再只检查生产目录。
已有更严格边界规则覆盖的生产目录由对应规则报告，避免同一违规产生重复诊断。

质量门禁增加 Desktop 测试与 Runtime Core 测试样例，证明测试代码重新引入根入口也会失败。

### 4. 增加公共 API 身份合同

公共子路径测试同时验证：

- package exports 中存在三个新入口；
- 子路径导出的 Extension、Session、Manager、后台任务和工具工厂与根入口导出严格引用相等。

这项测试保证子路径只是稳定的访问边界，不是会造成 `instanceof`、注册表或静态状态分裂的第二模块实现。

### 5. 修复 Legacy Session 异步关闭合同

Desktop 差分测试在去除根 barrel 副作用后稳定暴露出宿主恢复会话时的自身锁冲突。根因不是子路径实现变化，
而是 `LegacyRuntimeSessionIdentityLifecycle.dispose()` 在 Promise 合同中调用了返回 `void` 的
`AgentSession.dispose()`。后者仅 fire-and-forget 地启动关闭，RuntimeHost 因而在锁真正释放前就认为销毁完成。

适配器现在直接等待 `AgentSession.close()`。新增单元测试验证 dispose Promise 在 close 完成前不会 resolve，
Desktop 差分测试则验证同一宿主销毁、重启、恢复、分支和多会话所有权均可完成。由于真实 SessionEnd Hook
清理允许耗时，两个原先依赖 fire-and-forget 的短超时用例改为显式 30 秒上限；没有跳过清理或放宽断言。

## 测试

- Coding Agent 公共子路径合同：2 项通过。
- Coding Agent Legacy 生命周期回归：1 项通过。
- Runtime Core 相关 Session 合同：24 项通过。
- CLI RPC、Runtime Host 与工具组合：40 项通过。
- Desktop 模型调用差分：10 项通过。
- Desktop Runtime Host Legacy/Greenfield 差分：6 项通过。
- 静态质量门禁测试：35 项通过。
- `bun run check:quick`：通过。
- 根目录 `bun run check`：通过，包含 Biome、根 tsgo、CLI tsgo、Desktop tsc、Admin tsc 与全部 guards。

## TypeBox / Zod 判断

本轮只调整 TypeScript 模块出口、导入路径、静态扫描规则和进程内生命周期等待，没有新增外部 JSON、配置、
RPC wire 或持久化 schema。现有类型系统足以表达这些合同，因此不引入 TypeBox 或 Zod。

## 明确未修改

- 没有删除或收缩 `@vetta/coding-agent` 根入口的外部 API。
- 没有改变 Tool、Prompt、Skill、MCP、Knowledge、Memory、模型调用或 Extension 行为。
- 没有改变工具名称、参数 schema、描述或执行结果。
- 没有改变 Legacy Gateway、自动回退策略或显式 `--agent-runtime legacy`。
- 没有复制 Session、Tool 或 Extension 实现。
- 没有更新之前的过程文档，只新增本轮实施记录。

## 结果

Coding Agent 根入口现在只作为外部 SDK 兼容面存在；仓库内部代码和测试必须通过职责子路径依赖具体合同。
静态门禁防止重新耦合根 barrel，引用一致性测试防止子路径产生多实例。同时，RuntimeHost 的 Legacy Session
销毁合同现在真正等待资源安静和文件锁释放，宿主可以可靠地恢复同一会话。

## 下一步

下一阶段应回到第 181 轮识别的最后一个自动回退来源 `legacy-extension`：

1. 固化 Greenfield 已知 Extension event/capability 支持矩阵，并区分宿主不适用能力与未知协议能力。
2. 为未知 Extension event/capability 定义显式的协议版本和拒绝合同，不再用自动 Legacy 执行掩盖缺口。
3. 用真实 CLI/IM 进程测试证明已知能力保持 Greenfield、未知能力明确失败或要求用户显式选择 Legacy。
4. 保留根 SDK API 和 Extension 功能行为；该阶段只收窄 Runtime 选择边界。
