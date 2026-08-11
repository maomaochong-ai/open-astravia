# 第 183 轮：Extension 兼容性事实与 Legacy 策略边界

## 目标

第 182 轮完成 Coding Agent 根入口隔离后，Greenfield Host 仍会在发现未知 Extension event 时直接返回
`legacy-fallback` 和 `legacy-extension`。这把两类职责混在一起：

- Greenfield Host 应只判断自身是否能够承载已加载的 Extension。
- CLI Composition Root 才应决定不兼容时是否进入 Legacy Gateway。

本轮目标是在不改变任何最终功能、诊断或 Runtime 选择结果的前提下，拆开兼容性事实与 Legacy 执行策略。

## 审计结论

### 1. 已知 Extension 能力已经闭环

当前 Greenfield RPC/Print Profile 对适用的 Event、Tool、Command 和命令式 Action 均已支持；Shortcut、
Message Renderer 和 `user_bash` 在非交互宿主中明确为不适用。实际触发 `legacy-extension` 的现有门禁是
未出现在当前 Profile 中的未知事件，例如 `future_event`。

### 2. 策略泄漏位于 preparation 返回合同

兼容性解析本身已经输出完整事实：`unsupportedEvents`、`unmetRuntimeCapabilities` 和
`requiresLegacyRuntime`。问题在于 Greenfield Host 把这些事实直接包装成 Legacy fallback，使 Host 知道了最终
执行策略。

### 3. 本轮不能直接删除自动回退

真实 RPC、Print 和安装产物测试都把未知事件最终进入 Legacy 作为既有行为。直接改成启动失败会产生可观察
功能变化，不属于本轮架构重构范围。因此本轮只移动决策所有权，保留最终行为。

## 实施内容

### 1. 新增中性 Extension 不兼容结果

Greenfield RPC/Print preparation 联合新增 `extension-incompatible` 分支，携带：

- 已完成加载的 Bootstrap；
- 当前 session path；
- 完整 Extension compatibility assessment。

该结果不包含 fallback reason，也不表达是否启动 Legacy。未知事件现在由 Host 作为兼容性事实返回。

### 2. 将 Legacy 映射集中到 CLI Composition Root

`agent-runtime-selection.ts` 在唯一 Runtime 选择边界把 `extension-incompatible` 适配成既有
`legacy-extension` evidence，然后继续通过自动回退策略和唯一 Legacy Gateway 执行。

旧会话 `legacy-session` preparation 保持原实现，两条兼容路径只在 CLI 策略层汇合。

### 3. 隔离旧公开 fallback 合同

为了保持已有类型导出，旧 `GreenfieldRpcFallbackReason` 和 `GreenfieldRpcRuntimeHostFallback` 没有删除，而是
移入 `legacy-runtime-fallback-contract.ts`。Greenfield Host 只重新导出该兼容类型，不再拥有
`legacy-extension` 策略字面量。

新增的中性结果类型通过既有 CLI package 入口公开；旧 deprecated IM 类型和 Runtime Decision wire 均保留。

### 4. 增加静态架构门禁

包边界检查现在禁止 Greenfield product modules 使用 `legacy-extension` 策略字面量。允许位置仍包括 CLI
Composition Root、Legacy fallback 合同、策略校验和 Legacy Gateway。

该规则防止未来把 Extension 兼容性判断重新写成 Greenfield 内部的 Legacy 执行决策。

## 测试

### Host 与策略测试

- Greenfield Host 对 `future_event` 返回 `extension-incompatible`，保留完整 event/capability 证据且没有
  `reason` 字段。
- 已知 Event、Tool、Command、Action 和宿主不适用 UI 注册继续进入 Greenfield。
- Legacy fallback policy 与 Gateway 既有测试保持通过。

### 真实进程与产物测试

- 真实 RPC CLI 将中性不兼容结果映射为既有 `legacy-extension`，Runtime、stderr 和 RPC state 保持不变。
- 默认 Greenfield Print 的未知事件仍完成既有 Legacy fallback。
- 独立安装产物继续验证已知 Extension 运行 Greenfield、未知事件进入 Legacy、显式 Legacy 保持可用。

### 验证结果

- Greenfield Host、fallback policy、Legacy Gateway：29 项通过。
- 真实 Runtime 选择 CLI：10 项通过。
- Print 未知 Extension 回归：1 项通过。
- 安装产物 Extension Profile 回归：1 项通过。
- 静态质量门禁：36 项通过。
- `bun run check:quick`：通过。
- 根目录 `bun run check`：通过，包含 Biome、根 tsgo、CLI tsgo、Desktop tsc、Admin tsc 与全部 guards。

## TypeBox / Zod 判断

本轮新增的是进程内 TypeScript 判别联合，既有 RPC Runtime Decision wire、配置和持久化格式均未改变，因此
不需要 TypeBox 或 Zod。若下一阶段新增可被外部客户端消费的结构化 Extension 启动错误，再在现有 RPC schema
边界使用 TypeBox，而不是为内部策略对象引入运行时校验。

## 明确未修改

- 没有改变已知 Extension Event、Tool、Command、Action 的执行行为。
- 没有改变 Shortcut、Message Renderer 和 `user_bash` 的宿主不适用语义。
- 没有改变未知 Extension event 的最终 Legacy fallback 行为。
- 没有改变 stderr 诊断、RPC Runtime Decision、退出码或安装产物行为。
- 没有改变 `legacy-session` 回退或显式 `--agent-runtime legacy`。
- 没有更新之前的过程文档，只新增本轮实施记录。

## 结果

Greenfield Host 现在只报告 Extension 兼容性事实，CLI Composition Root 独占 Runtime 选择策略，Legacy
Gateway 仍是唯一旧实现启动边界。架构职责已经拆开，同时所有现有功能和兼容行为保持不变。

## 下一步

下一阶段应评估并实施未知 Extension event 的明确兼容策略：

1. 证明当前 Legacy Runtime 同样不会产生未知事件，确认自动回退是否提供真实功能。
2. 若不能提供功能，把未知事件从自动 Legacy fallback 改为结构化启动失败，并保留显式 Legacy 选择。
3. 为 RPC/Print/安装产物定义一致的错误码、诊断证据和退出语义。
4. 该变化属于可观察策略调整，应独立实施，不与架构重构混在本轮。
