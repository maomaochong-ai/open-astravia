# ADR-0127：模型请求边界使用独立 Runtime 观察事件

## 状态

已接受

## 背景

新会话在 Runtime 初始化前就会显示用户消息和 assistant 草稿。原界面用「正在执行且没有内容」推断「等待模型响应」，把创建会话、插件就绪、上下文和凭证准备都归给模型；`agent_start` 同样早于这些准备。Agent Core 的 `model_call_start` 则在 `resolveModelCall` 返回之后才产生，无法准确标识 Provider 调用开始。

## 决策

- 增加 `model.request.started` 瞬时 SessionEvent，包含 `turnId`、从零开始的 `modelCallIndex` 和现有事件时间戳；它属于 runtime channel，不混入原始 assistant 协议流。
- Stateless Turn Engine 在凭证、模型调用帧、上下文报告准备完成后，紧邻 Provider `streamFn` 调用前上报。使用现有事件投递屏障保持已产生的生命周期事件先送达，并在发布前后检查取消。
- Pipeline 通过 TurnEngineRequest 的可选 `reportObservation` 将该事实送入既有事件通道并补齐 Turn 身份。事件不进入持久化会话文档，不改变 assistant、工具、usage、错误与取消合同。
- RuntimeHost 在进行中的输出缓冲中保留该事件，切回仍在等待首包的会话时可恢复请求时间；完成后沿用现有缓冲清理规则。
- Desktop 将新建阶段显示为「正在创建会话」，无请求事件的空草稿显示「正在准备请求」，收到事件后显示「等待模型响应」。等待模型的计时从请求事件开始，整轮耗时仍从用户提交/回合开始计算。

## 备选方案

- 只修改文案为「处理中」：不会错误归因，但仍无法区别初始化与模型等待。
- 用 `agent_start` 或空文本推断请求：事实边界太早，保留原问题。
- 使用 `model_call_start`：适配器打开流可能已经等待过网络，事实边界太晚。
- 修改各 Provider 的底层 HTTP 调用：侵入多个协议适配器；本次需要的是 Runtime 准备与 Provider 调用的边界，并非 TCP 发包时间。

## 后果与兼容性

这是 schemaVersion 1 的新增事件变体，捆绑发布的 Desktop Main、IPC 解码器和 Renderer 同步支持。其他消费者原有默认忽略分支继续忽略该观察；使用严格事件白名单的外部消费者需要增加该变体。没有上报此事件的后端保守显示准备状态，不能凭空宣称模型已开始响应。

事件表示已进入 Provider 调用边界，包含 Provider 适配器自身的准备、网络与服务端等待，并不保证请求已经到达服务端。它也不覆盖 UI 到 Main 的排队时间。工具循环中每次调用都有自己的事件，但本次首响应展示只采用当前空回复的首次请求时间。

验证覆盖准备后才发布、取消时不调用 Provider、真实内部装配下的工具循环与重启恢复、IPC 解码、订阅回放、连续发送和等待计时。
