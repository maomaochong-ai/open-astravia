# 阶段 48：Raw Session Handle Removal

## 目标与阶段范围

阶段 47 已使 RuntimeHost 的全部在线会话行为通过稳定 Port 执行，但 `RuntimeHostSessionAssembly` 和内部
`SessionHandle` 仍保留一个不再使用的旧 `AgentSession` 字段。只要该字段存在，后续代码就可能绕过 Port 再次形成直接
依赖。

本阶段完成两件相关工作：

1. 从 RuntimeHost 的装配结果和长期句柄中彻底移除裸 Session；
2. 审计下一步创建参数与静态 SessionManager 存储边界，确定不会制造“换了类型名但仍绑定旧实现”的假抽象。

## 实施前证据

全量搜索确认，阶段 47 之后裸 Session 只剩以下数据流：

```text
Legacy Backend creates AgentSession
  → createLegacyRuntimeHostSessionAssembly(session)
  → assembly.session
  → RuntimeHost destructures session
  → SessionHandle.session
  → no consumer
```

RuntimeHost 已不存在 `handle.session` 读取或调用，因此删除该字段不会改变任何运行时路径。旧 Session 仍然需要存在于
Legacy Adapter 内部，用于一次性构造 Port；它不应越过 Assembly 边界。

## 实施内容

- `RuntimeHostSessionAssembly` 删除 `session` 字段。
- 内部 `SessionHandle` 删除 `session` 字段及对应 `RuntimeSession` 类型依赖。
- RuntimeHost 创建会话时不再解构或保存裸 Session。
- `createLegacyRuntimeHostSessionAssembly()` 仍接收旧 Session，但只用它构造 lifecycle、turn、event、state、history、
  model、interaction、execution、work management 和 configuration 等 Port。
- create-only `RuntimeSessionBackend` 兼容适配仍保留：它创建旧 Session 后立即转换为 port-only Assembly。

最终长期依赖关系变为：

```text
Legacy AgentSession
  → Legacy Adapters
  → RuntimeHostSessionAssembly (ports only)
  → RuntimeHost SessionHandle (ports + orchestration state)
```

## 结构门禁

`session-backend.test.ts` 增加基于 `keyof RuntimeHostSessionAssembly` 的编译期断言，要求 `session` 不是 Assembly 的键。
若未来重新加入该字段，TypeScript 检查会直接失败。

既有综合 Assembly 测试也改为完全不向 RuntimeHost 提供旧 Session，同时继续验证 prompt、事件、状态、历史、模型、
交互、执行模式、后台工作、todo 和动态配置功能，证明 port-only Assembly 足以覆盖现有行为。

## 创建参数与存储边界审计

当前 `RuntimeSessionCreateOptions` 仍是旧 `CreateAgentSessionOptions` 的别名，RuntimeHost 还负责组装其中三个实现相关对象：

| 耦合项 | 当前语义 | 不能直接删掉的原因 |
| --- | --- | --- |
| `SessionManager` | 根据 sessionPath 打开，或根据 cwd/sessionDir 创建 | 包含文件锁、恢复和默认创建语义 |
| `customTools` | 根据初始 execution mode 创建平台沙箱工具 | 工具执行时需要延迟读取创建后的 sessionId，并复用沙箱授权缓存 |
| `ModelRegistry` | desktop 进程级共享并跳过每 Session 重复远端加载 | 同时承担登录刷新、模型候选共享和 stale-while-revalidate 行为 |

此外，ask-user-question 和插件 invoker 都闭包引用创建后才确定的 sessionId。若只用 `Pick<CreateAgentSessionOptions>` 或
重新声明同字段接口，公共合同看似属于 runtime-core，实际仍要求调用方理解旧 SessionManager、ToolDefinition 和
ModelRegistry，边界没有真正改善。

静态存储操作还分为两类：

- 会话创建/恢复所需的 persistence factory，属于 Backend Composition Root；
- 列表、只读历史、离线重命名和文件删除，属于宿主 Session Catalog/Storage Port。

这两类不能塞进一个巨型 Session Port，也不能让 Greenfield Backend 伪装成旧 SessionManager。

## TypeBox / Zod 判断

本阶段只删除进程内对象字段并加强静态类型结构，没有新增外部数据输入，不需要 TypeBox/Zod。后续 Session Catalog
读取 JSONL 时应继续由具体存储适配器负责格式解析和兼容；若创建请求跨 IPC/网络传输，则在入口 Adapter 使用 Schema
校验，而不是在 Composition Root 内重复校验已类型化对象。

## 明确未修改

- 没有删除 `RuntimeSession` 类型和 Legacy Adapter 对旧 AgentSession 的内部使用。
- 没有改变 create-only Backend 兼容路径。
- 没有改变 SessionManager 创建、打开、锁、列表、重命名或删除行为。
- 没有改变初始沙箱工具、共享 ModelRegistry、插件、Skill、MCP 或 ask-user-question 行为。
- 没有切换默认生产 Backend。

## 验证

- RuntimeHost Backend 定向测试：1 个文件，9/9 通过。
- Runtime Core 完整测试：18 个文件，89/89 通过。
- 根 `bun run check:quick`：通过。
- 根 `bun run check`：Lint、monorepo/desktop/admin 类型检查与全部质量守卫通过。

## 下一步实施方向

下一阶段建议作为一个完整的“Session Creation and Storage Boundary”阶段，不再逐字段拆分：

1. 先补创建、恢复、共享 ModelRegistry、初始沙箱工具和 sessionId 延迟绑定的行为基线；
2. 定义 runtime-owned 创建请求，只表达 cwd/session path、初始执行模式和宿主能力，不暴露 SessionManager/customTools；
3. 由 Legacy Composition Adapter 将请求翻译为 `CreateAgentSessionOptions`；
4. 定义独立 Session Catalog/Storage Port，迁移列表、只读历史、离线重命名和删除；
5. 保持默认 Legacy Backend 与所有公开 SessionFacade 行为不变，再为 Greenfield Backend 接入同一创建合同。
