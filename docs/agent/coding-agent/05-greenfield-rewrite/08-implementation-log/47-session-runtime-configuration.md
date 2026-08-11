# 阶段 47：Session Runtime Configuration

## 目标与阶段粒度

本阶段一次迁移 RuntimeHost 剩余的四类旧 Session 在线调用：steering mode、follow-up mode、插件运行时配置和
agent mode。它们都属于“已创建 Session 的动态配置”，因此作为一个完整阶段处理，不再拆成多个细碎轮次。

目标是让 RuntimeHost 只依赖 Backend Assembly 交付的稳定 Port，同时保持配置应用时机、失败恢复和原功能完全不变。

## 审计结论

迁移前 RuntimeHost 还存在四处 `handle.session` 调用：

```text
updateSettings
  ├─ setSteeringMode
  └─ setFollowUpMode

turn boundary
  ├─ reconfigureAgentPlugins
  └─ setAgentMode
```

其中 steering/follow-up 是立即应用的 settings 命令；插件配置和 agent mode 则由 RuntimeHost 维护 pending 状态，
只在 prompt/continue 的 turn 边界尝试应用。busy 判断和插件失败恢复不是具体 Session 的职责，必须继续留在编排层。

## 新增合同

新增统一的 `RuntimeSessionConfigurationController`：

```text
setSteeringMode(mode)
setFollowUpMode(mode)
reconfigureAgentPlugins(agentPlugins)
setAgentMode(mode)
```

输入队列模式复用 `SettingsPatch` 的既有联合类型，导出为 `RuntimeSessionInputQueueMode`，没有复制另一份可能漂移的字符串
枚举。插件配置继续使用 runtime-core 自己的 `AgentPluginRuntimeConfig`。

该 Port 刻意不包含 pending、busy 或 turn 概念：

- RuntimeHost 决定何时调用；
- Execution Controller 提供当前 busy 前置条件；
- Configuration Controller 只执行已经决定好的配置命令；
- Legacy Adapter 只做旧实现的等价委托。

## Legacy 适配与 Assembly

新增 `LegacyRuntimeSessionConfigurationController`：

- steering/follow-up 原样调用旧 Session 的对应方法；
- 插件配置保持异步等待和异常原样传播；
- agent mode 保留 `string | undefined` 语义；
- 不复制插件配置对象，不改变引用与动态配置内容。

`RuntimeHostSessionAssembly` 和内部 `SessionHandle` 增加 `configurationController`，默认 Legacy Backend 与 create-only
Backend 兼容适配路径都会交付该 Port。自定义 Assembly 可以独立提供实现，不需要伪装成旧 AgentSession 的配置能力。

## RuntimeHost 迁移

- `updateSettings()` 通过 Configuration Controller 更新 steering/follow-up；仍只在字段为真值时调用。
- `applyPendingAgentPlugins()` 通过 Configuration Controller 重配置插件。
- 插件应用前仍先清 pending；失败且期间没有更新配置时，恢复原 pending 配置并把异常继续抛出。
- `applyPendingAgentMode()` 通过 Configuration Controller 设置工作模式。
- 插件配置和 agent mode 在 busy 时仍跳过，保留到后续 turn 边界。
- prompt 与 continue 的应用顺序不变：先插件配置，再 agent mode，之后才进入 Turn Control。

迁移后 RuntimeHost 中不存在 `handle.session` 直接调用。旧 Session 仍暂时作为 Assembly 的兼容字段存在，但不再参与
RuntimeHost 在线行为。

## 测试

新增 `session-configuration.test.ts`，固定 Legacy Adapter：

- 四类配置命令的参数和调用行为不变；
- 插件配置对象保持同一引用；
- 插件重配置异常原样传播。

扩展 Assembly 隔离测试，综合固定：

- settings 只调用自定义 Configuration Controller；
- agent mode 在首个 turn 边界应用；
- 插件失败时 Turn 不启动，pending 恢复并在下一次 continue 重试；
- busy 时插件和 agent mode 保持 pending，但 continue 仍按原行为执行；
- busy 解除后的下一个 turn 边界应用全部 pending 配置；
- 自定义 Assembly 全程不回退调用旧 Session 的四个配置方法。

## TypeBox / Zod 判断

本阶段没有新增 JSON、IPC、文件或网络原始数据解析。所有参数来自已类型化的 RuntimeHost API 和内部配置对象，因此不
引入 TypeBox/Zod。若未来插件配置从外部进程以未知数据进入，应在对应宿主 Adapter/IPC 边界校验，而不是让 Session
Configuration Port 重复解析内部对象。

## 明确未修改

- 没有改变 steering/follow-up 队列消费算法和模式值。
- 没有改变插件工具、Skill、MCP、系统提示词的重建实现。
- 没有改变 agent mode 对工具、提示词和 Skill 的过滤行为。
- 没有改变 pending 覆盖、busy 延迟、插件失败恢复或 prompt/continue 顺序。
- 没有切换生产 Backend，也没有修改 Greenfield Session 实现。
- 没有删除旧 Session 字段；该清理由下一阶段在独立结构门禁下完成。

## 验证

- Configuration Adapter 与 Assembly 定向测试：2 个文件，10/10 通过。
- Runtime Core 完整测试：18 个文件，88/88 通过。
- 根 `bun run check:quick`：通过。
- 根 `bun run check`：Lint、monorepo/desktop/admin 类型检查与全部质量守卫通过。

## 下一步分析

RuntimeHost 已不再直接读取或调用旧 AgentSession。下一阶段应整体移除 `RuntimeHostSessionAssembly` 与 `SessionHandle`
中的裸 `session` 字段，并增加结构测试，确保 RuntimeHost 无法重新依赖旧 Session；随后审计创建参数中仍泄漏的
`CreateAgentSessionOptions` 和 SessionManager 静态文件操作，确定新的 Composition Root 创建合同与宿主存储边界。
