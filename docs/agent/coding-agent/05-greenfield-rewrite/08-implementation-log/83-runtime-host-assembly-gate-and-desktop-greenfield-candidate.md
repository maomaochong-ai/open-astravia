# 第 83 轮：RuntimeHost Assembly 门禁与 Desktop Greenfield 候选组合

## 1. 本轮目标

在不切换 Desktop 生产 Backend、不降低既有功能的前提下，为 Greenfield 接入活动会话建立可执行门禁：

1. 用同一份完整 Assembly 合同检查 Legacy 与 Greenfield。
2. Greenfield 缺失能力必须显式暴露，禁止用 no-op 适配器伪装完成。
3. Desktop 可以创建或恢复真实 Greenfield 候选会话，但不能把不完整候选交给生产 `RuntimeHost`。
4. 保持第 82 轮 `interactiveResume: false`。

## 2. 实施前审计结论

Desktop 活动会话并不只消费 Prompt、Event 和 History。现有 IPC、Scheduler、Batch 和会话 UI 通过
`RuntimeHost` 实际使用完整 `RuntimeHostSessionAssembly`：

- 身份、释放、工作目录；
- Prompt、Continue、Abort、事件、状态；
- 历史读取、编辑、分支、删除、替换、fork、命名；
- 模型选择、思考等级、认证与候选模型；
- 用户确认和 sandbox grant；
- 执行模式重配置；
- 后台命令、subagent、todo；
- steering、follow-up、Plugin 和 agent mode 动态配置。

Greenfield 当前稳定交付：

- `lifecycle`
- `historyReader`
- `historyController`
- `workspaceView`
- `modelController`
- `modelView`
- `corePorts`

当前通用 Greenfield Assembly 仍缺少：

- `hostInteraction`
- `executionController`
- `backgroundWorkController`
- `todoController`（真实 CLI 组合可选提供，但通用 Backend 不保证）
- `configurationController`

因此“直接让 Greenfield 实现完整 Backend，再为缺口返回空实现”会改变功能语义，也会绕过第 82 轮
只读保护。本轮没有这样做。

## 3. RuntimeHost Assembly 完整性合同

Runtime Core 新增唯一的完整端口清单：

```ts
RUNTIME_HOST_SESSION_PORT_NAMES
```

以及：

```ts
assessRuntimeHostSessionAssembly(candidate)
```

结果是判别联合：

```text
ready = true
  └─ assembly: RuntimeHostSessionAssembly

ready = false
  └─ missingPorts: RuntimeHostSessionPortName[]
```

它只检查受信任进程内组合是否交付全部 Port，不解析外部数据，也不检查各 Port 内部行为。端口行为仍由
对应差分测试负责。

Legacy Assembly 通过同一门禁；Greenfield 候选按稳定顺序报告真实缺口。新增 Assembly 字段时，
`satisfies readonly (keyof RuntimeHostSessionAssembly)[]` 和能力矩阵测试会共同要求更新门禁。

## 4. Greenfield 候选 Assembly

`GreenfieldRuntimeAssembly` 和 `GreenfieldRuntimeResources` 现在允许组合根显式提供外围 Port：

- `hostInteraction`
- `executionController`
- `backgroundWorkController`
- `configurationController`

这些字段保持可选。`GreenfieldRuntimeSession.createRuntimeHostAssemblyCandidate()` 合并核心能力与组合根
确实提供的外围能力：

```text
Greenfield Runtime Session
  ├─ 已实现核心 Port
  ├─ 组合根实际提供的外围 Port
  └─ assessRuntimeHostSessionAssembly()
       ├─ complete → 可进入后续 RuntimeHost Backend 阶段
       └─ incomplete → 明确列出缺口
```

没有为缺失 Port 安装默认实现，也没有让 Greenfield Backend 虚假实现 `RuntimeHostSessionBackend`。

## 5. Desktop 非生产候选组合

Desktop 新增 `DesktopGreenfieldRuntimeCandidate`：

