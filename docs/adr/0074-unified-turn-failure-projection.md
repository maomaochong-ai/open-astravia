# 统一 Turn 失败投影合同

## 背景

Provider 失败此前有两条并行路径：Provider 返回 `stopReason: "error"` 时写入 assistant 错误消息，异常路径则写入 `turn.failed`。Runtime、自动重试和 Desktop 又分别消费这两种事实，导致失败可能只存在于瞬时事件、重复渲染，或无法与具体 Turn 关联。

## 决策

新执行路径把 Provider 返回的 assistant 错误在 Turn Engine 边界转换为结构化失败，并由 Kernel 只持久化 `turn.failed`。`ErrorEvent` 与历史 `HistoryEntry` 携带可选 `turnId`，作为实时重放、自动重试和 UI 投影的稳定关联键。Desktop 对带 `turnId` 的错误按幂等语义更新；无关联键的旧错误继续使用兼容行为。

Runtime prompt 的失败回执必须同时携带结构化 `error` 与 `turnId`。回执是 retry adapter 判断是否需要重试的事实源，不能只返回 `status: "failed"`，否则适配层无法区分失败与成功并可能清除待发错误事件。

旧会话中已经落盘的 assistant error 消息仍由历史投影读取，避免数据迁移和历史丢失。

## 后果

- 新失败只有一个持久化事实，模型上下文不会再次携带失败 assistant 消息。
- 实时事件和历史回放可以安全重叠，错误不会因订阅时序丢失或重复。
- Provider 适配器不需要知道 Desktop 的展示细节；失败语义在 Runtime Core 收口。
- 现有旧历史仍保留兼容分支，未来可在数据统计确认后再清理旧消息路径。
