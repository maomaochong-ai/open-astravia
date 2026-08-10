# 差距与采纳路线

## 决策原则

1. **迁移语义，不迁移单体结构**：优先吸收 trust、lifecycle、source、transaction、protocol 等合同。
2. **复用 Vetta 已有 Runtime 能力**：Coding Extension 的动态工具应投影 `runtime-tools`，不要创建第二套目录。
3. **宿主无关核心不依赖具体 UI**：Desktop 和 TUI 分别适配，核心只定义能力与结构化交互。
4. **不同信任边界不能伪统一**：Skill、MCP、进程内 Extension、Renderer Plugin 的执行权限不同。
5. **每个新扩展点都回答五个问题**：来源、权限、生命周期、冲突、in-flight 行为。

## 建议路线

### P0：正确性与安全边界

#### A. 项目本地资源信任门

在加载项目本地 settings、packages、extensions 及其他可导致代码执行或扩大能力的资源前，引入宿主无关 trust decision。建议包含：

- canonical project identity，避免同一路径不同表示绕过决定；
- `unknown / trusted-once / trusted-persisted / denied` 等显式状态；
- Desktop UI、CLI 交互、SDK/IM 非交互 policy 的适配；
- Extension context 可只读查询最终决定；
- cwd/session switch 时重新按目标项目求值；
- 明确 context 文件是否在 trust 前加载，以及它们只能影响 prompt 还是也能触发副作用。

这会改变安全模型、配置加载顺序和持久化格式，应先检索现有 ADR，并新增或更新 ADR。不要把 trust 描述为沙箱。

**验收合同**：未批准项目不能加载其可执行 Extension/Package；全局/内置资源仍能决定或展示 trust；跨 cwd 不复用错误决定；非交互宿主没有隐式“总是允许”。

#### B. Extension 代际与 teardown

为每次 load/reload/session replacement 分配 generation：

- 所有 `ExtensionContext` 和 host action 在调用前校验 active generation；
- event subscription、timer、provider/tool registration 归属到 generation；
- teardown 顺序固定：停止接收事件、等待/终止 owned work、注销贡献、释放资源；
- replacement 通过 fresh `withSession`/callback 创建新 context；
- stale 调用返回可识别错误，不静默操作当前 session。

**验收合同**：reload 后旧闭包不能 prompt、注册或修改新会话；订阅不重复；部分加载失败不保留半套贡献；shutdown 可重复调用。

#### C. 动态注册可见性

统一 Coding Extension、Agent Plugin、MCP 与 Runtime tool catalog 的外部语义：

- `registerTool()` 成功后最迟在下一次 model call 可见；
- tool call 开始执行时按带版本 identity 的目录解析，旧 call 不路由到同名替换实现；
- `registerProvider()` post-bind 立即更新 model catalog；
- 增加对称 `unregisterProvider()`，恢复被覆盖 builtin 的规则必须明确；
- 若短期不支持 post-load registration，应明确拒绝，而不是接受后不生效。

**验收合同**：注册、替换、注销、reload、并发 in-flight、会话切换均有定向测试。

#### D. Package/manifest 边界校验

对 manifest 数组、package spec、git/local path 和下载产物在领域入口做 schema 校验；临时目录限制到当前用户；安装失败可回滚；路径解析后验证仍在预期根目录。不要以 catch-and-ignore 方式继续加载半有效 package。

### P1：能力与诊断一致性

#### E. 统一 ContributionSourceInfo

给 tool、command、skill、prompt、MCP server、Extension、Plugin contribution 附着结构化来源，而不是仅保留旁路 path map。通过 SDK/RPC/Desktop diagnostics 暴露经过隐私处理的同一视图。

同时定义同名冲突策略：优先级、首个/最后一个、显式 override、是否报警，以及 UI 如何展示被遮蔽项。

#### F. 扩充宿主无关 Tool 合同

优先评估：

- prompt snippet/guidelines；
- `prepareArguments`；
- sequential/parallel execution hint；
- capability/permission requirement；
- constrained sampling（仅在 `@vetta/ai` provider 合同能保持一致时）。

