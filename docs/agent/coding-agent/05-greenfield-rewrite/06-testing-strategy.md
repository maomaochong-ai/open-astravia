# 测试策略与架构守卫

## 1. Kernel 状态机测试

至少覆盖：

- Idle 时 send。
- Running 时重复 send。
- Tool 执行中 cancel。
- 模型流中 cancel。
- close 与 send 竞争。
- close 与 cancel 竞争。
- Tool 已产生副作用后的停止记录。
- Repository 写入失败。
- observer 失败不能破坏主状态机。

推荐对输入命令序列做 property-based test，验证：

- 永远不出现两个活动 Turn。
- Closed 后不再接受输入。
- 每个开始事件最终对应完成、失败或取消。
- 每个成功 prepare 的资源最终 dispose 一次。

## 2. Turn Pipeline 测试

- 固定阶段严格按协议执行。
- Snapshot 在 Turn 开始时绑定且中途不变。
- Context Strategy 只接收结构化输入。
- 压缩记录由 Pipeline 持久化，而不是由 Strategy 自行写入。
- Tool Loop 只存在于 Execution 阶段。
- Admission 失败时不调用模型。
- Conversation Loading 失败时不进入上下文准备。
- Tool Loop 失败时仍写入标准终止事件。
- cancel 可以传播到 Context Strategy、模型和 Tool。
- observer 失败不改变 Turn 结果。
- 进程在每个持久化检查点中断后均可恢复到可判定状态。

## 3. Compiler 测试

- 相同输入得到相同快照。
- 依赖排序稳定。
- 缺少依赖时报错。
- 循环依赖时报错。
- Tool 重名时报错。
- Feature 冲突时报错。
- prepare 中途失败时释放已创建资源。
- 新快照失败时旧快照继续可用。
- Feature 拓扑热更新不改变已绑定 Turn 的生命周期资源。

## 4. Model Call Frame 测试

- 每次模型调用前重新执行动态 Contribution Provider。
- 只修改动态提示词或工具时，不重新 prepare Feature。
- 同一 Turn 的下一次模型调用能够看到新提示词、工具和 Skill 贡献。
- 已经发送的模型调用保持其原 Frame。
- 动态贡献与静态贡献发生重名时 fail-fast。
- Frame 的 instructions、tools 和 Tool Schema 对调用方不可修改。

## 5. Feature 合同测试

为所有 Feature 运行统一测试套件：

```text
definition
-> prepare
-> contribute
-> execute / observe
-> cancel
-> dispose
```

单独 Feature 不能依赖完整 Desktop 才能测试。

## 6. 行为兼容差分测试

重写迁移默认只允许内部结构变化。每个旧能力必须把同一组 fixture 同时送入旧实现和新实现，
比较：

- 模型可见名称、描述和 JSON Schema。
- 成功结果的 content、details 和停止语义。
- 失败类型、错误消息和可恢复提示。
- 文件、进程、网络和存储副作用。
- 路径、编码、截断、取消和平台差异。
- Profile、scope、权限和默认启用条件。

工具迁移使用统一的 Tool Compatibility Contract。旧工具与 Runtime Tool 先适配到同一测试观察面，
Adapter 只转换调用参数，不修改结果、错误或进度。合同记录并比较：

- definition：name、label、description、Schema。
- registration：scope、category 和最终激活集合。
- execution：fulfilled/rejected、content、details、update 和 phase。
- cancellation：相同取消时点下的结果或错误。

注册兼容不能只比较 `scope_use` 数组；必须把每个旧会话场景分别送入旧选择器和新选择器，
比较最终工具名集合。参数校验兼容还必须经过真实 Agent Core Tool Loop，不能只直接调用
`execute()`。

新增更严格的校验、缩小路径范围、删除格式支持或改变取消行为也属于功能变化，不能以“更安全”
或“更简单”为理由混入架构重写。确需改变时必须单独记录差异、迁移方式和批准结论。

