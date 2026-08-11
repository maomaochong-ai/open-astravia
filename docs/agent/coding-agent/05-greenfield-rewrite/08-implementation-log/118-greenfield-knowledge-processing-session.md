# 第 118 轮：Greenfield Knowledge Processing 纵向实现

## 目标

- 在第 117 轮的 `KnowledgeProcessingSessionFactory` 后提供 Greenfield 实现。
- 保留轮级共享写页、Todo 初始化与 `scene` 锁、模型刷新、usage 和生命周期合同。
- 不把 Knowledge 业务对象或可写 `TodoStore` 下沉到 Runtime Core/RuntimeHost。
- 差分验证完成前不切换 Desktop Knowledge Poller 的默认实现。

## 实施判断

Greenfield Session 已经具备 `prompt`、稳定 `SessionEvent`、`abort` 和异步 `dispose`。真实缺口不在
Kernel，而在 Coding Agent 产品组合：

- 产品工具注册总是按 `knowledgeRoot` 创建新 Writer，不能接受 Poller 的轮级 `KbWriteSession`。
- `initialTodos` 只创建 Todo，没有表达 `lock("scene")`。
- 初始 Todo 在 Document Participant 初始化前建立，没有进入首个持久快照。
- Knowledge Processing 在运行前必须继续执行远程模型刷新，并保留原缺失模型错误。

因此本轮没有修改通用 RuntimeHost 合同。

## 修改

### 会话级 Knowledge Writer

`CodingAgentGreenfieldProductToolOptions` 与 `GreenfieldRuntimeSessionOptions` 增加可选
`KnowledgePageWriterPort`。产品工具按 Session 创建时优先使用该 Writer，普通 CLI/Desktop/RPC/IM
会话仍使用原 `knowledgeRoot` 默认实现。

Greenfield Knowledge Processing Adapter 将既有 `KnowledgeProcessingPageWriter.write()` 包装为完整
`KnowledgePageWriterPort`，绝对路径仍由 Coding Agent Knowledge Store 的 `wikiDir()` 解析。Desktop
不需要理解 Runtime Tool Definition，也不会重新创建 PageIndex。

同一加工轮的并发批继续由 Poller 传入同一个 `KbWriteSession`；每个 Greenfield Session 的窄包装都委托
该对象，因此共享 PageIndex 与串行提交边界没有被 Composition 重建。

### Todo 初始化、锁定与首次持久化

`GreenfieldRuntimeSessionOptions` 增加 `initialTodoLockSource`。Composition 在 `createMany()` 后立即施加
锁，只有 Coding Agent 产品组合能看到该配置，Runtime Core 和宿主 Controller 仍只暴露读与受保护清空。

`CodingAgentTodoRuntime.initialize()` 在新会话没有历史快照、但 Store 已有初始状态时捕获首个快照。
因此加工 Session 即使首个 Turn 尚未调用 Todo Tool，关闭并重开后仍能恢复相同 Todo 和 `scene` 锁。

### Greenfield Knowledge Processing Factory

新增 `createGreenfieldKnowledgeProcessingSessionFactory()`：

- 每个 Port Session 独占一个 Greenfield Composition，Session 释放后同步释放 Composition。
- Composition 固定为 `kb-processing`、关闭 Subagent 和后台命令能力。
- `run()` 保留远程模型刷新、配置模型解析、目标模型选择和 reasoning 时序。
- 缺失模型继续返回原有中文错误。
- `usage.update` 投影为 `KnowledgeProcessingUsage`。
- Greenfield Turn 的失败结果转为 `run()` rejection；取消结果保持可收尾。
- `abort()` 直接委托 Greenfield Session。
- `dispose()` 改为可等待且幂等，并保证最终释放 Composition。

Legacy Adapter 同步实现异步 `dispose()`；Desktop Poller 在 `finally` 中等待释放完成。默认 Factory
仍是 `createLegacyKnowledgeProcessingSessionFactory()`。

## 行为验证

真实 Greenfield Tool Loop 覆盖：

- 先 `loadRemoteModels()`，再解析并选择目标模型。
- 每次模型调用使用目标模型和配置 reasoning。
- 最终 Tool Frame 包含原生 `kb_write_page`。
- 预填 Todo 的 `clear` 被 `scene` 锁拒绝，完成既有 Todo 后正常结束。
- 注入 Writer 收到原写页请求，结果包含正确绝对 wiki 路径。
- 每个 assistant message 的 usage 被稳定投影。
- 重复 `dispose()` 只释放一次 Composition。
- 模型缺失时不调用 Provider，并保留原错误文本。

独立 Todo 恢复合同覆盖首次 Turn 前关闭、重开后的 Todo 内容、顺序和锁定状态。

## 明确未修改

- Desktop Knowledge Poller 仍默认使用 Legacy Factory。
- 没有修改 Tool 名称、描述、TypeBox Schema、顺序、结果或错误文案。
- 没有改变批次规划、并发数、`KbWriteSession`、PageIndex、缓存重建或失败隔离。
- 没有向 Runtime Core/RuntimeHost 增加 Knowledge、Writer 或可写 Todo Store。
- 没有修改 Runtime selector、RPC wire、会话格式或 Legacy 根兼容入口。

## TypeBox / Zod 判断

本轮新增的是进程内 TypeScript Port、Composition 选项和稳定 `SessionEvent` 投影，没有新增外部配置、
RPC 或持久化反序列化输入，因此不新增 TypeBox/Zod Schema。Todo 持久记录继续使用既有 TypeBox Schema。

## 验证

- Coding Agent Legacy/Greenfield Knowledge Processing：2 个文件、5 项测试通过。
- CLI Greenfield Todo Runtime：1 个文件、2 项测试通过。
- Root `tsgo --noEmit` 通过。
- `bun run check:quick` 通过。
- `bun run check` 通过，覆盖 Biome、Root/CLI/Desktop/Admin 类型检查和结构守卫。
- 额外尝试了 Coding Agent 全包测试；本阶段新增测试通过，但全包仍有 80 项与本轮文件无关的
  Windows 路径/Shell、模型资产、资源发现和旧 mock 失败，因此未将该命令记为通过门禁。

## 下一步

下一阶段应建立 Knowledge Poller 的显式 Greenfield opt-in 和真实批次差分门禁：

1. selector 默认继续为 Legacy，只允许明确配置选择 Greenfield。
2. 用相同 raws diff、同一 Writer fixture 和确定性 Provider 比较最终 wiki、Todo、usage、processing
   record、中止与错误收尾。
3. 验证多个并发批确实共享同一个轮级 Writer，并在全部 Session 结束后无 Composition/Repository 残留。
4. 差分归零后再单独评审默认值切换，不与本阶段合并。
