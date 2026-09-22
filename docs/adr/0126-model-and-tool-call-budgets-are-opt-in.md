# ADR-0126：模型与工具调用次数预算改为显式配置

## 状态

已接受

## 背景

Agent Runtime 原先为每个回合默认设置 100 次模型调用和 1000 次工具调用上限。长时间自主任务即使持续正常地产生结果，也会在达到任一累计阈值时以 `max_model_calls` 或 `max_tool_calls` 终止；用户看到的是一次 Runtime 失败，而不是模型、工具或 Provider 的实际错误。

固定次数不能准确区分失控循环和合法长任务。Provider 错误恢复仍需要独立预算，checkpoint 也必须有 timeout，不能因为取消正常调用上限而变成无限重试或永久等待。

## 决策

1. Runtime 和兼容 Agent Loop 不再提供默认 `maxModelCalls` 或 `maxToolCalls`；未配置时，正常调用可以继续到自然完成、恢复预算耗尽、外部取消或截止时间到达。
2. `maxModelCalls` 和 `maxToolCalls` 继续作为可选的正安全整数配置。显式设置后，原有的 `max_model_calls`、`max_tool_calls` 终态和兼容 Agent Loop 的 `AgentLoopLimitError` 行为保持不变。
3. checkpoint timeout 继续默认为 300 秒。
4. Runtime 默认 `maxRecoveryAttempts` 继续为 100。显式设置 `maxModelCalls` 时，沿用原有行为，将相同数值作为恢复预算；因此取消正常调用上限不会取消 Provider 错误恢复保护。
5. `AgentRunLimits.maxModelCalls` 和 `AgentRunLimits.maxToolCalls` 改为可选字段。这是兼容性放宽：已有调用方传入数值时语义不变，省略字段才获得新行为。

## 备选方案

- 将默认值提高到更大的固定值：只能推迟相同故障，仍会让合法的更长任务在与任务复杂度无关的阈值上中断。
- 仅取消模型调用上限、保留工具调用上限：工具密集型的合法任务仍会遇到相同问题，且阈值同样无法判断工具调用是否失控。
- 仅靠全局 deadline：不同宿主和任务对时长要求不同，短时间内的高频调用也未必应该失败；deadline 适合作为宿主按场景选择的附加保护。
- 把默认值做成桌面设置：增加产品配置和迁移面，但仍需要选择会误伤部分任务的全局默认值；有明确需求的宿主可以直接使用现有调用上限配置。

## 后果与边界

长任务不会再因累计到 100 次模型调用或 1000 次工具调用而中断，CPA 等兼容 Provider 不需要特殊路径。已有显式预算的宿主行为不变，Provider 错误恢复仍然有限。

异常模型可能持续调用工具或只请求 continuation，直到用户取消或宿主 deadline 生效。这会增加潜在执行时间、模型费用和工具副作用次数；权限审批、工具策略和取消语义仍逐次生效。需要硬性成本、调用次数或时长边界的宿主应显式配置 `maxModelCalls`、`maxToolCalls`、`deadlineMs` 或其组合。

验证覆盖默认超过 100 次模型调用和 1000 次工具调用后成功完成、显式模型/工具调用预算仍会中止，以及错误恢复与取消路径回归。