只有旧新差分合同全部通过，能力才可以标记为“已迁移”并接入生产 Profile。新实现尚不完整时，
保持旧实现工作，不发布一个同名但能力缩减的替代品。

迁移期间允许测试把旧实现作为行为 Oracle，但新生产源码禁止导入旧包。删除旧代码前，需要把
差分 fixture 固化为不依赖旧实现的合同期望，保证旧 Oracle 删除后仍能持续防止行为回退。

复杂工具先建立参数化 Behavior Contract，再接入成对差分。以 read 为例：

```text
Read Behavior Contract
  <- Legacy Read Adapter（先建立行为基线）
  <- Runtime Read Adapter（实现后运行同一合同）

Tool Compatibility Contract
  <- 再比较旧新完整 definition、registration 和 execution observation
```

Behavior Contract 不能只覆盖纯文本 happy path。read 至少覆盖 UTF-8/GB18030、空文件、相对/
绝对/`~` 路径、Unicode 与模糊路径、offset/limit、锚点、行/字节截断、图片魔数、默认图片
处理、关闭缩放、二进制提示、自定义 Read Operations 和取消时点。

默认不激活的工具还必须区分“实现兼容”和“默认暴露兼容”。以 ls 为例：

```text
Ls Behavior Contract
  <- Legacy Ls Adapter
  <- Runtime Ls Adapter

registration.scopeUse = []
  -> 所有场景默认激活集合均不包含 ls
  -> 显式选择后仍能进入真实 Agent Core Tool Loop
```

不能用“新工具已经实现”为理由把空 `scope_use` 改成全场景，也不能因为默认 Snapshot 不包含
该工具就跳过执行合同。排序、目录后缀、dotfile、entry limit、字节截断、错误、自定义
Operations 和取消时点都必须独立验证。

`grep` 的迁移合同至少覆盖：

- 单文件和目录搜索的相对路径输出。
- regex、literal、ignoreCase、glob、context 和 limit。
- `path:line:hash: content` 匹配行与 `path-line:hash- context` 上下文行。
- `.gitignore`、隐藏文件、空结果和路径不存在错误。
- 匹配数量、总字节数和单行长度限制及 details/notices。
- ripgrep 进程启动失败、提前取消和执行中取消。
- `GrepOperations` 的远程文件读取替换，不把 SSH、文件系统或下载器实现带入 Runtime。
- 通过真实 Agent Core Tool Loop 执行，而不是只直接调用 `execute()`。

`find` 的迁移合同至少覆盖：

- `pattern`、`path`、`limit` 的 Schema 和默认值。
- 单目录下的相对路径化、Windows 分隔符、目录尾部 `/`。
- 隐藏文件、`.gitignore`、`node_modules`/`.git` 排除。
- 空结果、路径不存在、fd 启动失败和取消。
- 结果上限、总字节截断、notice 和 `FindToolDetails`。
- `FindOperations.glob` 的远程或沙箱实现替换。
- 空 `scope_use` 在所有场景默认不激活，但 explicit activation 能通过真实 Tool Loop。

`glob` 的迁移合同至少覆盖：

- `pattern`、`path`、`limit`、`description` 的 Schema 和默认值。
- 绝对模式拆分、搜索根解析、相对路径输出和目录尾部 `/`。
- 重复结果去重、隐藏文件、`.gitignore` 和 `.git` 排除。
- 空结果、路径不存在、非目录路径和取消。
- 结果上限、50KB 头部截断、notice 和 `GlobToolDetails`。
- `GlobOperations` 的宿主或远程搜索替换，以及 `glob`/`ignore` 的直接 Runtime 依赖。
- 旧新实现定义、注册元数据和结果差分，并通过真实 Agent Core Tool Loop 执行。

宿主可执行文件解析 Port 还必须覆盖：

- 受管 bin 目录优先于 PATH。
- Windows `.exe` 后缀和 Unix 命令名。
- PATH 命令不可用时返回 `undefined`，不在 Runtime 内触发下载。
- `grep/find` 注入解析器后分别请求 `rg`/`fd`，未注入时保持旧默认路径。
- Resolver 在执行时解析，不要求重建 Runtime Snapshot。

