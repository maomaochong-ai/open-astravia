# 第 88 轮：RuntimeHost Plugin 与用户提问能力接线

## 1. 本轮目标

第 87 轮已让 Desktop Candidate 真实经过 RuntimeHost，但 RuntimeHost 提供的 Plugin 与
Ask User Question 宿主能力仍被 Greenfield Backend 拒绝。本轮补齐这组宿主能力：

1. 将 RuntimeHost 的 Plugin 配置和三个 invoker 映射到既有 Greenfield Plugin Runtime。
2. 将 Ask User Question 作为模型调用级动态工具接入，保留既有工具合同。
3. 允许能力在 Session 存活期间动态移除，并在下一次模型调用时生效。
4. 对两种 Plugin Runtime 来源同时存在的情况 fail-closed。
5. 让 Desktop Candidate 能通过真实 RuntimeHost 配置并验证这些能力。

## 2. 架构结论

Plugin 与用户提问不是 Kernel 内部状态，也不应编译进不可变的 Session 快照。它们是由宿主
提供、由 Session 编排的动态能力：

```text
Desktop / other host
  └─ RuntimeHost stable capability ports
      └─ GreenfieldRuntimeHostSessionBackend
          └─ Greenfield session options
              ├─ existing Plugin Run / Tool / Continuation orchestrators
              └─ ModelCallContributionProvider
                  └─ existing ask_user_question tool
```

RuntimeHost 负责稳定的宿主能力端口和运行期重绑定；Greenfield Backend 只做参数适配；
Plugin Orchestrator 与 Model Call Contribution Provider 在每次需要时读取当前能力。内核不依赖
Desktop、IPC 或某个具体插件实现。

## 3. Plugin Runtime 映射

Greenfield Session options 新增并接收：

- `agentPlugins`
- `invokePluginTool`
- `invokePluginContinuation`
- `invokePluginSystemPrompt`

这些字段被组合为既有 `CodingAgentPluginRuntimeSource`，继续复用已经验证的：

- 动态系统提示词贡献；
- 动态工具注册与执行；
- Plugin effect；
- continuation 编排；
- 会话级 Plugin 配置读取。

本轮没有复制 Plugin 执行器，也没有建立第二套 Plugin 状态。

Greenfield Composition 仍允许外围直接提供 `createPluginRuntime`，用于非 RuntimeHost 入口。
如果一个 Session 同时收到 RuntimeHost Plugin capabilities 和 `createPluginRuntime`，创建过程直接
失败，避免其中一套来源被静默覆盖。

## 4. Ask User Question 动态工具

新增的 Runtime Feature 复用既有 `createAskUserQuestionTool()`，因此以下行为保持不变：

- 工具名与描述；
- TypeBox 参数 Schema；
- 参数校验；
- 用户取消和回答结果格式；
- conversation/project 场景限制；
- 宿主 handler 的实际调用方式。

Feature 通过 `ModelCallContributionProvider` 在每次模型调用前检查 capability 是否仍然启用。
因此 RuntimeHost 在 Session 运行期移除用户提问 handler 后：

- 当前已经物化的模型调用不被中途篡改；
- 下一次模型调用不再暴露 `ask_user_question`；
- Session 状态投影同步反映工具已移除；
- 不需要重建整个 Session 或静态能力快照。

## 5. Desktop Candidate

Desktop Greenfield Candidate 新增独立的宿主选项：

- `serverUrl`
- `userQuestionHandler`
- 三个 Plugin invoker

这些选项只负责配置 RuntimeHost。会话创建选项继续负责 `agentPlugins`、
`enableAgentPlugins` 和 `askUserQuestion`。两类配置没有混入 Greenfield Composition 的固定配置。

Candidate 测试通过真实 RuntimeHost 验证用户提问工具进入活动工具面。Desktop 生产默认 Backend
仍未切换，本轮不改变产品入口选择策略。

## 6. 测试

本轮测试覆盖：

1. Plugin 系统提示词、工具与 continuation 通过真实 RuntimeHost 执行。
2. Session 运行期移除 Plugin 配置后，下一 Turn 不再调用 Plugin 能力。
3. Ask User Question 调用既有 handler，并返回既有结果格式。
4. 运行期移除用户提问 handler 后，下一 Turn 不再暴露工具。
5. Session 状态投影与动态工具面保持一致。
6. RuntimeHost Plugin capabilities 与 `createPluginRuntime` 冲突时创建失败。
7. `serverUrl` 仍执行组合一致性校验。
8. Desktop Candidate 能配置 Plugin/用户提问宿主端口并完成创建、释放和恢复。
9. 既有 Plugin prompt、tool、continuation 测试在关闭无关 Subagent feature 后继续通过。

## 7. 明确未修改

- 没有修改工具名称、描述、Schema 或执行结果。
- 没有将 Plugin 或用户提问能力固化进 Turn 级快照。
- 没有为缺失宿主 handler 提供伪实现或 no-op。
- 没有修改 Desktop 生产默认 Backend。
- 没有删除 Legacy Plugin、Session 或持久化支持。
- 没有实现 Subagent 进程重启恢复。

## 8. 下一步

下一阶段进入 Subagent 持久化与恢复，作为一个完整阶段实施：

1. 在父 Session 的原生自定义条目中持久化可重建的 Subagent 索引、generation 和通知消费标记。
2. 恢复时只信任父 Session 明确记录的 ownership，不扫描目录猜测子会话。
3. 将重启前的 queued/running 状态确定性归一为 interrupted，并保留已有终态。
4. 对缺失、损坏或被用户删除的子会话执行可观察的降级，不伪造运行状态。
5. 验证恢复后的 `list_agents`、`wait_agent`、`followup_task`、`interrupt_agent` 与通知去重。

完成后再评估 Desktop 显式 Greenfield opt-in，不提前切换生产默认实现。
