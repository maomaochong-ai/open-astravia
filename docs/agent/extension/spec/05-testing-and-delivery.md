# 测试、阶段和验收标准

## 验收原则

兼容不能用“实现了多少同名方法”衡量。验收单位是：

```text
一个固定来源的 Extension fixture
  × 一个 compatibility profile
  × 一个 host capability profile
  × 一组可观察行为
```

可观察行为包括注册结果、事件顺序、Tool Schema/执行/取消、结构化交互请求、reload、错误、来源诊断和清理。只有 fixture 在目标 host 上通过该 profile 声明的完整行为合同，才计入兼容覆盖。

建议维护以下指标：

- corpus Extension 总数、成功加载数、拒绝数；
- contribution/capability 的 `lossless`、`adapted`、`host-dependent`、`excluded`、`unsupported` 数量；
- 使用 current namespace 与 legacy namespace 的覆盖；
- 动态注册/reload 后的 catalog revision 与资源泄漏数；
- 错误是否具有稳定 code、source 和 generation；
- 不同 host 的通过矩阵。

不承诺“Pi `0.84.1` API 100% 兼容”，应发布形如 `pi-profile-2026-08@936aff0` 的能力 profile 与生成的兼容表。

## Compatibility corpus

先建立 `packages/coding-agent/test/fixtures/native-extensions/`。每个计划映射的 Tool、状态事件、Provider 和 lifecycle 能力必须先有 Vetta native fixture；Pi fixture 不能替代原生合同测试。

在 `packages/coding-agent/test/fixtures/pi-extensions/` 建立受控 corpus：

```text
pi-extensions/
  manifest.json                  # 上游 SHA、来源、license、capability 标签
  imports/
  tools/
  events/
  commands/
  interaction/
  excluded-presentation/
  rejected-tui-imports/
  lifecycle/
  provider/
  invalid/
```

fixture 来源分三类：

1. 仓库自编最小 fixture：每个合同一个变量，便于定位回归；
2. 从 Pi examples 提炼的行为 fixture：保留必要版权说明和固定上游 SHA，不复制无关大段代码；
3. 真实生态 Extension 的安装级 smoke fixture：默认只使用固定 tarball/hash 或测试内 mock，不在普通 CI 中访问网络。

`manifest.json` 记录 Extension 使用的 import、API、事件、宿主需求、期望状态和预期 adaptation/exclusion。纳入兼容率分母的 fixture 不得依赖 Pi TUI；TUI fixture 只验证稳定拒绝和诊断。更新 Pi baseline 时先更新 corpus 和差异报告，再修改兼容实现。

同一能力的测试顺序固定为：native Extension fixture -> canonical contribution/catalog contract -> Pi projection fixture。删除 Pi fixture 后，native 能力测试仍必须完整覆盖行为。

## 测试分层

### 纯单元测试

目标目录建议为 `src/extensions/contributions/test/` 和 `src/extensions/pi-compat/**/test/`。

必须覆盖：

- specifier/subpath allowlist 与 current/legacy namespace 映射；
- registration guards 对缺字段、错误类型、恶意 getter 的处理；
- Schema JSON-safe clone、深度/大小限制、dialect、local `$ref` 和 forbidden remote `$ref`；
- `prepareArguments -> validate` 顺序；
- event projector、result guard、fold/short-circuit 顺序；
- conflict policy 的稳定排序和诊断；
- compatibility compiler 在不同 host profile 下的状态；
- catalog transaction 的 publish/rollback/replace/remove；
- generation 状态迁移、幂等 dispose 和 stale facade；
- error code 与 source metadata。

纯函数测试不加载 React 或任何 TUI runtime，不启动完整 Agent。

### Vetta native 合同测试

在加载 Pi module 之前必须覆盖：

- native factory 部分失败时 draft 零发布，reload 失败保留上一 generation；
- 现有 native shortcut/message renderer/tool renderer 的注册、冲突和 teardown 行为保持不变，且 Pi adapter 不能生成对应 host contribution；
- native `registerTool` 动态发布只影响下一 model call，in-flight Tool 使用原 binding；
- `normalizeInput -> validateInput -> execute` 顺序、错误分类和 abort；
- Tool prompt summary/guidelines 只在 Tool active 时进入 prompt draft，并带 source/token diagnostics；
- `agent_settled/session_metadata_changed/thinking_level_changed` 的精确触发次数、提交顺序和 source；
- stale native context/action 在 session replacement/reload 后拒绝副作用；
- Provider config register/unregister、built-in restore、generation cleanup 和 credential redaction；
- `ExtensionInteractionPort` 在 Desktop、CLI、RPC、headless 的统一 request/error 合同。

Pi adapter 不得重新实现这些测试中的目录、调度或生命周期，只测试输入输出投影。

### Module facade 合同测试

