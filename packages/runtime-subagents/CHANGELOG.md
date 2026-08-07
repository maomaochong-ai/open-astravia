# Changelog

All notable changes to `@vetta/runtime-subagents` are documented in this file.

## [Unreleased]

### Changed

- 将子代理记录、FIFO 调度和 generation 交付拆分为独立状态所有者，协调器只负责编排异步生命周期。
- 调度内核改为交付终态快照，不再生成包含具体工具名的模型可见通知文本。
- 收紧协调端口的只读参数和事件类型，并移除没有生产消费者的工具描述接口。
