# 阶段 39：Runtime Session Backend Assembly

## 目标

移除 RuntimeHost 对 `createLegacyRuntimeSessionCorePorts` 的硬编码，让会话创建和能力适配在 Backend
Composition Root 一次完成；同时保留已有 create-only Backend 和 Greenfield 泛型 Backend 的兼容性。

## 审计结论

阶段 38 后，RuntimeHost 的基础路径已经只依赖 Core Ports，但创建流程仍然是：

```text
Backend.create -> legacy Session
RuntimeHost -> createLegacyRuntimeSessionCorePorts(Session)
```

这意味着 RuntimeHost 虽然不直接执行基础能力，仍然知道所有 Backend 都是旧 Session。直接修改原有泛型
`RuntimeSessionBackend.create()` 返回类型会同时破坏现有自定义 Backend 和独立 Greenfield Backend，因此本阶段
没有复用同一个方法名制造联合返回值或运行时猜测。

## 新增合同

```text
RuntimeHostSessionAssembly
  ├─ session: RuntimeSession       # 尚未迁移的外围能力句柄
  └─ corePorts: RuntimeSessionCorePorts

RuntimeHostSessionBackend
  └─ createAssembly(options): Promise<RuntimeHostSessionAssembly>
```

`RuntimeSessionBackend<TOptions, TSession>` 继续保持原有 `create(): Promise<TSession>` 泛型工厂合同，Greenfield
Backend 不受影响。RuntimeHost 的内部字段则收窄为 `RuntimeHostSessionBackend`，只消费 Assembly。

## 兼容适配

新增 `RuntimeSessionBackendAssemblyAdapter` 与 `asRuntimeHostSessionBackend()`：

- Backend 已实现 `createAssembly` 时直接使用其 Assembly，不推断、不重建 Ports；
- 旧 create-only Backend 只在这个兼容适配器内转换为 Legacy Assembly；
- `LegacyCodingAgentSessionBackend` 同时保留原 `create()`，并原生实现 `createAssembly()`；
- RuntimeHost 构造时只做一次 Backend 归一化，createSession 路径不再导入 Legacy Port Factory。

这使现有注入 `RuntimeSessionBackend` 的宿主和测试继续工作，也允许新的 Composition Root 显式提供自定义
Core Ports。

## Event State 所有权调整

Legacy Event Adapter 现在独立持有 turn timing 映射所需的 startedAt 状态，不再借用 RuntimeHost 的 Map。
RuntimeHost 的 `currentTurnStartedAt` 只用于公开 State Snapshot，并从稳定 `SessionEvent` 的 agent_start/agent_end
生命周期更新。Adapter 内部状态和宿主投影状态由事件协议同步，不共享可变对象。

## 合同测试

新增 Assembly Backend 特征测试，显式提供独立的 Turn Control、Event Stream 和 State Reader，并验证：

- RuntimeHost 调用 Assembly 的 Turn Control，而不是旧 Session prompt/continue/abort；
- RuntimeHost 订阅 Assembly Event Stream，而不是旧 Session.subscribe；
- getState/getMessages 使用 Assembly State Reader；
- create-only Recording Backend 的创建参数、事件和释放测试继续通过。

## TypeBox / Zod 判断

Assembly 是进程内对象组合合同，不跨 IPC、RPC、文件或不可信配置边界；其中还包含函数 Port，不能也不应由
JSON Schema 表示。本阶段不引入 TypeBox/Zod。未来若 Composition Root 由声明式配置选择 Backend，只校验
配置数据，不校验已构造的 Port 对象。

## 明确未修改

- 没有修改 RuntimeSessionBackend 原有泛型 create 合同。
- 没有修改 GreenfieldRuntimeSessionBackend。
- 没有让 Greenfield Session 伪装成旧 RuntimeSession。
- 没有改变 prompt、continue、abort、事件、状态或消息行为。
- 没有迁移 history、model、plugin、todo、background task 或 subagent。
- 没有切换生产默认 Backend。

## 下一步分析

Assembly 中的 `session` 仍是完整旧 RuntimeSession，这是下一处明确耦合。下一阶段不应删除它，而应先抽出
最小 Identity/Lifecycle Port，覆盖 sessionId、sessionPath 和 dispose；Host UI binding 仍依赖旧
ExtensionUIContext，应单独作为 Host Interaction Adapter 处理，不能塞进 Lifecycle。

随后可按实际调用量选择第一个外围 Port：

1. History Read/Branch，负责 JSONL history 与编辑分支；或
2. Model Configuration，负责 model lookup/switch 与 thinking level。

优先建议 History Read，因为它可以先覆盖纯读取路径，副作用和动态配置风险低于 Model/Plugin。同步
State Projection 问题仍是 Greenfield 直接接入现有 SessionFacade 的门禁，不能用空值实现绕过。

## 验证

- RuntimeHost Assembly 定向测试：1 个文件，8/8 通过。
- Runtime Core 完整测试：11 个文件，59/59 通过。
- Runtime Core build typecheck：通过。
- 根 `bun run check:quick`：通过。
- 根 `bun run check`：Lint、monorepo/desktop/admin 类型检查与全部质量守卫通过。
