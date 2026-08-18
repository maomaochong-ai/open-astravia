# 3. 实施路线

## 3.1 总原则

先固定生命周期、权限和事件，再做 UI 与高级协作。每个阶段都必须可独立验证；不要先堆工具 schema，再补安全边界。

首版代码目标不是复制完整 Codex MultiAgentV2，而是让 Vetta 获得可靠的“一层并行工人”能力。

## 3.2 阶段 1：Coordinator 内核

### 改动

新增 `packages/coding-agent/src/core/subagents/`：

- `types.ts`：状态、snapshot、spawn/factory 契约；
- `coordinator.ts`：registry、reservation、状态机、wait、interrupt、dispose；
- `notifications.ts`：结果裁剪、generation 去重、批量完成缓冲；
- `persistence.ts`：child 目录和 metadata/lifecycle 扫描；
- `index.ts`：导出。

先用 fake `SubagentSessionFactory` 测 coordinator，不接真实模型。

### 验证

- 并发 spawn 不超过 3；
- 相同 task name 并发请求只有一个成功；
- 初始化失败释放 name 和 slot；
- wait 由事件唤醒，无轮询；
- dispose 后不能再 spawn，也不会通知父会话；
- completion generation 只交付一次。

## 3.3 阶段 2：真实 child session 与工具

### 改动

1. `packages/coding-agent/src/core/sdk.ts`
   - 增加 fail-closed 的 subagent 配置与可注入 factory；
   - 提供 CLI/SDK 默认 child factory；
   - 子会话显式 `subagents.enabled = false`；
   - 让 child 复用 `ModelRegistry`，避免重复远程模型加载。

2. `packages/coding-agent/src/core/agent-session.ts`
   - 持有可选 coordinator；
   - 暴露只读 `subagents` snapshot 和内部控制方法；
   - `dispose()` 先关闭 coordinator，再关闭自己的 background tasks/MCP/session lock；
   - 将 coordinator 更新映射成 `subagents_update`。

3. `packages/coding-agent/src/core/session/runtime-manager.ts`
   - coordinator 存在且 scenario 允许时注册 subagent tools；
   - 工具 category 使用已有的 `agent-control`；
   - scope 只含 `conversation`、`project`、`cli`；
   - child 的显式工具名单中不含任何 subagent 工具。

4. `packages/coding-agent/src/core/subagents/tools/*`
   - 每个工具一个文件；
   - 参数用 TypeBox；
   - handler 只做 schema 到 coordinator 的适配，不自行管理 child。

5. `packages/coding-agent/src/core/session/types.ts`
   - 增加 `subagents_update`；
   - 增加 session factory/config 类型；
   - 为 `SessionHeader` 增加可选 `subagent` 身份元数据。

6. `packages/coding-agent/src/core/session/session-manager.ts`
   - 创建 child JSONL 时把 `subagent` 身份与现有 header 一次性写入；
   - lifecycle 继续写 child 自己的 custom entry；
   - 不把 child metadata/lifecycle 写入 parent 消息树。

7. `packages/coding-agent/src/index.ts` 与 `packages/runtime-tools/src/index.ts`
   - 按包约定同步导出公共类型和工具 factory；
   - 不导出 coordinator 内部可变结构。

### 需要的小范围重构

默认 factory 需要把“共享服务”和“每会话状态”区分开：

- 可共享：`ModelRegistry`、只读配置值、agentDir/serverUrl；
- 必须独立：`Agent`、`SessionManager`、Hook runtime、background tasks、extension runner；
- 只有经过明确并发安全设计后才共享：MCP client pool、插件实例。

不要为了 subagent 把整个 `createAgentSession()` 重写。优先增加一个内部 child factory helper，复用现有参数解析和构造路径。

### 验证

- `explorer` 无写/执行工具；
- `worker` 能读写并执行一次性命令；
- child session ID、消息数组和文件锁与 parent 独立；
- child 无法 spawn child；
- 多个 spawn 工具调用返回后能真正并发运行；
- follow-up 使用原 child transcript。

## 3.4 阶段 3：权限与 Hook 闭环

### RuntimeHost factory

修改：

- `packages/runtime-core/src/runtime-host/runtime-host.ts`；
- 必要时拆出 `runtime-host/subagent-session-factory.ts`，避免继续增大主文件；
- `packages/runtime-core/src/runtime-host/types.ts`。

factory 必须：

1. 继承 parent handle 的 `executionMode`；
2. 为 child 创建新的 `sessionIdRef`；
3. 重新调用当前 sandbox/full-access 工具构造逻辑；
4. 按 `explorer/worker` 工具名白名单过滤；
5. 保留父的 server URL、model registry、env 与 scenario；
6. 不给 child 用户确认/UI 问答能力，除非未来设计专门的父转发协议；
7. 不把 child 当普通 sidebar session 注册。