动态 Tool Catalog 还必须覆盖：

- 初始注册排序确定且成员快照冻结。
- Entry 中的 Capability Binding 按值稳定，不依赖工具对象引用。
- register/unregister 只影响后续 Catalog 版本。
- 重名注册 fail-fast，失败不能增加版本。
- scope 模式保持默认暴露，并允许显式追加空 scope 工具。
- explicit 模式替代场景默认集合。
- 未知工具名 fail-closed。
- Catalog 修改后，不重新编译 Feature，下一次 Model Call Frame 即看到变化。
- 模型已经看到工具后将其注销，执行前返回标准错误而不调用旧实现。
- 同名工具替换后，旧调用不能误路由到新实现。
- 已经开始的工具执行不因普通 unregister 隐式中断。
- deactivate 隐藏能力、拒绝新调用，但不轮换 revision 或中断在途执行；activate 后旧绑定
  恢复可用。
- revoke 轮换 revision、协作取消所有在途执行，并把不可重试结构化错误传到最终 Tool
  Result。
- unregister 后同名重新注册必须产生新 revision，旧绑定不能复活。
- Catalog 必须原子完成状态校验和 in-flight 登记，避免 revoke 穿过校验/执行间隙。
- 普通 Error 保持既有空 details；只有明确的 Runtime Tool Error 才进入结构化错误桥。
- 显式激活的空 scope 工具能够通过真实 Agent Core Tool Loop。

## 7. 上下文策略测试

- 无需压缩时保持消息语义和顺序。
- Token 预算不足时返回确定结果。
- Summary、Sliding Window 和 Hybrid 实现运行相同合同测试。
- Strategy 不修改输入 messages。
- Strategy 不访问 Repository。
- Summarizer 失败时执行显式回退策略。
- cancel 能停止摘要模型调用。
- Compaction Record 可以独立序列化和恢复。

## 8. 存储测试

- 旧会话只读导入。
- 新会话追加和恢复。
- 部分写入恢复。
- 分支与快照。
- schema version 升级。
- 重复迁移幂等。
- Windows 路径和锁。
- 未完成 Turn 的恢复语义。

建议采用：

> 旧格式只读 + 新格式单写。

不要长期双写两种格式。双写会让故障恢复和回滚语义变得不可判定。

## 9. Adapter 测试

- SDK 输入输出合同。
- RPC 协议 fixture。
- CLI 参数映射。
- Desktop RuntimeHost 不读取具体实现属性。
- IM 重试不会重复提交同一个 Turn。
- 断线重连只恢复事件订阅，不重放副作用。

## 10. 架构守卫

增加自动检查：

- `runtime-*` 禁止导入 `coding-agent`。
- `agent-core` 禁止导入 runtime 和产品包。
- `coding-agent` 根入口禁止导出 Manager / Registry。
- Feature 禁止导入具体 Adapter。
- Tool 实现禁止直接访问全局 Session。
- `RuntimeSnapshot` 贡献不能在发布后修改。
- 动态 Tool 执行不得绕过 Catalog 实时校验。
- Model Call Provider 不得重新创建无变化的 MCP 连接、文件监听器等长生命周期资源。
- 禁止公开通用 `pipeline.use()`、`next()` 或可写共享 metadata。
- `ContextStrategy` 禁止导入具体 Repository 实现。
- `ConversationRepository` 接口禁止暴露文件路径或数据库连接。
- 除 Composition Root 外，业务包禁止直接构造 Port 的生产实现。

## 11. 验证命令

每轮代码修改：

```text
bun run check:quick
```

针对包运行指定测试：

```text
cd packages/runtime-core
bunx vitest --run test/<specific>.test.ts
```

完成一轮代码改动后：

```text
bun run check
```

根据仓库规则，不使用 `bun test`，也不以文档更新触发无关的整仓检查。
