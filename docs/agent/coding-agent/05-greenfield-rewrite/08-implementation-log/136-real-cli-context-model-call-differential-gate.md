# 第 136 轮：真实 CLI 调用上下文差分门禁

## 目标

以真实 Vetta RPC CLI 进程作为验收入口，用同一组 Extension、设置和 Provider fixture 分别驱动
Legacy 与 Greenfield，验证第 135 轮建立的无损消息身份与最终模型消息边界没有改变既有功能。
测试必须覆盖工具循环、自动压缩、跨进程恢复和运行期图片设置，而不是只验证进程内 Adapter。

## 差分门禁设计

新增三个彼此独立的真实 CLI 场景：

1. **Extension `context` 与 Tool Loop**
   - Extension 把每次收到的完整 `AgentMessage[]` 写入 JSONL 观察文件；
   - 同一 Turn 发生一次工具调用和两次 Provider 调用；
   - 比较 Legacy 与 Greenfield 的消息身份、事件次数和最终 Provider 输入；
   - 确认 transient context 变换只影响当次调用，不写回会话历史。
2. **自动压缩与进程恢复**
   - 使用极小 `keepRecentTokens` 触发真实摘要调用和压缩提交；
   - 关闭 CLI 进程后从落盘 session 恢复，再继续一次 Turn；
   - 比较压缩摘要身份、保留尾部边界以及恢复后的最终 Provider 输入。
3. **运行期图片设置**
   - 会话运行中修改 `settings.json` 的图片预算与屏蔽设置；
   - 下一次模型调用必须读取新设置并在 Provider 最终边界生效；
   - 历史中的原图片仍需保留，设置变化不得改写持久化消息。

测试直接启动仓库提供的 RPC CLI fixture，不绕过 Host Bootstrap、Extension Loader、SettingsManager、
Session Store 或 Runtime Selector。每个后端使用独立目录和进程，避免共享状态掩盖差异。

## 实施与修正

### 1. 固定压缩切点来源，分离最新提交文档

真实 CLI 揭示了一个进程内单测没有覆盖的差异：Legacy 在 Turn 进入时的稳定分支上计算自动压缩
切点，但在包含当前输入的最新分支上提交和投影压缩结果；Greenfield 原先两步都使用最新分支，
因此会错误地把当前用户输入纳入切点计算。

`ContextPreparationInput` 新增可选 `compactionSourceDocument`：

- `document` 始终表示准备发生时已持久化的最新文档，用于提交和最终投影；
- `compactionSourceDocument` 只表示稳定的压缩切点计算来源；
- Turn Pipeline 仅在 `model_call` 检查点传入 Turn admission document；
- `assistant_result`、`assistant_error` 和手动压缩继续使用最新文档。

该合同只表达时间边界，不包含 Coding Agent 的压缩算法或 SessionManager 类型。

### 2. 保留等价消息表达的产品身份

Legacy 存储可把用户纯文本表示为字符串，而 Coding Agent 产品投影会恢复为单个 text block。两种
表示对 Provider 等价，但原身份协调按 JSON 严格比较会把它们视为不同消息，从而丢失 Extension
需要的产品身份。

Runtime Core 现在仅在身份协调比较时规范化这两种等价表示；时间戳和其他字段仍参与比较，持久化
对象与 Provider 输入均不被改写。新增单元测试同时验证等价表示会复用 opaque identity，而不同
时间戳不会被错误合并。

### 3. 修正压缩摘要的双时间戳身份

原生 compaction event 的提交时间与其中 `summaryMessage` 的消息时间可能相差 1ms。产品身份应保留
compaction event 的时间戳，但 Provider 必须复用持久化的 `summaryMessage`，否则恢复后差分会产生
仅时间戳不同的新消息。

Coding Agent Projector 现在明确分离：

- opaque identity 使用产品 compaction message；
- model projection 使用 `source.summaryMessage`；
- 模型不可见 Custom Message 只保留 identity；
- 标准消息继续保持原标准身份。