### Hook

修改：

- `packages/ecosystem-adapter/src/hooks/runtime.ts`：base event 支持 `subagentContext`；
- `packages/coding-agent` child factory：创建 child Hook runtime 时传 context；
- coordinator：触发 Start/Stop 并处理 additional context、stop/block。

### 安全门

只有以下测试通过后，desktop 才能开启 `worker`：

- sandbox parent 的 child bash/edit 仍走 sandbox；
- full-access parent 的 child 才能使用 full-access；
- explorer 即使在 full-access parent 下也没有写/执行工具；
- child 没有 ask_user_question、spawn_agent 和父 session 专属 plugin closure；
- Hook 中的 session/transcript/subagent 字段属于正确 child。

## 3.5 阶段 4：协议、RPC 与 desktop 可观察性

### runtime-core

修改：

- `packages/runtime-core/src/contracts.ts`：`SubagentInfo`、`SubagentsUpdateEvent`、`SessionEvent` 联合；
- `packages/runtime-core/src/runtime-host/session-events.ts`：映射 `subagents_update`；
- `packages/runtime-core/src/index.ts`：导出类型；
- `SessionStateSnapshot` 可增加当前 child 数量或完整 snapshots，二选一，避免重复来源。

### RPC

RPC 当前直接输出 `AgentSessionEvent`，基础事件无需另造一套；补充：

- `get_state` 的轻量 subagent 摘要；
- 如宿主需要人工控制，再增加 `list_subagents`、`interrupt_subagent` 命令；
- 不在首版开放向 child transcript 写任意用户输入。

### desktop

建议把展示放入现有 `activity-panel` 领域，而不是塞进 ChatPage：

```text
apps/desktop/src/renderer/domains/activity-panel/
├── components/SubagentsPanel.tsx
├── components/SubagentRow.tsx
└── services/subagent-status.ts
```

主进程/preload 只传 runtime-core 契约。renderer 用 Jotai 的 activity/chat 相关 atom 保存当前 root 的全量 snapshot。

首版 UI：

- 列表显示 task name、type、状态、耗时；
- 支持查看最终摘要和 child transcript；
- running 支持中断；
- 不提供任意消息输入、worktree merge 或拖拽编排。

所有用户可见 label、按钮、状态、aria-label 必须加入 `zh/en` i18n catalog，不能把中文状态文案存进模块级常量。

## 3.6 阶段 5：配置与灰度

### 配置

建议配置形态：

```json
{
  "subagents": {
    "enabled": false,
    "maxConcurrent": 3
  }
}
```

低层默认关闭：

- `CreateAgentSessionOptions` 不传时不注册工具；
- CLI 主入口在实验开关开启时显式传入；
- RuntimeHost 的普通 `conversation/project` session 显式传入；
- `batch/automation/kb-processing/im-claw` 首版强制关闭，即使全局设置为开。

原因：这些宿主把 `agent_end` 当作任务完成边界，后台 child 自动唤醒可能改变队列和调度语义，必须分别设计后再放开。

### 文档与 changelog

同步修改：

- `packages/coding-agent/README.md`：删除 “No sub-agents” 结论，增加工具、限制和配置；
- `packages/coding-agent/docs/sdk.md`、`docs/rpc.md`；
- `packages/coding-agent/examples/extensions/README.md`：删除或补齐当前不存在的旧 subagent 示例引用；
- 受影响包的 `CHANGELOG.md`，仅写 `[Unreleased]`；
- desktop 用户文档/设置说明（若 UI 同期上线）。

## 3.7 首版明确不做

以下能力推迟，避免 MVP 膨胀：

- child 再 spawn child；
- 跨 child mailbox/兄弟通信；
- `fork_turns=all/N`；
- 自定义 agent definition/persona 市场；
- 模型和 reasoning override；
- 自动 git worktree、自动 merge；
- 远程/跨进程 subagent backend；
- child 向用户直接提问；
- 自动语义验收、投票或共识；
- 把 child 每个 token delta 混入 root chat stream。

这些都可以建立在 coordinator/factory/event 契约上逐步增加，不需要首版预埋抽象字段。

## 3.8 后续演进顺序

若 MVP 数据证明有需求，推荐顺序：

1. `contextMode: fresh | recent`，实现经过过滤和预算控制的最近 N turn fork；
2. worktree isolation，先只支持 Git 工作区与 worker；
3. 用户自定义 AgentDefinition（prompt + tool allowlist + model policy）；
4. MCP 连接池安全共享；
5. 多层任务树；
6. mailbox 与跨兄弟通信。

只有第 5/6 步才需要引入 Codex 风格的 canonical tree registry、深度恢复和消息数据平面。
