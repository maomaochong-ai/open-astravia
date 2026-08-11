# 阶段 44：Session Host Interaction

## 目标

移除 RuntimeHost 对旧 `AgentSession.bindExtensions()` 和 `ExtensionUIContext` 的直接依赖，同时保持首次创建、同路径
复用重绑定、确认请求、沙箱授权及旧 UI 空实现行为不变。

## 边界分析

RuntimeHost 原先组装了完整 `ExtensionUIContext`，但真正属于宿主的能力只有两项：

- `confirm()`：把确认请求交给当前宿主处理器，并透传取消信号；
- `requestSandboxGrant()`：把工具、能力和路径信息交给当前沙箱授权处理器。

选择器、输入框、终端输入、状态栏、编辑器、主题和工具展开状态在桌面 RuntimeHost 中都是兼容空实现。若让新的
Runtime Port 直接接受 `ExtensionUIContext`，Greenfield Backend 仍会依赖 coding-agent 的终端 UI 协议，只是把耦合从
RuntimeHost 移到了 Assembly。因此本阶段定义独立宿主合同，再由 Legacy Adapter 扩展成旧协议。

该能力没有并入 Identity/Lifecycle：宿主处理器可在 Session 存活期间变化，同路径重新打开时必须重绑定；身份和释放
则是稳定的会话生命周期能力。

## 新增合同

```text
RuntimeSessionHostInteractionContext
  ├─ confirm(title, message, signal?)
  └─ requestSandboxGrant(request)

RuntimeSessionHostInteraction
  └─ bind(context)
```

`RuntimeSessionHostInteractionContext` 只使用 runtime-core 自己的沙箱授权合同，不导入 coding-agent UI 类型。
`RuntimeHostSessionAssembly` 显式交付 `hostInteraction`，因此独立 Backend 不需要伪装成旧 AgentSession，也不需要实现
无关的终端 UI 方法。

## Legacy 适配

新增 `LegacyRuntimeSessionHostInteraction`：

- 调用旧 Session 的 `bindExtensions()`；
- 将独立 `confirm()` 映射到旧 `ExtensionUIContext.confirm()`，只透传原实现实际使用的 `AbortSignal`；
- 将独立沙箱授权映射到旧 `requestSandboxGrant()`；
- 保留 select/input/editor 返回 `undefined`、空编辑器文本、主题切换失败等既有兼容行为；
- 不吞掉 `bindExtensions()` 的异步错误。

完整 `ExtensionUIContext` 的构造现在只存在于 Legacy Adapter，RuntimeHost 不再导入该类型。

## RuntimeHost 迁移

- 首次创建：Backend Assembly 创建完成、sessionId 已确定后，调用 `hostInteraction.bind()`；绑定成功后才注册 Session。
- 同路径复用：不重新调用 Backend，而是对已有 handle 再次调用 `hostInteraction.bind()`，然后返回原 sessionId。
- 确认处理器缺失或信号已取消时继续返回 `false`。
- 沙箱授权处理器缺失时继续返回 `deny`。
- requestId 生成和 sessionId 注入仍由 RuntimeHost 负责，Legacy Adapter 不持有宿主状态。

## 测试

新增 `session-host-interaction.test.ts`，固定：

- 独立确认能力到旧 UI Context 的映射和取消信号透传；
- 独立沙箱授权请求到旧 UI Context 的映射；
- 旧无 UI 宿主下的 select/input/editor、编辑器文本和主题切换行为；
- 旧绑定失败原样传播。

Assembly 隔离测试进一步固定：

- 独立 Assembly 的 Host Interaction 在首次创建时绑定；
- 同路径复用时再次绑定且不重新创建 Backend；
- 自定义 Assembly 不回退调用旧 Session `bindExtensions()`。

## TypeBox / Zod 判断

本阶段没有新增 JSON、IPC、文件或远端输入。Host Interaction 是同进程内部 Port，参数复用已经定义的 runtime-core
合同，`AbortSignal` 也不是可序列化数据，因此不引入 TypeBox/Zod。若未来将确认或授权请求跨进程传输，应在 IPC
Adapter 的序列化边界校验，而不是在 Session Port 内重复校验。

## 明确未修改

- 没有增加新的宿主 UI 功能。
- 没有改变确认请求字段、requestId/sessionId 生成或取消语义。
- 没有改变沙箱授权字段、默认拒绝或授权决策类型。
- 没有把旧空实现提升为核心能力。
- 没有改变首次绑定和同路径复用重绑定的时机。
- 没有修改插件、todo、后台任务、子代理、执行模式或输入模式功能。
- 没有修改 Greenfield Backend，也没有切换生产默认 Backend。

## 下一步分析

下一阶段建议处理 execution/workspace 边界。当前 RuntimeHost 为执行模式切换和 prompt 前目录自愈直接读取旧
`sessionManager.getCwd()`，并通过可选 `reconfigureCustomTools()` 改写工具集；这些操作共同依赖会话工作目录、忙碌态
和执行工具重配置语义。

实施前应先固定沙箱/全权限切换、streaming/bash 忙碌互斥、工作目录缺失自愈及不支持动态工具重配置时的错误行为，
再决定拆成只读 Workspace View 与 Execution Controller，避免把 cwd、状态读取和工具配置重新合成巨型 Port。

## 验证

- Host Interaction 与 Assembly 定向测试：2 个文件，10/10 通过。
- Runtime Core 完整测试：15 个文件，74/74 通过。
- 根 `bun run check:quick`：通过。
- 根 `bun run check`：Lint、monorepo/desktop/admin 类型检查与全部质量守卫通过。