### 4. 补齐 CLI 动态压缩设置接线

Greenfield IM Runtime Host 原先没有把 `SettingsManager.getCompactionSettings()` 注入 Composition
Root，导致真实 CLI 使用 Greenfield 默认值而不是会话设置。现在通过 resolver 逐次读取动态设置，
运行期变化影响后续检查点，不创建长期设置快照，也不把 SettingsManager 下沉到 Runtime Core。

### 5. 修正独立 CLI 产物的 Extension 加载

真实独立 CLI fixture 没有相邻 `node_modules` 时，Jiti alias 解析会在加载显式 Extension 前失败。
Loader 现在始终提供已打包的公共 Extension virtual modules，并只在本地依赖确实可解析时附加
alias。开发态、独立 bundle 和编译二进制继续共享同一 Extension API，不复制 TypeBox 实现。

### 6. 同步宿主回退基线

Greenfield Host 组合测试仍把已迁移的 `agent_end` 当作不支持事件，因而错误期待 Legacy fallback。
该基线改用尚未迁移的 Extension Command 注册验证能力回退：`agent_end` 继续走 Greenfield 无损
观察合同，Command 仍明确返回 `legacy-extension`，没有放宽实际回退守卫。

## Schema 判断

本轮没有新增 Zod 或 TypeBox Schema：

- RPC 外部帧继续由现有 TypeBox 边界校验；
- Provider fixture 输入继续使用现有 Zod 校验；
- Conversation Document 继续由 runtime-storage 的 TypeBox Schema 校验；
- Extension 观察 JSONL 只存在于测试进程，读取后使用窄类型守卫，不形成新的产品协议。

新增 Schema 会重复现有外部边界，不能改善同进程消息身份协调。若未来将 Extension 观察日志或
Runtime Envelope 暴露为正式跨进程协议，再在该协议入口建立独立 Schema。

## 测试

定向验证结果：

- CLI 真实 Legacy/Greenfield 差分：1 个文件、9 个测试通过；
- Greenfield IM Runtime Host 组合：1 个文件、8 个测试通过；
- Runtime Core 身份协调与 Turn Pipeline：2 个文件、18 个测试通过；
- Coding Agent 上下文、压缩、Extension 与恢复：5 个文件、46 个测试通过；
- 根 `bun run check:quick` 通过；
- 根 `bun run check` 通过，覆盖 Biome、全仓 tsgo、CLI 独立类型检查、Desktop/Admin 类型检查和质量守卫。

门禁明确验证：

- `context` 每次 Provider 调用恰好执行一次，并保持 Tool Loop 次数；
- transient 变换不污染持久化历史；
- `context -> compaction -> image finalizer -> provider` 顺序与 Legacy 一致；
- 压缩使用稳定切点、对最新分支提交，进程恢复后身份和 Provider 输入一致；
- 图片设置在运行期变化后于下一次调用生效，历史图片不被改写；
- 独立 CLI 产物可加载使用公共 Extension 模块的真实 `.ts` Extension。

## 明确未修改

- 没有修改 Extension handler 的业务行为、顺序或异常隔离。
- 没有修改自动压缩、microcompact、图片预算或图片屏蔽算法。
- 没有修改 Conversation Document 或 Legacy JSONL 持久化格式。
- 没有把 SettingsManager、AgentMessage 或 Extension 类型引入 Runtime Core。
- 没有通过放宽断言掩盖新旧差异；所有 Provider 输入仍做精确比较。

## 结果与下一步

第 135 轮建立的上下文边界已由真实 CLI 进程闭环验证。差分过程中暴露的问题均属于架构接线、
身份协调或时间边界错误，修正后 Legacy 与 Greenfield 在上述三类场景中完全一致。

下一阶段应把这组真实 CLI 差分纳入稳定的切换门禁，并继续审计仍触发 Legacy fallback 的最后一批
Extension 能力；只有具备同等级真实宿主证据的能力才移除回退，不能以 Adapter 单测替代切换验收。
