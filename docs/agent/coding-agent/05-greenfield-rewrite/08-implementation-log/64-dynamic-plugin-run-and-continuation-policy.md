# 第 64 轮：动态 Plugin Run Orchestrator 与 Continuation Policy

## 目标

第 62 轮明确保留了两个缺口：

1. 动态 Plugin System Prompt Provider 及其 Prompt、Tool、Continuation effect 尚未进入
   Greenfield 模型调用边界。
2. Runtime Core 没有业务无关的自然停止续跑合同。

本轮迁移现有 Plugin Provider 和 Continuation 的运行语义，不重构 Plugin 业务协议，不切换旧生产
入口，也不迁移 Todo 与 Stop Hook。

## 既有行为基线

旧 AgentSession 的关键时序是：

```text
System Prompt Provider（每次 Agent Run 一次）
  -> Prompt / Tool effect 在当前 Run 生效
  -> requestContinuation 进入请求队列
  -> Agent 自然停止
  -> requested continuation 优先
  -> Plugin Continuation Provider
  -> 自动消息进入普通 follow-up 队列
  -> 继续模型调用
```

必须保留的细节：

- Provider 按 `pluginId + providerId` 稳定排序。
- 单个 Provider 超时或失败只隔离自己。
- Prompt Provider 在同一 Run 内只调用一次，其 effect 在后续模型调用重放。
- Continuation Provider 的 effect 延迟到下一次 Run。
- `requestContinuation` 先于 Continuation Provider。
- 续跑上限为 8，幂等键在 Session 生命周期内去重。
- 自动续跑不绕过用户 follow-up 队列；用户已排队的 follow-up 保持在前。
- `all / one-at-a-time` 仍由原队列决定一次交付多少消息。

## 实施内容

### 1. Runtime Core 的单一 Continuation Policy

新增 Profile 独占的通用合同：

```text
ContinuationPolicy.collect({
  sessionId,
  turnId,
  signal,
  messages,
  modelBinding
}) -> UserMessage[]
```

Kernel 不包含 Plugin、Todo 或 Hook 类型。Feature 也不能贡献多个 Policy；一个 Profile 最多绑定一个
最终策略，产品层负责内部优先级。

Agent Loop 的 continuation 回调现在接收自然停止时的完整消息视图和取消信号。Runtime Core 调用
Policy 后，不直接把结果交给模型，而是追加到现有 follow-up 队列，再按原队列模式取出。因此：

```text
已有用户 follow-up
  -> Policy 自动消息
  -> takeFollowUps(all | one-at-a-time)
```

错误或取消终态仍不会消费 follow-up。

### 2. Session 独占 Plugin Run Orchestrator

新增 `CodingAgentPluginRunOrchestrator`，由 CLI Greenfield Composition Root 为每个 Session 单独创建。
它持有：

- 当前 Turn 的 Run Index。
- Prompt effect 和 Tool effect 重放序列。
- requested continuation 队列。
- 下一 Turn 生效的 pending effects。
- Session 级 continuation 幂等键。
- 当前 Turn 的续跑次数。

模型调用 Composer 先构建统一 `SystemPromptDraft`，再把 Draft、候选工具和完整可用工具目录交给
Orchestrator。Orchestrator：

- 第一次调用时按稳定顺序执行动态 Prompt Provider。
- 依据 Provider 请求裁剪或补充当前工具 Frame。
- 把 Prompt operation 应用到统一 Draft，而不是另建字符串通道。
- 后续同 Turn 模型调用不重复调用 Provider，只在最新基础 Frame 上重放已提交 effect。
- 向 Session State 投影 Plugin effect 后的实际工具名。

完整工具目录使用 Runtime Tools Catalog 的受保护 Tool Definition。Plugin 可以启用当前 Scope
未选中的注册工具，但执行仍经过 Catalog binding 和撤销检查，不绕过运行时安全边界。

### 3. TypeBox 运行时边界

