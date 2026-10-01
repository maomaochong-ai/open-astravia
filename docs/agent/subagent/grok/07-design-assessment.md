# 07 — 设计评估与使用建议

## 1. 系统如何推动「高效协作并完成任务」

Grok Build 不提供自动 DAG 调度器，但通过以下机制让主/子协作在实践中高效：

### 1.1 上下文卸载

- 子 Agent 独立 context window → 主 Agent 保留「战略上下文」  
- 返回摘要 + meta，而不是整段工具轨迹灌回主窗口  
- resume 把「战术上下文」留在子 transcript 里跨阶段复用  

### 1.2 真并行

- 多 `spawn_local` + 默认 `background=true`  
- 主可边改代码边让多个 explore 跑  
- auto-wake 在空闲时把完成事件变回可行动 turn  

### 1.3 工具面统一

- bash 后台任务与 subagent 共用 get/kill/wait 命名  
- 降低模型「另一套生命周期 API」的认知成本  

### 1.4 安全阀

- depth=1 防递归爆炸  
- capability_mode / 只读类型减破坏面  
- worktree 隔离实验性改动  
- toggle / disallowed-tools 运营控制  

### 1.5 目标层（Goal）

- Goal loop 与 auto-wake 互斥，避免双驱动  
- harness 子 Agent 可隐藏 surface，不污染主模型 tool 视野  
- classifier/summarizer 用同一 spawn 栈，实现验收闭环  

### 1.6 可观测

- ACP 事件、TUI tasks pane、meta 落盘、usage fold、telemetry  
- 人能看、账单能算、失败可追  

## 2. 设计优点

| 优点 | 体现 |
|---|---|
| 边界清晰 | Tool / Backend / Coordinator / Session 分层 |
| 可测试解析 | `xai-grok-subagent-resolution` 无 IO 会话依赖 |
| 资源复用 | fs/terminal/MCP/hooks 共享，启动轻 |
| 产品命名友好 | spawn_subagent 等改名 |
| 失败降级务实 | worktree 失败→共享树；未知 model→父 model |
| 双重 depth 保险 | TaskTool 拒绝 + 子 toolset 剥 Task |
| 完成交付冗余 | tool result / auto-wake / reminder 三路径 |
| 前台不卡死 | await 预算耗尽 auto-background |

## 3. 设计代价与局限

| 局限 | 影响 |
|---|---|
| 无兄弟 mailbox | 并行结果必须由主汇总，不能子↔子协商 |
| 深度 1 | 无法「子 orchestrator 再拆多层」；复杂树要主自己编排 |
| 无硬并发配额 | 模型可能过度 spawn 打满 API |
| prompt 质量依赖模型 | 未写入 prompt 的父上下文会丢 |
| completed 30min TTL | 长时间后无法 resume |
| MCP snapshot 时机 | spawn 后父新增 MCP 子不可见 |
| capability 白名单含 Task | 依赖后续 depth 剥离；读代码易误解 |
| 子 Agent 非强沙箱 | worktree ≠ 完整安全隔离 |
| Goal 与通用 auto-wake 交互复杂 | 需仔细读门闩条件，否则调不通「完成却不醒」 |

## 4. 与 Codex 方案的取舍对照

| 维度 | Grok Build | Codex（`docs/agent`） |
|---|---|---|
| 拓扑 | 星型、depth 1 | 树、可多层 |
| 通信 | 专用事件 + 完成推送 | Mailbox + 绝对路径 |
| 复杂度 | 较低，适合 CLI 主从 | 较高，适合通用 multi-agent |
| 身份 | UUID | 路径 + 昵称 |
| 配额 | 基本无硬顶 | registry reservation |
| 角色 | agent type + persona | role 系统 |

Grok 的选择与 **CLI 编码助手** 场景一致：主 Agent 对用户负责，子 Agent 是可并行的专业工人，而不是对等社会。

