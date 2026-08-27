# @vetta/runtime-tools

Vetta 平台无关的 Coding Tool 协议包。包根与 `@vetta/runtime-tools/coding` 暴露同一套合同。

## 本包拥有

- `CodingToolRegistration`、Scope、Category、Side Effect 与可选 Configuration 关联元数据
- `CodingToolCatalog`、Registry、Turn-bound Binding 与 Revoke 语义
- 工具激活、选择、可用性校验和结果策略
- `CodingToolsFeature`、`CodingToolExecutableResolver`、命令进程、后台任务和前台命令 Operations Port
- 不访问环境的并发执行 Gate
- 可选的 Coding Tool Catalog 观测 Publisher；仅发布操作、工具名与版本，不发布撤销原因或调用内容
- Turn-bound Configuration Decorator；组合原生或 Legacy Tool 的既有 binding/release，而不要求所有 Tool 实现配置协议
- 可发布的 `GenerationalCodingToolCatalog`；新 Turn 读取新 Catalog，已租赁 Turn 保留旧 binding，释放后自动退休
- 有序、不可变、可 Turn-bound 的 `RuntimeToolProjectionPipeline`；统一投影模型可见 Tool 表面，并在执行前把
  模型侧输入映射回原 Tool 合同

通用 Projection 机制不拥有具体工具内容或产品级投影策略。本包也不访问文件系统、进程、网络、Electron
或宿主全局状态。跨工具共享的协议 Schema 与通用投影机制属于本包；具体模型文案和启用哪些投影由产品层决定。
Node 环境中的 `read`、`write`、`edit`、`bash`、
`grep`、PDF/OCR 与子进程实现由 `@vetta/runtime-node/coding` 提供。

## 组合示例

```ts
const registry = new InMemoryCodingToolRegistry(platformRegistrations);

createCodingToolsFeature({
	catalog: registry,
	activation: { mode: "scope", scope: "project" },
});
```

平台 Runtime 创建具体 Registration 并注入 Host Port；产品组合根只选择平台实现与产品策略。
普通 Registry 变化只影响后续 Turn，活动 Turn 使用已租赁的稳定 Binding；显式 hard revoke
会使旧 Binding 失效并协作取消在途执行。

需要整体替换一组 Tool（例如执行模式切换）时，将各代 Registry 包装进 `GenerationalCodingToolCatalog` 并调用
`publish()`。仍有 lease 时，新旧 Catalog 不得复用相同 binding identity；实现会 fail-fast，避免旧 Turn 意外执行新 handler。

Tool 配置是可选能力：没有配置项的 Tool 保持原注册路径；可修改定义的 Tool 使用 `native`，
旧实现通过 `adapter` 在执行边界转换，无法修改的 MCP/黑盒 Tool 可由 Host 使用 `host-policy`
控制暴露、输入整形或执行策略。三种方式都使用 `withCodingToolConfiguration()` 捕获同一个
Turn 配置快照，并与 Tool 自身的 lease 一起释放；Registration 元数据只负责发现，不进入模型 Schema。

## Tool Projection

Projection 只负责「原 Tool 合同如何呈现给模型」：可调整 `label`、静态 `description`、`inputSchema`、
`modelOrder` 与上下文归属。它不能替换 `name`、执行函数、激活、权限或副作用声明。修改 `inputSchema`
时必须同时提供反向 `mapInput`，保证模型专用字段不会泄漏到原校验器和 handler。

动态 Projector 使用 `bindForTurn()` 捕获外部状态；同一 Turn 的多次模型调用共享该快照，释放时反向清理。
工具集合的增删替换仍使用 Catalog/generation，执行配置仍使用 `withCodingToolConfiguration()`，不要用
Projection 模拟能力注册、权限或执行拦截。