用 Jiti 按真实 loader 路径加载 fixture，至少覆盖：

- `@earendil-works/*` 与 `@mariozechner/*` 两套 namespace；
- `typebox`、`typebox/compile`、`typebox/value` 和 legacy TypeBox specifier；
- current/legacy `pi-tui` root 与 subpath 均返回 `PI_COMPAT_EXCLUDED_TUI_IMPORT`，且不会回退到已安装 npm 包；
- 允许 export 可调用，未知 subpath/export 产生稳定错误；
- TypeBox 1 module identity 在同一 generation 内一致，不与 native TypeBox 0.34 混用；
- factory cache 以 cwd、resolved path、profile 和 generation 隔离；
- factory 失败时没有全局 contribution；
- project trust 拒绝发生在 factory side effect 之前。

### Extension 行为合同测试

每种功能至少有一个成功、一个失败、一个 lifecycle fixture：

| 功能 | 核心断言 |
| --- | --- |
| Tool | Schema、参数准备、执行、update、abort、result、下一 model call 刷新 |
| Event | payload 投影、handler 顺序、transform folding、invalid result、异常 policy |
| Command | 参数/上下文、重复名、host router、session replacement |
| 结构化交互 | `notify/select/confirm/input`、无交互 host 错误、timeout、取消 |
| 排除的展示能力 | Tool render 字段剥离、renderer/Theme 诊断、TUI import 和 UI 方法稳定拒绝 |
| Context | 每次调用 fresh、session view、stale generation、action 权限 |
| Resource | sourceInfo、去重、package update rollback、trust |
| Provider config 子集 | 字段 allowlist、model metadata、credential redaction、发布/注销/回滚 |

### 差分测试

Pi 的内部实现不是 Vetta 的依赖，但可以作为行为 oracle。只对 profile 内、完全不依赖 Pi TUI 或真实 Provider 的 fixture 做差分：

1. 在固定 Pi SHA 上运行 fixture，输出标准化 trace；
2. 在 Vetta compat 上运行同一作者代码，输出相同 trace 格式；
3. 忽略时间戳、内部 id 等非合同字段；
4. 比较事件顺序、注册、Tool 输入输出、错误类别和清理。

差异必须被分类为：bug、已声明 adaptation、host-dependent、excluded 或 unsupported。不能直接更新 golden 消除未知差异。

普通 CI 不 clone 上游；Pi baseline trace 和必要 fixture 固定在仓库。可选的维护任务定期对固定 SHA/新候选 SHA 重放，生成升级报告，不自动改变兼容 profile。

### Host 矩阵测试

至少覆盖以下能力 profile，而不要求每个 host 都渲染相同 UI：

| Host profile | 必测能力 |
| --- | --- |
| SDK/headless | Tool、事件、action、无交互错误、资源清理 |
| RPC | 序列化边界、interactive request、取消、错误投影 |
| CLI | 命令、flag、结构化交互；不测试 Pi shortcut/component/renderer |
| Desktop | 结构化交互、i18n host 文案、session replacement、权限/trust |

宿主测试消费同一 canonical contributions，禁止分别实现四套 Pi registration。

### 并发与故障注入

需要专门测试：

- model call 期间动态注册 Tool；
- Tool 执行期间 reload/disable Extension；
- 新 generation factory、Schema compile 或 publish 失败；
- event handler 在 transform 链中抛错或返回无效值；
- shutdown 中多个 disposer 同时失败；
- Provider config 在 publish/unregister/reload 竞争中保持 owner 一致；
- 同一 package 被多个 source 同时发现；
- 多 session 并行使用同一 module factory，但拥有独立运行态。

断言不仅检查结果，还检查没有 dangling subscription、provider、timer、Tool binding 和 cache entry。

### 安全测试

兼容层执行受信本地代码，不是 sandbox，但仍需验证边界：

- 未信任项目的 factory 不执行；
- path traversal、symlink/source identity 和重复 canonical path；
- 超大/循环/带 getter/污染 prototype 的 registration 与 Schema；
- remote `$ref` 不触发网络；
- Extension 诊断不泄露 token、headers 或 credential；
- Provider config 诊断和 model catalog 不泄露未声明的 secret；
- 非交互 host 不静默确认高风险请求。

## 分阶段实施

### P0：决策和兼容基线

交付：

- 新 ADR：native-first、canonical contribution、ACL、trust、兼容 profile 和默认开关；
- 固定 Pi SHA/Profile 与 corpus manifest；
- 从 Pi examples/生态中筛选不依赖 TUI 的行为 corpus，并记录排除原因；
- 现有 Vetta Extension 行为基线测试，以及 native fixture 目录。

退出条件：团队确认公共合同和非目标；没有生产 loader 变更。

### P1：Vetta Native Contribution Catalog 与 Generation

交付：