## 5. 正确使用模式

### 适合

- 大范围 codebase 探索（多个 explore 并行）  
- 长测试 / 构建与实现并行（background general-purpose）  
- 实现前只读 plan  
- worktree 上做有风险的大批量编辑  
- resume 做「研究后实现」两段式  
- Goal 模式下主循环 + 隐藏验收子 Agent  

### 不适合

- 需要用户逐步确认的 UX 设计讨论  
- 子任务强依赖另一子任务中间状态且主不汇总  
- 极短任务（spawn 开销 > 收益）  
- 假设子能看见父刚说的未写入 prompt 的细节  

### 写 prompt 的检查表

1. 目标与成功标准是否写清？  
2. 关键路径 / 命令 / 约束是否完整？  
3. 是否选对 type（explore vs general-purpose）？  
4. 是否需要 worktree / capability 收紧？  
5. 是否 background，汇合点如何 wait？  
6. 是否计划 resume，而非重复贴长上下文？  

## 6. 移植或自研时的可借鉴点

若 astravia-mono 等项目要对齐类似能力，建议优先吸收：

1. **SpawnContext 参数袋** — 避免子模块依赖巨型 Agent 结构  
2. **Backend trait** — 工具层与进程内/远程 spawn 解耦  
3. **三态 coordinator + TTL** — pending/active/completed  
4. **完成交付三路径** — 同步 result、合成 wake、reminder  
5. **depth 硬顶 + tool 剥离双重保险**  
6. **前台/后台取消语义分离**  
7. **解析逻辑独立 crate** — role/persona 纯函数可单测  

需谨慎照搬：

- LocalSet + RefCell 模型绑定单线程宿主  
- goal 与 auto-wake 交叉门闩（产品特定）  
- 与 ACP / TUI 深度耦合的通知形状  

## 7. 关键源码「阅读地图」

建议按此顺序读仓库：

1. `xai-tool-types/src/task.rs` — 契约与 builtin 文案  
2. `xai-grok-tools/.../task/mod.rs` + `backend.rs` + `types.rs` — 工具与协议  
3. `xai-grok-shell/.../mvp_agent/subagent_coordinator.rs` — 事件循环  
4. `xai-grok-shell/.../subagent/mod.rs` — 状态与 auto-wake  
5. `.../handle_request.rs` — 完整 spawn 流水线  
6. `xai-grok-subagent-resolution` — 配置叠加  
7. `xai-grok-agent/src/config.rs` 改名与 orchestrator 文案  
8. `xai-grok-pager/docs/user-guide/16-subagents.md` — 产品语义校准  

测试入口：

- `xai-grok-shell/src/agent/subagent/tests/`  
- `mvp_agent/tests/subagent_spawn_context_tests.rs`  
- `xai-grok-tools` 中 task / reminder 单测  
- goal 相关：`session/acp_session_tests/goal/`  

## 8. 总评

Grok Build 的 subagent 体系是一套 **主从星型、深度封顶、会话同构、资源共享、结果多路回传** 的工程设计。

- **主 Agent**：对用户与目标负责，决定拆分与验收策略。  
- **子 Agent**：在独立上下文中执行切片任务，受 type/capability/isolation 约束。  
- **Coordinator**：登记生命周期，提供 query/cancel/completion，折算用量。  
- **Goal / Persona / Worktree / Resume**：在通用 spawn 之上叠加「对准目标、行为整形、改动隔离、阶段衔接」。  

高效协作的关键不在「更智能的运行时调度」，而在：

1. 把正确的任务规格写进子 prompt  
2. 用类型与隔离控制风险  
3. 用并行 + auto-wake/wait 控制延迟  
4. 用主会话（及 Goal）做最终汇总与交付  

运行时保证的是 **可靠的工人生命周期**；**语义正确性**仍由模型、项目指令与人类监督共同完成。

---

## 文档集结束

返回索引：[README.md](README.md)
