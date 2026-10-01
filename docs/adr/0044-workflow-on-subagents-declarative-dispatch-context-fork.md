# 工作流建立在 subagent 之上：声明式派遣 + 上下文快照 fork

需要让主会话 Agent 把复杂任务拆给 N 个并行子任务（「工作流」）协同完成。调研了两个业界实现：pi-dynamic-workflows 与 Claude Code——两者的并行编排都**建立在已有 subagent 机制之上**（pi 用确定性 JS 编排脚本驱动 `agent()`/`parallel()` 派子代理；Claude Code 的 worktree 只是 subagent 的一个隔离选项），没有一家另起独立体系。我们随之决定：工作流实现为现有 SubagentCoordinator 体系下的一种新 subagent 类型，不新建第二套并行机制。

## 决策

1. **声明式派遣，不做脚本编排引擎。** 主会话用一个批量派遣工具（工作流名 + todo 列表 × N）一次接单；协调器内部排队（同时运行数受 `maxConcurrent` 约束，超出挂 pending 自动补位），拒绝 pi 式「Agent 写 JS 编排脚本在 VM 沙箱里跑」的方案——能力更强但需要沙箱/确定性/重放整套基建，且 todo 进度这类结构化 UI 难以从脚本中提取。
2. **上下文快照 fork。** 工作流出生时一次性复制主会话当前分支的完整消息历史作为初始上下文，此后各自独立演进。这**推翻**了 `docs/agent/astravia/README.md` 结论第 5 条「subagent 首版不做上下文 fork」——工作流承接的是主会话正在讨论的任务本身，没有背景认知就要求主会话把任务描述写到自包含，实践中做不到；代价是 N 倍 token 开销与长会话下的出生即近上限（需配合压缩）。**explorer 类型不变**，仍只拿任务描述。
3. **todo 起手，预填不锁定。** 派遣时把 todo 预填进工作流自己的 TodoStore；工作流可自行追加/拆分（进度分母可变）。因此进度只用于展示，「完成」判定沿用协调器既有的 agent_end 语义，不以 todo 全 done 为准（避免卸不掉的 todo 导致自续烧 token）。
4. **完全单层 + 共享 cwd（首版）。** 工作流内部不能再派遣任何代理（含 explorer）；不做 worktree 隔离，靠主会话拆分互不重叠的任务范围避免文件冲突。worktree 合并回流是一整套新问题（谁 merge、冲突谁解、非 git 项目），留二期。
5. **每完成一个唤醒一次主会话**（沿用 subagent_notification 既有语义），主会话可边收边纠偏/补派；派遣后主会话不阻塞，用户随时可与主会话对话或要求断开某个工作流。

## 后果

- UI 侧新增：MessageList footer 的工作流 items、活动面板 workflow 标签卡（内部切换 + 只读 1:1 MessageList）；background-tasks 标签卡职责不变（后台 bash + explorer），工作流不在其中重复出现。
- `docs/agent/astravia/README.md` 第 5 条对「工作流类型」失效，对 explorer 仍有效。
- 术语定义见根 CONTEXT.md：工作流、派遣、上下文快照 fork、工作流进度、工作流 items、工作流标签卡。
