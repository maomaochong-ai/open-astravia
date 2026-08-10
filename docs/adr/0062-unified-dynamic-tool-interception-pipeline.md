# ADR-0062: 统一动态工具拦截管线

## 状态

Superseded by [ADR-0064](./0064-desktop-plugins-use-coding-agent-hook-adapter.md)

本 ADR 将 Desktop Plugin Hook 建模成独立的 `tool.before` / `tool.after` / `tool.error`
产品管线，这一方向没有复用 Coding Agent 已有的 Hook 事件与聚合语义。保留本文作为历史记录；
当前实现和新增扩展必须遵循 ADR-0064。

## 背景

Coding Agent 已同时拥有三类工具执行扩展：Ecosystem Hook、Coding Extension 和 Desktop Plugin。它们原先分别包装工具、维护生命周期和定义失败语义；继续为 Desktop Plugin 增加独立 wrapper 会让顺序、动态注册与诊断进一步分散。Runtime Core 又必须保持产品无关，不能直接理解 Codex/Claude Hook、Extension 或 Desktop Plugin。

## 决策

在 `coding-agent` 产品边界建立两层内部能力：

1. `DynamicContributionCatalog<T>` 管理 `sourceId + localId + revision + order`，注册返回 generation-safe lease，dispatch 读取稳定排序的不可变快照。
2. 强类型 Tool Interception Pipeline 明确提供 `before`、`after`、`onError`，各来源通过 Adapter 接入，不公开通用 EventBus、字符串事件名或 `next()` middleware。

工具阶段顺序固定为：

```text
Host Tool Policy / Permission
→ Ecosystem PreToolUse
→ Desktop Plugin tool.before
→ Coding Extension tool_call
→ Runtime Tool
→ Coding Extension tool_result
→ Desktop Plugin tool.after / tool.error
→ Ecosystem PostToolUse / PostToolUseFailure
```

Host Tool Policy 不属于 Hook；任何 Hook 都不能扩大宿主权限。Ecosystem profile/command 协议继续由 `ecosystem-adapter` 持有，Extension 语义和统一拦截装配由 `coding-agent` 持有，Desktop 只负责插件权限、贡献存储和 IPC handler bridge，`runtime-core` 只暴露产品无关的宿主调用合同。

Desktop Plugin API 首期只开放 `tool.before`、`tool.after`、`tool.error`。System Prompt 和 Continuation 保留 Provider/Policy API，不伪装成 Hook。动态 handler 只对 ESM / Module Federation 插件开放；ADR-0061 的 QuickJS 首版仍禁止 Agent 动态处理器。

## 生命周期与失败语义

- register/unregister/reload 对下一次 dispatch 可见；已经开始的 dispatch 使用自己的快照。
- Plugin handler 经 renderer IPC 执行，受 `agent.hooks.register` 与 `agent.hookHandler.execute` 双权限约束，输入和输出在边界做结构校验。
- handler 异常、超时或返回非法结构时 fail-open 并记录诊断；显式 `block` 才阻断执行。
- `tool.error` 只能追加反馈，不能吞掉原错误；取消信号继续向 handler 和工具传播。
- `scope_use` 必须显式声明且 fail-closed；`agent_mode` 与 `toolNames` 只进一步收窄匹配范围。

## 后果

- 三类 Hook 共享唯一工具包装点和可测试的稳定顺序，Desktop 插件可以动态注册和释放 Hook。
- 来源协议仍通过窄 Adapter 保持独立，不会把 shell、IPC 或 Extension 类型泄漏给 Runtime Core。
- 新增工具拦截来源时必须接入 Catalog/Pipeline 并声明稳定 order，不能再叠加新的生产 wrapper。
- 通用 Catalog 首先服务工具拦截；其它事件只有在结果语义明确且确有复用时才建立各自的强类型 pipeline。
