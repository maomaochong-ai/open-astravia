# 实施状态与剩余边界

本文记录 ADR-0069 的实际落地状态。它是实施事实清单，不替代目标合同；只有目标合同的全部验收项完成后，
才能宣称 Agent 的所有外部状态都已经实现完整的 Turn 隔离。

## 本轮已落地

### Kernel 与 Session 配置

- `RuntimeSnapshotProvider.acquire(context)` 在一次 admission 中返回 Runtime Snapshot、Model Binding 和
  Model Call 动态组件的同源 lease；Turn Pipeline 与手动压缩不再在 acquire 后读取独立的 live model provider。
- bind 失败会释放已经成功获取的子 lease；Turn 的完成、失败与取消路径只释放一次 generation。
- Runtime Host 用单一 `pendingConfiguration` 管理 mode、execution policy 与 plugin configuration。活动 Turn
  期间的更新可以被接受，但只在下一个 Turn admission 前应用。
- Session configuration 对外发布不可变 revision value，产品组合不再持有可被后续写入改变的配置对象。

### Prompt、Skill 与模型上下文

- Prompt resources、AGENTS、Skill 文件内容、Personalization 和 Agent Mode 在 Turn binding 时捕获；同一
  Turn 后续 Model Call 不再重新读取文件或设置。
- `invoke_skill` 使用 Turn 捕获的 Skill 内容与可见性；普通文件修改、资源 reload 和 mode 修改只影响后续 Turn。
- Model Call composer 在 Turn binding 时固定 active-tool override、MCP prompt state 及各动态 contribution provider。

### Tool、Plugin、MCP 与 Extension

- `CodingToolCatalog.acquireSnapshot()` 返回带 implementation lease 的不可变目录。普通 replace、disable、
  unregister 与 reload 只退休旧实现；旧实现保留到最后一个使用它的 Turn 释放。
- `revoke(toolName, { reason, auditId })` 是独立的 hard-revoke 控制面，可阻止或取消已绑定实现，不复用普通 reload。
- Plugin Tool、Plugin Provider、Plugin MCP、Extension Tool 和 Desktop Plugin Hook 的可见集合按 `turnId` 绑定。
- Session MCP refresh 移到 Turn admission 的 publish-before-capture 阶段；原有每次 Model Call refresh 路径已删除。

## 目前仍存在的边界

### 1. Prompt admission 前置处理

`KernelRuntimeSessionBackend.prompt()` 当前仍会在 `TurnPipeline` acquire 之前执行 PromptAdapter 的
UserPromptSubmit Hook 与结构化资源展开。模型循环内的 Prompt/Skill 已经被绑定，但严格意义上的 admission
尚未覆盖这段前置处理。

后续应把依赖外部状态的 Prompt preparation 移入 acquire 之后的 `AgentRunPreparer`，或引入一个由 Backend
获取、再转交 Pipeline 的 admission token。验收用例必须在 prepare 与 acquire 之间更新 AGENTS/Skill/Hook，
并证明一个 Turn 不会混合两个 generation。

### 2. Desktop Renderer Hook handler 的实体保活

Desktop adapter 已固定 Hook binding membership，但插件卸载或 renderer reload 仍可能立即销毁旧 handler。
旧 Turn 继续 dispatch 时，集合身份稳定但 handler 实体未必仍可执行。

后续需要 generation-aware renderer handler router：普通 reload 将旧 handler 标记 retired 并等待 Turn lease
归零；只有 hard revoke 或 renderer 崩溃才使旧 Turn 失败。验收应覆盖 reload barrier、在途 dispatch 和释放后回收。

### 3. MCP 连接与进程本体 lease

当前 MCP 的目录、tool definition 与 Plugin MCP 路由已经按 Turn 捕获，但 supervisor 重配仍可能关闭旧连接或
进程。完整方案需要让 MCP connection/process generation 与 Catalog 使用同一个 lease 生命周期，而不是只保留
工具描述和闭包。

### 4. 统一 Publisher 与可观测性

各领域已经具备不可变 capture，但还没有形成一个跨 process/workspace/session 的单飞 materializer、显式
generation id、last-known-good 失败状态和统一 effective/desired diagnostics。Desktop/CLI 也尚未完整展示
“已保存但等待下一 Turn 生效”的 revision。

## 后续实施顺序

1. 将 Prompt preparation 纳入 admission，并补跨边界竞态测试。
2. 为 Desktop Hook handler 与 MCP connection/process 建立可引用计数的 generation owner。
3. 收敛 process/workspace/session publisher 与 single-flight materializer，增加 last-known-good 回退测试。
4. 暴露 desired/effective generation、pending domain、retired lease count 和 hard-revoke audit 诊断。
5. 完成 Desktop/CLI 状态呈现、跨宿主合同测试与灰度清理，再关闭 ADR-0069 的迁移阶段。

## 当前结论

核心 Agent loop 已经从“每次 Model Call 随取 live state”迁移为“每个 Turn 持有一次 binding”；普通配置与能力
热更新不会再改变已绑定的模型、Prompt、Skill 和 Tool surface。资源实体仍位于 Renderer 或外部进程的领域，
只有在完成上述 owner/lease 改造后，才能保证 reload 时旧 handler 与 MCP 连接也始终存活到 Turn 结束。
