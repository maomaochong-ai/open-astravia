# ADR-0064: Desktop Plugin 通过 Adapter 接入 Coding Agent Hook

## 状态

Superseded in part by [ADR-0069](./0069-turn-bound-runtime-generations.md)。Hook 单一领域模型和 Adapter
分层继续有效；动态注册的可见性与资源生命周期改由 ADR-0069 定义。

## 背景

Coding Agent 已在每个 Session 中持有唯一的 `EcosystemHookRuntime`，并以判别联合表达
`SessionStart`、`SessionEnd`、`UserPromptSubmit`、工具、压缩、Subagent 与 Stop 共 12 类事件。
`additionalHookAdapterFactories` 是宿主追加 Hook 实现的既有公共组合点。

ADR-0062 曾为 Desktop Plugin 新建 `tool.before` / `tool.after` / `tool.error` 合同、产品运行时和
Runtime Core 调用端口。它只覆盖工具事件，复制了匹配、结果聚合、失败和生命周期语义，并让
“Coding Agent Hook”与“Plugin Hook”成为两套不同概念，难以理解和扩展。

## 决策

Coding Agent Hook 是唯一 Hook 领域模型。Desktop Plugin 不新增 Hook runtime 或 Hook point，
而是在 Desktop Composition Root 中通过 `additionalHookAdapterFactories` 注入一个 callback adapter：

```text
Plugin SDK registerHook(eventName, handler)
        ↓ renderer/preload/main IPC
DesktopPluginHookRegistry（动态注册与快照）
        ↓ Desktop callback adapter
EcosystemHookRuntime（每 Session 唯一）
        ↓ Coding Agent 既有 12 类生命周期点
```

- Plugin SDK 的 `eventName` 与 Coding Agent 的 12 类 Hook 事件一一对应；事件与返回值用判别联合约束。
- Desktop adapter 只负责权限复核、`scope_use` / `agent_mode` / `toolNames` 匹配、IPC callback、
  超时、边界校验和 callback run 诊断，不重新实现 Hook 调度时机或全局聚合策略。
- `runtime-core` 保持产品无关，不暴露 Plugin Hook contribution 或 invoker。
- Coding Extension 的工具事件不是 Coding Agent Hook，不改名也不伪装成 Hook；现有强类型工具
  interception pipeline 只负责 Extension 与工具 wrapper 的明确顺序。
- Codex/Claude command adapter 与 Desktop callback adapter 共享 `HookDispatchOutcome` 聚合函数和
  `HookRunSummary`，但各自保留协议与执行边界。

## 生命周期与安全语义

- 注册、替换和注销对下一次 Turn 可见；Turn admission 绑定不可变、有序 Hook generation。
- 同一 `pluginId + hookId` 的新 activation 原子替换旧 activation；旧 activation 的 dispose 不得删除新注册。
- 插件卸载先从新 Turn 的可见注册表移除；旧 generation 的 renderer handler 在活动 Turn lease 归零后释放。
- 每次调用同时复核插件启用状态、模式与 `agent.hooks.register` / `agent.hookHandler.execute` 权限。
- handler 异常、超时、缺失或非法输出 fail-open，并记录 `handlerType: "callback"` 的失败 run；
  只有通过事件专属校验的显式结果才能 block、stop、修改工具输入、决定权限或请求 Stop 续跑。
- `transcriptPath` 等宿主内部字段不进入 Plugin SDK 事件。QuickJS 继续不开放动态 Agent handler。

## 后果

- 插件自动获得 Coding Agent 新增 Hook 事件的统一接入路径，不再增加另一套产品运行时。
- Hook 的执行顺序、Stop 安全策略、结果聚合和会话生命周期只有一个事实源。
- Desktop 仍持有权限与 IPC 安全边界，Coding Agent 和 Runtime Core 不依赖 Plugin SDK 或 Electron。
- ADR-0062 的 Plugin Hook 公共合同和 Runtime Core invoker 被移除；该合同尚处于 Unreleased，
  因此不提供兼容层。