Plugin bridge 的 TypeScript 类型不能保证进程外或动态 Plugin 的真实返回值。新增 TypeBox 校验：

- System Prompt Provider 返回的 `AgentPluginRuntimeEffect[]`。
- Continuation Provider 返回的 `{ value, effects }`。
- Prompt Block、Patch、Tool 开关和 Continuation Result 的字段与联合分支。

非法返回值被视为当前 Provider 失败，走既有失败隔离；不会把未校验对象写入 Prompt Draft、工具
选择或 pending effects。

### 4. CLI Greenfield 生产组合

`createGreenfieldRuntimeComposition()` 新增 Session 工厂入口 `createPluginRuntime`，用于绑定：

- 动态读取当前 Plugin 配置。
- System Prompt Provider 调用 bridge。
- Continuation Provider 调用 bridge。

同一 Plugin 配置源同时进入默认 Session Prompt Runtime 和动态 Orchestrator。Composition Root 只
负责装配，不解析 Prompt operation 或续跑优先级。

CLI Vitest 另外补齐 `@vetta/agent-core` 的 workspace 源码映射。此前该测试入口会读取旧 `dist`
声明/实现，无法真实覆盖本轮新增的 continuation 回调消息参数。

## 测试

### Agent Loop

```text
bunx vitest --run test/agent-loop.test.ts
```

结果：`9 passed`。

覆盖 continuation 回调取得包含最终 Assistant Message 的完整上下文和原取消信号。

### Runtime Core

```text
bunx vitest --run \
  test/kernel/session-input-queue.test.ts \
  test/kernel/agent-core-turn-engine.test.ts
```

结果：`12 passed`。

覆盖：

- Policy 消息追加到普通 follow-up 队列。
- 用户 follow-up 先于自动续跑。
- `one-at-a-time` 下两者分两次自然停止交付。
- Policy 可见当前完整消息。
- 错误终态不消费 follow-up。

### Coding Agent

```text
bunx vitest --run test/runtime-core/greenfield-plugin-run-orchestrator.test.ts
```

结果：`2 passed`。

覆盖：

- Provider 稳定排序和每 Turn 只执行一次。
- Prompt / Tool effect 同 Turn 重放。
- requested continuation 优先和次数上限。
- Continuation effect 下一 Turn 生效。
- 幂等去重。
- TypeBox 非法结果失败隔离。

### CLI 端到端

```text
bunx vitest --run test/greenfield-plugin-runtime.test.ts
```

结果：`1 passed`。

覆盖真实 Greenfield Session 中：

- 动态 Prompt Block 进入模型 System Prompt。
- 未在初始显式名单中的注册工具由 effect 启用。
- requested continuation 触发第二次模型调用。
- Provider 同一 Turn 不重复执行。
- 自动 User Message 持久化。
- Session State 反映 effect 后工具集合。

### 质量门禁

```text
bun run check:quick
bun run check
```

结果：全部通过。完整门禁明确执行了根类型检查、CLI 独立 `typecheck`、Desktop、Admin、Biome 和
质量 guards。

## 明确未实施

- Plugin Tool Contribution 的 Greenfield 注册与调用 bridge。
- Plugin 动态发现、安装、卸载和宿主热更新入口。
- Todo Continuation 与 Stop Hook 到单一产品 Continuation Policy 的最终优先级编排。
- 旧 RuntimeHost / AgentSession 默认入口切换。
- Plugin Provider 的观察事件合同；本轮只提供可注入失败回调。

## 下一步

下一阶段应把 Todo、Plugin、Stop Hook 三类既有自然停止行为收敛到一个 Coding Agent
Continuation Orchestrator，并用差分测试锁定：

```text
User follow-up
-> Todo
-> Plugin
-> Stop Hook
```

随后再迁移 Plugin Tool Contribution；两者不要在同一阶段混合，以免同时改变续跑时序和工具执行
边界。