- 复用 `createGreenfieldRuntimeComposition()`，因此底层仍是真实文件 Repository、Runtime Factory、
  Tool/Profile 组合和 Greenfield Session。
- Composition 按 workspace cwd 绑定；会话 cwd 不一致时显式拒绝，避免 Tool Runtime 在错误目录执行。
- 新建会话默认生成独立 Session ID。
- 恢复会话必须通过 Greenfield conversation root 的路径归属解析。
- 每次新建或恢复都返回 Session 与 Assembly 完整性评估。
- 默认 scenario 为 `conversation`。

该组合没有接入 `getSharedRuntime()`，也没有修改生产 Backend Selector。它的职责是让后续外围 Port
迁移可以在 Desktop 宿主语境中被验证，而不是提前提供用户可见开关。

## 6. 共用合同验证

本轮建立三层验证：

1. Legacy 真实 `AgentSession` 生成的 Assembly 通过完整性门禁，并验证宿主绑定、steering/follow-up、
   workspace 和 history 基本合同。
2. Greenfield 真实 Kernel/Repository 测试夹具：
   - 缺少外围 Port 时得到精确缺口；
   - 组合根交付全部外围 Port 时通过同一完整性门禁；
   - 完整候选继续验证 Prompt、History、Workspace、Host Binding 和动态配置调用。
3. Desktop 候选组合验证：
   - create/resume 参数映射；
   - workspace-scoped cwd 一致性；
   - conversation root 路径归属；
   - 不完整候选不会被误判为可交互；
   - 组合资源释放。

这不是“Legacy 与 Greenfield 已全部行为等价”的声明。它把完整 Profile 的结构门禁和可运行候选环境先固定，
剩余五类外围能力仍需在后续阶段逐项实现并加入同一行为合同。

## 7. TypeBox / Zod 判断

本轮没有新增外部 JSON、IPC payload 或持久化格式：

- Candidate 是受信任进程内对象。
- `missingPorts` 来自编译期固定清单。
- Session 路径继续复用现有 Greenfield 路径解析。

因此不引入 TypeBox 或 Zod。对进程内 Port 对象做 Schema 校验既不能证明行为正确，也会制造重复类型源。

## 8. 明确未修改

- Desktop 生产 `RuntimeHost` 仍使用 Legacy Backend。
- `interactiveResume` 仍为 `false`。
- Greenfield IM Sidecar、RPC Selector 和 fallback 不变。
- Tool、Prompt、Skill、MCP、Knowledge、Memory、Todo、Plugin、Subagent 和 sandbox 行为没有被降级。
- Session 文件格式、ownership、Catalog 和历史读取路由不变。

## 9. 验证结果

已通过：

```text
runtime-core:
  greenfield-session-backend.test.ts
  greenfield-session-capabilities.test.ts

coding-agent:
  runtime-core/composition.test.ts

desktop-app:
  desktop-greenfield-runtime-candidate.test.ts

root:
  bun run check:quick
  bun run check
```

Desktop 独立 `tsc --noEmit` 同样通过。

## 10. 下一步

下一阶段应作为一个完整阶段补齐 Greenfield Desktop 的外围控制面，而不是继续拆成多个只有接口的微阶段：

1. 建立 Session-local Host Interaction Broker，并让 Tool Policy/sandbox 实际消费绑定结果。
2. 将 execution mode 变更连接到动态 Coding Tool Profile 重编译，验证忙碌态与在途 Turn 一致性。
3. 将 Background Command Service、Todo 和后续 Subagent Runtime 映射为真实工作管理 Controller。
4. 为 steering/follow-up 提供 Kernel 原生配置；为 Plugin 与 agent mode 提供可变的 Session-local
   配置事实源，并验证下一次模型调用生效。
5. 全部外围 Port 通过 Legacy/Greenfield 共用行为合同后，再让非生产候选生成完整
   `RuntimeHostSessionAssembly`；生产 `interactiveResume` 仍留到独立 opt-in 与崩溃恢复验证阶段。