不要把 TUI renderer state 下沉到 `runtime-tools`。Renderer 通过宿主 adapter 消费标准 call/result/progress 数据。

#### G. Provider 拦截 Port

把 request preparation、header contribution、response observation 分为不同权限：

- 默认不可读取或覆盖认证 header；
- 明确 hook 顺序、合并规则和异常隔离；
- telemetry/export 前统一 redaction；
- Provider 替换时中止或完成 in-flight request 的规则固定；
- 记录贡献来源和审计结果。

#### H. 生命周期事件与流协议

评估补充 `agent_settled`、`session_info_changed`、thinking level change 等事件；核实 RPC `message_update.assistantMessageEvent` 是否累计 partial。若存在累计传输，新增版本化 delta 字段或新协议版本，保持旧消费者兼容。

#### I. Package manager 事务

补齐 install-and-persist、configured list、pin/reconcile、update retry、custom package command、项目/全局 delta 和安全临时目录。Package 配置修改与磁盘安装需要一致的失败恢复策略。

### P2：统一作者模型与长期演进

#### J. 扩展分类与 Contribution Catalog

建立全局文档和可查询 catalog，至少统一：

- contribution type 与 owning runtime；
- source/trust/permission；
- host coverage；
- priority/conflict；
- generation/revision；
- health/error/disabled reason。

这不是把所有 API 合并，而是让不同执行边界使用同一治理语言。

#### K. 拆分 host-neutral Extension 与 TUI

保留 `@vetta/coding-agent/extensions` 的事件、工具、Provider、结构化 UI request；把 terminal `Component`、editor/header/footer 等放到显式 TUI subpath。Desktop UI 继续使用 Plugin SDK，不在 Coding Extension 中复制 React/Renderer 权限面。

这是公共 API 变化，需要兼容层、deprecation 窗口和 consumer 清单。

#### L. 跨宿主一致性测试

对同一 contribution 在 SDK、RPC、Desktop、CLI、IM 的发现、启停、错误和来源投影做 contract suite。宿主不支持的能力必须显式返回 unavailable/unsupported，不能静默丢弃。

#### M. 跟踪 AgentHarness v2

只在 Pi 上游满足以下条件后重新评审：主要 operation 不再抛 `HarnessNotImplemented`；durable storage/recovery、observer、lane 和 effect tests 完整；生产 coding-agent 至少有一条实际接入路径。

届时重点比较 Vetta `runtime-core` 的 turn/snapshot、`runtime-subagents` 的调度恢复和 Harness record/effect 模型，仍应避免并行 Agent loop。

## 推荐实施批次

| 批次 | 内容 | 依赖/风险 |
| --- | --- | --- |
| 1 | P0-B Extension generation + P0-C dynamic registration | 局部合同修复，可先不改用户配置 |
| 2 | P1-E source info + 冲突 diagnostics | 会影响 SDK/RPC 类型，需兼容字段 |
| 3 | P0-A project trust + P0-D package validation | 安全/持久化/加载顺序变化，需要 ADR 与多宿主设计 |
| 4 | P1-F/G/H tool/provider/events/protocol | Provider 敏感数据与 RPC 兼容风险较高 |
| 5 | P1-I package transaction + P2-J/K/L | 外部作者合同和公共 API 治理 |

把 generation/dynamic registration 放在 trust 前，并不是认为 trust 不重要，而是前者范围较小、能先稳定 Extension 的生命周期基础；若近期要开放项目 package/extension 给不可信仓库，则 project trust 应提升为第一个批次。

## 明确不做

- 不整体同步 Pi `coding-agent/src/core`。
- 不引入 Pi Manager/Registry 作为 Vetta 稳定 SDK 的主合同。
- 不为追平功能数量复制与 Vetta 产品无关的 TUI API。
- 不把 Plugin permission、tool sandbox 或 project trust 当成进程级代码隔离。
- 不把 Pi AgentHarness v2 scaffold 或 remote experimental package 作为生产依赖。
- 不通过放宽包边界检查来容纳上游结构。