- `contributions/` contracts、draft、compiler、catalog transaction、conflict policy；
- Vetta native registration 先改为写 draft，再发布到现有 runtime ports；
- generation-owned resource cleanup；
- stale context/action、atomic reload 和当前行为不变的差分/回归测试。

这是最关键的可维护性阶段。先让 native path 证明 IR 足够表达现状，再接 Pi，避免为 Pi 造一套未验证的平行抽象。

退出条件：native Extension 行为通过，failed registration/reload 可以原子回滚，架构边界检查通过。

### P2：Vetta Native Tool 与 Prompt 能力

交付：

- `runtime-core` Runtime Tool `validateInput` 窄 Port，并透传 Agent engine 已有能力；
- native Extension Tool `normalizeInput`；
- native Tool prompt summary/guidelines contribution；
- 动态 native Tool registration 到 catalog revision；
- sequential/in-flight/next-model-call 合同测试。

退出条件：只使用 Vetta native Extension fixture 即可证明 input、prompt、动态发布和回滚，不存在 Pi import。

### P3：Vetta Native Lifecycle、Context 与 Interaction

交付：

- `agent_settled/session_metadata_changed/thinking_level_changed` 原生事实事件；
- fresh context、generation stale check 和 session replacement；
- `ExtensionInteractionPort`：`notify/select/confirm/input`；
- SDK/RPC/CLI/Desktop host profile 合同。

退出条件：native event 顺序和交互 Port 在 host matrix 通过；不使用 Pi event name 或 Pi UI 类型。

### P4：Vetta Native 配置型 Provider Ownership

交付：

- owner-aware Provider config contribution；
- native `unregisterProvider`、built-in restore 和 reload cleanup；
- 仅字段交集的 allowlist 与 credential redaction；
- OAuth/stream/native Provider 的明确非目标测试。

退出条件：native Provider fixtures 覆盖注册、替换、撤销、失败回滚和下一次 model selection 可见性。

### P5：Pi Loader、Schema 与 Inspect

交付：

- current/legacy namespace 和 TypeBox 1 module facade；
- `pi-tui` current/legacy namespace 的显式拒绝规则；
- trust gate、cache generation 和 Pi factory -> native draft adapter；
- Schema normalizer/validator registry；
- `inspect-only` 报告和稳定错误码。

退出条件：import/schema/invalid corpus 通过；Pi adapter 没有直接修改 ToolRuntime、ModelRuntime 或 Runner。

### P6：Pi 行为子集映射与发布

交付：

- Tool、共有事件、Command、会话/模型/工具 actions、event bus、resource/sourceInfo 映射；
- Pi `prepareArguments/promptSnippet/promptGuidelines` 到 native Tool contract；
- Pi 状态事件到 native fact event 的投影；
- 配置型 Provider 字段交集到 native Provider contribution；
- 仅 `notify/select/confirm/input` 到 native Interaction Port；
- 非 TUI corpus、差分 trace 和 compatibility report。

退出条件：MVP corpus 在目标 host 矩阵达到事先设定阈值，所有 adaptation/exclusion 可解释；不以跳过 fixture 计算通过率。Pi TUI、parallel Tool、完整 Provider 和请求拦截不属于后续自然阶段，如未来需要必须重新立项。

## 每阶段质量门禁

生产代码阶段遵循仓库质量门禁：

```powershell
bun run check:quick
bunx vitest --run <directly-related-test-file>
bun run test:changed     # 涉及多个可测包或影响范围不明确
bun run check            # 一轮代码任务完成后
```

同时必须运行 package boundary 和 coding-agent architecture 检查所覆盖的根脚本，不能通过新增 ignore 放行 `pi-compat` 反向依赖。

本方案文档本身只要求链接、路径、命令和事实核对；开始实现后，不能用 `bun run check` 代替定向行为测试，也不能使用真实付费 Provider 作为默认测试。

## 发布与回退

- 初始功能开关默认 `off`，profile id 写入诊断和 session metadata；
- 不把兼容 profile 与 Vetta package version 隐式绑定；
- profile 升级先生成 corpus 差异，再以独立变更发布；
- catalog transaction 保留上一可用 generation，加载失败自动回退；
- 删除/禁用 compat 只移除其 owner contribution，不影响 native Extension；
- 若 Schema/runtime 回归，能关闭 profile 而不迁移用户 session 数据。

## Definition of Done

一个阶段只有同时满足以下条件才完成：

- 模块和公共合同符合目标依赖方向；
- 所有新边界有成功与失败测试；
- compatibility report 能解释每个不兼容项；
- 动态资源有明确 owner 和 teardown；
- 文档列出当前 profile、host matrix 和已知 adaptation；
- 定向测试、适用质量检查真实运行并记录结果；
- 未运行的高成本或真实 Provider 验证被明确列为剩余风险。
