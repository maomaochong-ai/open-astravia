# Changelog

All notable changes to `@vetta/runtime-subagents` are documented in this file.

## [Unreleased]

### Changed

- 将协调器收敛为公开门面，新增 Dispatcher、Run、Pool 和纯 Recovery 所有者，并把 wait 完整归入 Delivery。
- 初始子代理消息投影改为可由产品组合层注入，同时保留默认投影兼容行为。
- 将子代理记录、FIFO 调度和 generation 交付拆分为独立状态所有者，协调器只负责编排异步生命周期。
- 调度内核改为交付终态快照，不再生成包含具体工具名的模型可见通知文本。
- 收紧协调端口的只读参数和事件类型，并移除没有生产消费者的工具描述接口。

### Fixed

- 修复 stop hook 与 interrupt/dispose 竞争覆盖终态、hook 异常占死槽位、reopen 后才检查容量、异步 abort 提前补位、重复 Child ID 覆盖和观察回调破坏调度状态的问题。
